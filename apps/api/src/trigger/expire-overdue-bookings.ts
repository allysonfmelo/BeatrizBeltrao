import { schedules } from "@trigger.dev/sdk/v3";
import { expireOverdueBookings } from "../modules/booking/booking.service.js";
import { logger } from "../lib/logger.js";

/**
 * Scheduled task that runs every 5 minutes to expire overdue bookings.
 * Replaces the previous setInterval-based cron in booking.cron.ts.
 */
export const expireOverdueBookingsTask = schedules.task({
  id: "expire-overdue-bookings",
  cron: "*/5 * * * *",
  run: async () => {
    logger.info("Running scheduled booking expiration check");

    const expiredCount = await expireOverdueBookings();

    return { expiredCount };
  },
});
