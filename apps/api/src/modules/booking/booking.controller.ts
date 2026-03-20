import type { Context } from "hono";
import * as bookingService from "./booking.service.js";
import { logger } from "../../lib/logger.js";

/**
 * GET /api/v1/bookings — List bookings with optional filters.
 */
export async function listBookings(c: Context) {
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const status = c.req.query("status");
  const page = c.req.query("page") ? Number(c.req.query("page")) : undefined;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const result = await bookingService.listBookings({
    dateFrom,
    dateTo,
    status,
    page,
    limit,
  });

  return c.json(result);
}

/**
 * GET /api/v1/bookings/:id — Get booking details.
 */
export async function getBooking(c: Context) {
  const id = c.req.param("id") as string;
  const booking = await bookingService.findById(id);

  if (!booking) {
    return c.json({ data: null, error: "Booking não encontrado" }, 404);
  }

  return c.json({ data: booking });
}

/**
 * POST /api/v1/bookings/:id/confirm-payment — Simulate payment confirmation (dev).
 */
export async function confirmPayment(c: Context) {
  const id = c.req.param("id") as string;

  try {
    const booking = await bookingService.confirmBooking(id);
    logger.info("Payment confirmed via dev endpoint", { bookingId: id });
    return c.json({ data: booking });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to confirm payment", { bookingId: id, error: message });
    return c.json({ data: null, error: message }, 400);
  }
}
