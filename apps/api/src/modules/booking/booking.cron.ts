import { expireOverdueBookings } from "./booking.service.js";
import * as paymentService from "../payment/payment.service.js";
import { logger } from "../../lib/logger.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let intervalId: ReturnType<typeof setInterval> | null = null;

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
 * Starts the booking expiration cron job (runs every 5 minutes).
 */
export function startBookingCron(): void {
  if (intervalId) return;

  logger.info("Booking expiration cron started (interval: 5min)");
  intervalId = setInterval(checkExpiredBookings, INTERVAL_MS);

  // Run immediately on startup
  checkExpiredBookings();
}

/**
 * Stops the booking expiration cron job.
 */
export function stopBookingCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Booking expiration cron stopped");
  }
}
