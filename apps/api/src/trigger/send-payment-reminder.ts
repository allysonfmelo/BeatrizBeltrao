import { schedules } from "@trigger.dev/sdk/v3";
import { redis } from "../config/redis.js";
import * as bookingService from "../modules/booking/booking.service.js";
import { logger } from "../lib/logger.js";

/** Redis key prefix for tracking sent reminders */
const REMINDER_PREFIX = "reminder:";

/**
 * Scheduled task that runs every 5 minutes to send payment reminders.
 * Sends reminders at 6h and 2h before payment deadline.
 * Replaces the previous setInterval-based cron in booking.cron.ts.
 *
 * Uses Redis to track sent reminders, surviving server restarts.
 */
export const sendPaymentReminderTask = schedules.task({
  id: "send-payment-reminder",
  cron: "*/5 * * * *",
  run: async () => {
    const now = new Date();
    let remindersSent = 0;

    const pendingBookings = await bookingService.getPendingBookingsForReminders();

    for (const booking of pendingBookings) {
      const msRemaining = booking.paymentDeadline.getTime() - now.getTime();
      const hoursRemaining = msRemaining / (1000 * 60 * 60);
      const reminderKey = `${REMINDER_PREFIX}${booking.id}`;

      // 6h reminder: between 5.5 and 6.5 hours remaining
      if (hoursRemaining >= 5.5 && hoursRemaining <= 6.5) {
        const alreadySent = await redis.sismember(reminderKey, "6h");
        if (!alreadySent) {
          await bookingService.sendPaymentReminderToClient(booking.clientId, "6h");
          await redis.sadd(reminderKey, "6h");
          await redis.expire(reminderKey, 86400); // TTL 24h
          remindersSent++;
          logger.info("Payment reminder sent (6h)", { bookingId: booking.id });
        }
      }

      // 2h reminder: between 1.5 and 2.5 hours remaining
      if (hoursRemaining >= 1.5 && hoursRemaining <= 2.5) {
        const alreadySent = await redis.sismember(reminderKey, "2h");
        if (!alreadySent) {
          await bookingService.sendPaymentReminderToClient(booking.clientId, "2h");
          await redis.sadd(reminderKey, "2h");
          await redis.expire(reminderKey, 86400); // TTL 24h
          remindersSent++;
          logger.info("Payment reminder sent (2h)", { bookingId: booking.id });
        }
      }
    }

    return { remindersSent, bookingsChecked: pendingBookings.length };
  },
});
