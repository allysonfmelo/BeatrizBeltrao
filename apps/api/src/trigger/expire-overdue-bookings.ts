import { schedules } from "@trigger.dev/sdk/v3";
import { expireOverdueBookings } from "../modules/booking/booking.service.js";
import { logger } from "../lib/logger.js";

/**
 * Scheduled task that runs every 5 minutes to expire overdue bookings.
 * Replaces the previous setInterval-based cron in booking.cron.ts.
 */
export const expireOverdueBookingsTask = schedules.task({
  id: "expire-overdue-bookings",
  cron: {
    pattern: "*/15 5-23 * * *",
    timezone: "America/Sao_Paulo",
  },
  run: async () => {
    logger.info("Running scheduled booking expiration check");

    const expiredCount = await expireOverdueBookings();

    return { expiredCount };
  },
});
