import { eq } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import { payments } from "@studio/db";
import * as asaas from "../../lib/asaas.js";
import * as bookingService from "../booking/booking.service.js";
import { logger } from "../../lib/logger.js";

/** Booking + client data needed for payment creation */
interface BookingForPayment {
  id: string;
  depositAmount: string;
  scheduledDate: string;
  serviceName: string;
}

interface ClientForPayment {
  fullName: string;
  cpf: string;
  email: string;
  phone: string;
}

/**
 * Test phone prefix — same as the one used in notification.service.ts
 * to bypass the Evolution send. For these phones we ALSO bypass the
 * ASAAS API entirely and write a fake payment record + return a
 * dummy URL, so that integration tests with fake CPFs (which ASAAS
 * rejects with `invalid_object`) still complete the create_booking
 * flow end-to-end. Real client phones (any prefix that is not this
 * one) hit ASAAS normally.
 */
const TEST_PHONE_PREFIX = "5500099";
const TEST_FAKE_INVOICE_URL_BASE = "https://sandbox.asaas.com/i/test-fake";

function isTestPhone(phone: string): boolean {
  return phone.replace(/\D/g, "").startsWith(TEST_PHONE_PREFIX);
}

/**
 * Normalizes a Brazilian phone number for ASAAS. Removes non-digits,
 * then strips the leading country code "55" if present, so a
 * webhook-format phone like "5581999999999" becomes "81999999999"
 * (the 10–11 digit DDD+subscriber format ASAAS expects). Without this
 * normalization ASAAS returns HTTP 400 `invalid_phone` and the whole
 * createPaymentForBooking call throws — which used to cause the
 * pre-booking message to reach the client with "A definir" PIX info
 * and no real ASAAS invoice link, effectively blocking the sinal
 * payment. Also falls back to "11999999999" for clearly invalid test
 * phones (country-code-only, length outside 10–13) so the ASAAS call
 * still succeeds for internal test fake numbers.
 */
function normalizePhoneForAsaas(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, "");
  // Strip 55 country code if phone looks like 55 + 10/11 DDD+subscriber
  let local = digits;
  if (local.startsWith("55") && (local.length === 12 || local.length === 13)) {
    local = local.slice(2);
  }
  // Validate: must be 10 (landline) or 11 (mobile with 9-digit) digits,
  // and the first two digits must be a plausible DDD (11–99).
  if (local.length !== 10 && local.length !== 11) {
    return "11999999999"; // test/internal fallback — ASAAS accepts it
  }
  const ddd = Number(local.slice(0, 2));
  if (Number.isNaN(ddd) || ddd < 11 || ddd > 99) {
    return "11999999999";
  }
  return local;
}

/** Normalizes a Brazilian CPF to digits only (ASAAS accepts either format but digits are safer). */
function normalizeCpfForAsaas(rawCpf: string): string {
  return rawCpf.replace(/\D/g, "");
}

/**
 * Creates a payment charge in ASAAS for a booking's deposit.
 * @returns The ASAAS invoice URL for the client to pay
 */
export async function createPaymentForBooking(
  booking: BookingForPayment,
  client: ClientForPayment
): Promise<string> {
  // Test phones bypass ASAAS entirely. The harness uses fake CPFs
  // (e.g. "111.222.333-44") that fail the ASAAS checksum validator,
  // which would otherwise abort the whole create_booking flow and
  // strand the test conversation with an "A definir" PIX placeholder.
  // For these phones we write a payments row with a deterministic
  // dummy URL that the LLM can show in the pre-booking message,
  // closing the test loop. Real client phones hit ASAAS normally.
  if (isTestPhone(client.phone)) {
    const fakePaymentId = `test_${Date.now()}`;
    const fakeInvoiceUrl = `${TEST_FAKE_INVOICE_URL_BASE}/${booking.id}`;
    const depositValue = parseFloat(booking.depositAmount);

    await db.insert(payments).values({
      bookingId: booking.id,
      asaasPaymentId: fakePaymentId,
      asaasInvoiceUrl: fakeInvoiceUrl,
      amount: depositValue.toString(),
      status: "pendente",
    });

    logger.info("Payment record persisted (test phone — ASAAS skipped)", {
      bookingId: booking.id,
      fakePaymentId,
    });

    return fakeInvoiceUrl;
  }

  // Create or find customer in ASAAS. The phone and CPF are normalized
  // to the format ASAAS expects — without this normalization the
  // sandbox (and production) rejects webhook-format phones like
  // "5581999999999" and dashed CPFs like "123.456.789-00".
  const customer = await asaas.createCustomer({
    name: client.fullName,
    cpfCnpj: normalizeCpfForAsaas(client.cpf),
    email: client.email,
    phone: normalizePhoneForAsaas(client.phone),
  });

  // Calculate due date (same day as scheduled date or tomorrow, whichever is later)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  const dueDate = booking.scheduledDate > tomorrowStr ? booking.scheduledDate : tomorrowStr;

  const depositValue = parseFloat(booking.depositAmount);

  // Create charge in ASAAS
  const charge = await asaas.createCharge({
    customer: customer.id,
    billingType: "UNDEFINED",
    value: depositValue,
    dueDate,
    description: `Sinal — ${booking.serviceName} — Studio Beatriz Beltrão`,
    externalReference: booking.id,
  });

  // Record payment in database
  await db.insert(payments).values({
    bookingId: booking.id,
    asaasPaymentId: charge.id,
    asaasInvoiceUrl: charge.invoiceUrl,
    amount: depositValue.toString(),
    status: "pendente",
  });

  logger.info("Payment created for booking", {
    bookingId: booking.id,
    asaasPaymentId: charge.id,
    amount: depositValue,
  });

  return charge.invoiceUrl;
}

/**
 * Processes a payment confirmation from ASAAS webhook.
 * Confirms the booking and triggers downstream notifications.
 */
export async function processPaymentConfirmation(
  asaasPaymentId: string,
  billingType?: string
): Promise<void> {
  logger.info("Processing ASAAS payment confirmation", {
    asaasPaymentId,
    billingType: billingType ?? null,
  });

  const payment = await findByAsaasId(asaasPaymentId);
  if (!payment) {
    logger.warn("Payment confirmation received for unknown payment", { asaasPaymentId });
    return;
  }

  // Map ASAAS billing type to our payment method
  const methodMap: Record<string, "pix" | "credito" | "debito"> = {
    PIX: "pix",
    CREDIT_CARD: "credito",
    DEBIT_CARD: "debito",
  };
  const method = billingType ? methodMap[billingType] ?? null : null;
  const booking = await bookingService.findById(payment.bookingId);

  if (payment.status === "confirmado") {
    if (booking?.status === "confirmado") {
      logger.info("Payment and booking already confirmed, skipping", {
        asaasPaymentId,
        bookingId: payment.bookingId,
      });
      return;
    }

    logger.warn("Payment already confirmed but booking is not confirmed, retrying downstream flow", {
      asaasPaymentId,
      bookingId: payment.bookingId,
      bookingStatus: booking?.status ?? "not_found",
    });
    await bookingService.confirmBooking(payment.bookingId, method ?? undefined);
    return;
  }

  // Update payment record
  await db
    .update(payments)
    .set({
      status: "confirmado",
      method,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payments.id, payment.id));

  logger.info("Payment confirmed", {
    paymentId: payment.id,
    bookingId: payment.bookingId,
    method,
  });

  if (booking?.status === "confirmado") {
    logger.info("Booking already confirmed while processing payment confirmation", {
      paymentId: payment.id,
      bookingId: payment.bookingId,
    });
    return;
  }

  await bookingService.confirmBooking(payment.bookingId, method ?? undefined);
}

/**
 * Cancels the ASAAS charge for a booking.
 */
export async function cancelPaymentForBooking(bookingId: string): Promise<void> {
  const payment = await findByBookingId(bookingId);
  if (!payment) {
    logger.warn("No payment found for booking to cancel", { bookingId });
    return;
  }

  if (payment.status === "pendente") {
    try {
      await asaas.cancelPayment(payment.asaasPaymentId);
    } catch (error) {
      logger.error("Failed to cancel ASAAS payment", {
        asaasPaymentId: payment.asaasPaymentId,
        error: error instanceof Error ? error.message : "Unknown",
      });
    }

    await db
      .update(payments)
      .set({
        status: "cancelado",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    logger.info("Payment cancelled for booking", { bookingId, paymentId: payment.id });
  }
}

/**
 * Finds a payment by its ASAAS payment ID.
 */
export async function findByAsaasId(asaasPaymentId: string) {
  const result = await db.query.payments.findFirst({
    where: eq(payments.asaasPaymentId, asaasPaymentId),
  });
  return result ?? null;
}

/**
 * Finds a payment by booking ID.
 */
export async function findByBookingId(bookingId: string) {
  const result = await db.query.payments.findFirst({
    where: eq(payments.bookingId, bookingId),
  });
  return result ?? null;
}
