import * as googleCalendar from "../../lib/google-calendar.js";
import { logger } from "../../lib/logger.js";

/** Booking data needed for calendar event creation */
interface BookingWithDetails {
  id: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  scheduledDate: string;
  scheduledTime: string;
  endTime: string;
}

/**
 * Checks if a specific time slot is available on a given date.
 */
export async function isSlotAvailable(
  date: string,
  startTime: string,
  durationMinutes: number
): Promise<boolean> {
  const slots = await googleCalendar.getAvailableSlots(date, durationMinutes);
  return slots.some((slot) => slot.start === startTime);
}

/**
 * Gets all available time slots for a date and service duration.
 */
export async function getAvailableSlots(
  date: string,
  durationMinutes: number
): Promise<googleCalendar.TimeSlot[]> {
  return googleCalendar.getAvailableSlots(date, durationMinutes);
}

/**
 * Creates a Google Calendar event for a confirmed booking.
 * @returns The Google Calendar event ID
 */
export async function createBookingEvent(
  booking: BookingWithDetails
): Promise<string> {
  const eventId = await googleCalendar.createEvent({
    title: `${booking.serviceName} — ${booking.clientName}`,
    description: [
      `Cliente: ${booking.clientName}`,
      `Telefone: ${booking.clientPhone}`,
      `Serviço: ${booking.serviceName}`,
      `Booking ID: ${booking.id}`,
    ].join("\n"),
    date: booking.scheduledDate,
    startTime: booking.scheduledTime,
    endTime: booking.endTime,
  });

  logger.info("Calendar event created for booking", {
    bookingId: booking.id,
    eventId,
  });

  return eventId;
}

/**
 * Deletes a calendar event when a booking is cancelled.
 */
export async function deleteBookingEvent(eventId: string): Promise<void> {
  await googleCalendar.deleteEvent(eventId);
  logger.info("Calendar event deleted", { eventId });
}
