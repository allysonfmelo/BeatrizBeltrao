import { eq, and, lt, gt, desc, gte, lte, or, inArray } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import { bookings, clients, services } from "@studio/db";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";
import * as calendarService from "../calendar/calendar.service.js";
import * as notificationService from "../notification/notification.service.js";
import type { CreateBookingDTO } from "@studio/shared/validators";

/** Calculates end time given start time (HH:mm) and duration in minutes */
function calculateEndTime(startTime: string, durationMinutes: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const totalMinutes = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalMinutes / 60);
  const endM = totalMinutes % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
}

/**
 * Creates a pre-booking with "pendente" status and a 24h payment deadline.
 */
export async function createPreBooking(data: CreateBookingDTO) {
  const service = await db.query.services.findFirst({
    where: eq(services.id, data.serviceId),
  });
  if (!service) throw new Error("Serviço não encontrado");

  const totalPrice = parseFloat(service.price);
  const depositAmount = Math.round((totalPrice * env.DEPOSIT_PERCENTAGE) / 100 * 100) / 100;
  const endTime = calculateEndTime(data.scheduledTime, service.durationMinutes);

  // Check for overlapping bookings (pendente or confirmado) in the database
  const conflictingBookings = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.scheduledDate, data.scheduledDate),
        inArray(bookings.status, ["pendente", "confirmado"]),
        lt(bookings.scheduledTime, endTime),
        gt(bookings.endTime, data.scheduledTime)
      )
    )
    .limit(1);

  if (conflictingBookings.length > 0) {
    const conflict = conflictingBookings[0];
    throw new Error(
      `Conflito de horário: já existe agendamento ${conflict.status} das ${conflict.scheduledTime} às ${conflict.endTime} neste dia.`
    );
  }

  const deadline = new Date();
  deadline.setHours(deadline.getHours() + env.PAYMENT_TIMEOUT_HOURS);

  const [booking] = await db
    .insert(bookings)
    .values({
      clientId: data.clientId,
      serviceId: data.serviceId,
      scheduledDate: data.scheduledDate,
      scheduledTime: data.scheduledTime,
      endTime,
      status: "pendente",
      totalPrice: totalPrice.toString(),
      depositAmount: depositAmount.toString(),
      paymentDeadline: deadline,
    })
    .returning();

  logger.info("Pre-booking created", {
    bookingId: booking.id,
    clientId: data.clientId,
    serviceId: data.serviceId,
    scheduledDate: data.scheduledDate,
  });

  return booking;
}

/**
 * Finds a booking by ID (raw, no joins). Used internally.
 */
async function findByIdRaw(id: string) {
  const result = await db.query.bookings.findFirst({
    where: eq(bookings.id, id),
  });
  return result ?? null;
}

/**
 * Confirms a booking: updates status, creates Google Calendar event.
 */
export async function confirmBooking(bookingId: string, paymentMethod?: string) {
  const booking = await findByIdRaw(bookingId);
  if (!booking) throw new Error("Booking não encontrado");
  if (booking.status === "confirmado") {
    logger.info("Booking already confirmed, skipping status transition", {
      bookingId,
      paymentMethod,
    });
    return booking;
  }
  if (booking.status !== "pendente") throw new Error(`Booking não está pendente (status: ${booking.status})`);

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, booking.clientId),
  });
  const service = await db.query.services.findFirst({
    where: eq(services.id, booking.serviceId),
  });

  if (!client || !service) throw new Error("Client ou Service não encontrado");

  let eventId: string | null = null;
  try {
    eventId = await calendarService.createBookingEvent({
      id: booking.id,
      clientName: client.fullName,
      clientPhone: client.phone,
      serviceName: service.name,
      scheduledDate: booking.scheduledDate,
      scheduledTime: booking.scheduledTime,
      endTime: booking.endTime,
    });
  } catch (error) {
    logger.error("Failed to create calendar event, confirming without it", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }

  const [updated] = await db
    .update(bookings)
    .set({
      status: "confirmado",
      googleCalendarEventId: eventId,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId))
    .returning();

  logger.info("Booking confirmed", {
    stage: "booking_confirmed",
    bookingId,
    eventId,
    paymentMethod,
  });

  const paymentMethodLabel = paymentMethod
    ? {
        pix: "Pix",
        credito: "Cartão de crédito",
        debito: "Cartão de débito",
      }[paymentMethod] ?? "Pagamento confirmado"
    : "Pagamento confirmado";

  try {
    await notificationService.sendBookingConfirmationWithImages(client.phone, {
      clientName: client.fullName,
      serviceName: service.name,
      scheduledDate: booking.scheduledDate,
      scheduledTime: booking.scheduledTime,
      totalPrice: booking.totalPrice,
      depositAmount: booking.depositAmount,
      paymentMethod: paymentMethodLabel,
    });
  } catch (error) {
    logger.error("Failed to send booking confirmation WhatsApp media", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }

  try {
    await notificationService.sendBookingConfirmationEmail(client.email, {
      clientName: client.fullName,
      serviceName: service.name,
      scheduledDate: booking.scheduledDate,
      scheduledTime: booking.scheduledTime,
      totalPrice: parseFloat(booking.totalPrice) * 100,
      depositAmount: parseFloat(booking.depositAmount) * 100,
    });
  } catch (error) {
    logger.error("Failed to send booking confirmation email", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }

  try {
    await notificationService.notifyMaquiadora(
      "Novo Agendamento Confirmado",
      `Cliente: ${client.fullName}\nTelefone: ${client.phone}\nServiço: ${service.name}\nData: ${booking.scheduledDate}\nHorário: ${booking.scheduledTime}`
    );
  } catch (error) {
    logger.error("Failed to notify maquiadora about confirmed booking", {
      bookingId,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }

  return updated;
}

/**
 * Cancels a booking and removes the calendar event if present.
 */
export async function cancelBooking(bookingId: string, reason?: string) {
  const booking = await findByIdRaw(bookingId);
  if (!booking) throw new Error("Booking não encontrado");

  if (booking.googleCalendarEventId) {
    try {
      await calendarService.deleteBookingEvent(booking.googleCalendarEventId);
    } catch (error) {
      logger.error("Failed to delete calendar event", {
        bookingId,
        eventId: booking.googleCalendarEventId,
        error: error instanceof Error ? error.message : "Unknown",
      });
    }
  }

  const [updated] = await db
    .update(bookings)
    .set({
      status: "cancelado",
      cancellationReason: reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId))
    .returning();

  logger.info("Booking cancelled", { bookingId, reason });
  return updated;
}

/**
 * Expires overdue bookings whose payment deadline has passed.
 */
export async function expireOverdueBookings(): Promise<number> {
  const now = new Date();

  const overdueBookings = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "pendente"),
        lt(bookings.paymentDeadline, now)
      )
    );

  let expiredCount = 0;

  for (const booking of overdueBookings) {
    await db
      .update(bookings)
      .set({
        status: "expirado",
        cancellationReason: "Prazo de pagamento expirado",
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    const client = await db.query.clients.findFirst({
      where: eq(clients.id, booking.clientId),
    });

    if (client) {
      try {
        await notificationService.sendWhatsAppMessage(
          client.phone,
          "O prazo de 24 horas para pagamento expirou e o pré-agendamento foi cancelado. Mas não se preocupe, podemos agendar novamente! ✨"
        );
      } catch (error) {
        logger.error("Failed to notify client about expired booking", {
          bookingId: booking.id,
          error: error instanceof Error ? error.message : "Unknown",
        });
      }
    }

    expiredCount++;
    logger.info("Booking expired", { bookingId: booking.id });
  }

  if (expiredCount > 0) {
    logger.info(`Expired ${expiredCount} overdue bookings`);
  }

  return expiredCount;
}

/**
 * Lists bookings with optional filters and pagination.
 * Returns enriched data with client and service info.
 */
export async function listBookings(filters: {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [];

  if (filters.status) {
    conditions.push(eq(bookings.status, filters.status as "pendente" | "confirmado" | "cancelado" | "concluido" | "expirado"));
  }
  if (filters.dateFrom) {
    conditions.push(gte(bookings.scheduledDate, filters.dateFrom));
  }
  if (filters.dateTo) {
    conditions.push(lte(bookings.scheduledDate, filters.dateTo));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      serviceId: bookings.serviceId,
      scheduledDate: bookings.scheduledDate,
      scheduledTime: bookings.scheduledTime,
      endTime: bookings.endTime,
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      depositAmount: bookings.depositAmount,
      googleCalendarEventId: bookings.googleCalendarEventId,
      paymentDeadline: bookings.paymentDeadline,
      cancellationReason: bookings.cancellationReason,
      createdAt: bookings.createdAt,
      updatedAt: bookings.updatedAt,
      clientFullName: clients.fullName,
      clientPhone: clients.phone,
      clientEmail: clients.email,
      serviceName: services.name,
      serviceType: services.type,
      servicePrice: services.price,
    })
    .from(bookings)
    .leftJoin(clients, eq(bookings.clientId, clients.id))
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(where)
    .orderBy(desc(bookings.scheduledDate))
    .limit(limit)
    .offset(offset);

  const data = rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    serviceId: row.serviceId,
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    endTime: row.endTime,
    status: row.status,
    totalPrice: row.totalPrice,
    depositAmount: row.depositAmount,
    googleCalendarEventId: row.googleCalendarEventId,
    paymentDeadline: row.paymentDeadline,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    client: {
      fullName: row.clientFullName,
      phone: row.clientPhone,
      email: row.clientEmail,
    },
    service: {
      name: row.serviceName,
      type: row.serviceType,
      price: row.servicePrice,
    },
  }));

  return { data, meta: { page, limit, total: data.length } };
}

/**
 * Finds a booking by ID with enriched client and service data.
 */
export async function findById(id: string) {
  const rows = await db
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      serviceId: bookings.serviceId,
      scheduledDate: bookings.scheduledDate,
      scheduledTime: bookings.scheduledTime,
      endTime: bookings.endTime,
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      depositAmount: bookings.depositAmount,
      googleCalendarEventId: bookings.googleCalendarEventId,
      paymentDeadline: bookings.paymentDeadline,
      cancellationReason: bookings.cancellationReason,
      createdAt: bookings.createdAt,
      updatedAt: bookings.updatedAt,
      clientFullName: clients.fullName,
      clientPhone: clients.phone,
      clientEmail: clients.email,
      serviceName: services.name,
      serviceType: services.type,
      servicePrice: services.price,
    })
    .from(bookings)
    .leftJoin(clients, eq(bookings.clientId, clients.id))
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(eq(bookings.id, id));

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    clientId: row.clientId,
    serviceId: row.serviceId,
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    endTime: row.endTime,
    status: row.status,
    totalPrice: row.totalPrice,
    depositAmount: row.depositAmount,
    googleCalendarEventId: row.googleCalendarEventId,
    paymentDeadline: row.paymentDeadline,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    client: {
      fullName: row.clientFullName,
      phone: row.clientPhone,
      email: row.clientEmail,
    },
    service: {
      name: row.serviceName,
      type: row.serviceType,
      price: row.servicePrice,
    },
  };
}

/**
 * Returns pending bookings with their deadlines for reminder processing.
 */
export async function getPendingBookingsForReminders(): Promise<
  Array<{ id: string; clientId: string; paymentDeadline: Date }>
> {
  const now = new Date();
  return db
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      paymentDeadline: bookings.paymentDeadline,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.status, "pendente"),
        gt(bookings.paymentDeadline, now)
      )
    );
}

/**
 * Sends a payment reminder WhatsApp message to a client.
 */
export async function sendPaymentReminderToClient(
  clientId: string,
  type: "6h" | "2h"
): Promise<void> {
  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
  });
  if (!client) return;

  const message =
    type === "6h"
      ? "Oi! ✨ Lembrando que seu pré-agendamento ainda está pendente. Faltam cerca de 6 horas para o prazo de pagamento do sinal. Não perca seu horário! 💄"
      : "Oi! ⏰ Última chamada! Faltam cerca de 2 horas para o prazo de pagamento do sinal do seu agendamento. Após esse prazo, o horário será liberado. 💬";

  await notificationService.sendWhatsAppMessage(client.phone, message);
}

/**
 * Finds a pending booking for a specific client.
 */
export async function findPendingByClientId(clientId: string) {
  const result = await db.query.bookings.findFirst({
    where: and(
      eq(bookings.clientId, clientId),
      eq(bookings.status, "pendente")
    ),
  });
  return result ?? null;
}

/**
 * Finds a pending booking that matches the exact booking draft fingerprint.
 * Used to keep create_booking idempotent when the client confirms more than once.
 */
export async function findPendingByFingerprint(data: {
  clientId: string;
  serviceId: string;
  scheduledDate: string;
  scheduledTime: string;
}) {
  const timeVariants = data.scheduledTime.length === 5
    ? [data.scheduledTime, `${data.scheduledTime}:00`]
    : [data.scheduledTime];

  const result = await db.query.bookings.findFirst({
    where: and(
      eq(bookings.clientId, data.clientId),
      eq(bookings.serviceId, data.serviceId),
      eq(bookings.scheduledDate, data.scheduledDate),
      inArray(bookings.scheduledTime, timeVariants),
      eq(bookings.status, "pendente")
    ),
    orderBy: [desc(bookings.createdAt)],
  });
  return result ?? null;
}
