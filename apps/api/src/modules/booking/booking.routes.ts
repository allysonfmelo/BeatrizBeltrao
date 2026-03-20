import { Hono } from "hono";
import * as bookingController from "./booking.controller.js";

export const bookingRoutes = new Hono();

/** GET /api/v1/bookings — List bookings with filters */
bookingRoutes.get("/", bookingController.listBookings);

/** GET /api/v1/bookings/:id — Get booking details */
bookingRoutes.get("/:id", bookingController.getBooking);

/** POST /api/v1/bookings/:id/confirm-payment — Simulate payment (dev) */
bookingRoutes.post("/:id/confirm-payment", bookingController.confirmPayment);
