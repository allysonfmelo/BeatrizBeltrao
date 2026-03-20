import { eq, and, lt, desc, gte, lte } from "drizzle-orm";
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
 * Confirms a booking: updates status, creates Google Calendar event.
 */
export async function confirmBooking(bookingId: string, paymentMethod?: string) {
  const booking = await findById(bookingId);
  if (!booking) throw new Error("Booking não encontrado");
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

  logger.info("Booking confirmed", { bookingId, eventId, paymentMethod });

  // Send notifications
  try {
    await notificationService.sendBookingConfirmationEmail(client.email, {
      clientName: client.fullName,
      serviceName: service.name,
      scheduledDate: booking.scheduledDate,
      scheduledTime: booking.scheduledTime,
      totalPrice: parseFloat(booking.totalPrice) * 100,
      depositAmount: parseFloat(booking.depositAmount) * 100,
    });

    await notificationService.notifyMaquiadora(
      "Novo Agendamento Confirmado",
      `Cliente: ${client.fullName}\nTelefone: ${client.phone}\nServiço: ${service.name}\nData: ${booking.scheduledDate}\nHorário: ${booking.scheduledTime}`
    );
  } catch (error) {
    logger.error("Failed to send confirmation notifications", {
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
  const booking = await findById(bookingId);
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

  const data = await db
    .select()
    .from(bookings)
    .where(where)
    .orderBy(desc(bookings.scheduledDate))
    .limit(limit)
    .offset(offset);

  return { data, meta: { page, limit, total: data.length } };
}

/**
 * Finds a booking by ID.
 */
export async function findById(id: string) {
  const result = await db.query.bookings.findFirst({
    where: eq(bookings.id, id),
  });
  return result ?? null;
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
