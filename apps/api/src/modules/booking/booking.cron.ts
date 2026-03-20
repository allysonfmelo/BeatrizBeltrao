import { eq, and, gt } from "drizzle-orm";
import { expireOverdueBookings } from "./booking.service.js";
import { db } from "../../config/supabase.js";
import { bookings, clients } from "@studio/db";
import * as notificationService from "../notification/notification.service.js";
import { logger } from "../../lib/logger.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let intervalId: ReturnType<typeof setInterval> | null = null;

/** In-memory tracking of sent reminders (booking ID → sent reminder types) */
const sentReminders = new Map<string, Set<string>>();

/**
 * Runs the booking expiration check.
 * Expires overdue bookings and cancels their ASAAS charges.
 */
async function checkExpiredBookings(): Promise<void> {
  try {
    const expiredCount = await expireOverdueBookings();

    if (expiredCount > 0) {
      logger.info(`Cron: expired ${expiredCount} overdue bookings`);
    }
  } catch (error) {
    logger.error("Cron: failed to check expired bookings", {
      error: error instanceof Error ? error.message : "Unknown",
    });
  }
}

/**
 * Sends payment reminders for bookings approaching their deadline.
 * - 6h reminder: when 5h30 to 6h30 remain before deadline
 * - 2h reminder: when 1h30 to 2h30 remain before deadline
 */
async function sendPaymentReminders(): Promise<void> {
  try {
    const now = new Date();

    const pendingBookings = await db
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

    for (const booking of pendingBookings) {
      const msRemaining = booking.paymentDeadline.getTime() - now.getTime();
      const hoursRemaining = msRemaining / (1000 * 60 * 60);

      const bookingReminders = sentReminders.get(booking.id) ?? new Set();

      // 6h reminder: between 5.5 and 6.5 hours remaining
      if (hoursRemaining >= 5.5 && hoursRemaining <= 6.5 && !bookingReminders.has("6h")) {
        await sendReminder(booking.clientId, "6h");
        bookingReminders.add("6h");
        sentReminders.set(booking.id, bookingReminders);
        logger.info("Payment reminder sent (6h)", { bookingId: booking.id });
      }

      // 2h reminder: between 1.5 and 2.5 hours remaining
      if (hoursRemaining >= 1.5 && hoursRemaining <= 2.5 && !bookingReminders.has("2h")) {
        await sendReminder(booking.clientId, "2h");
        bookingReminders.add("2h");
        sentReminders.set(booking.id, bookingReminders);
        logger.info("Payment reminder sent (2h)", { bookingId: booking.id });
      }
    }

    // Cleanup: remove entries for bookings no longer in pending list
    const pendingIds = new Set(pendingBookings.map((b) => b.id));
    for (const bookingId of sentReminders.keys()) {
      if (!pendingIds.has(bookingId)) {
        sentReminders.delete(bookingId);
      }
    }
  } catch (error) {
    logger.error("Cron: failed to send payment reminders", {
      error: error instanceof Error ? error.message : "Unknown",
    });
  }
}

/**
 * Sends a payment reminder WhatsApp message to the client.
 */
async function sendReminder(clientId: string, type: "6h" | "2h"): Promise<void> {
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
 * Starts the booking cron job (runs every 5 minutes).
 * Handles expiration checks and payment reminders.
 */
export function startBookingCron(): void {
  if (intervalId) return;

  logger.info("Booking cron started (interval: 5min) — expiration + payment reminders");

  const runCycle = async () => {
    await checkExpiredBookings();
    await sendPaymentReminders();
  };

  intervalId = setInterval(runCycle, INTERVAL_MS);

  // Run immediately on startup
  runCycle();
}

/**
 * Stops the booking cron job.
 */
export function stopBookingCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    sentReminders.clear();
    logger.info("Booking cron stopped");
  }
}
