import { task } from "@trigger.dev/sdk/v3";
import * as notificationService from "../modules/notification/notification.service.js";
import { logger } from "../lib/logger.js";

/**
 * Sends a WhatsApp message with automatic retry and rate limiting.
 */
export const sendWhatsappMessage = task({
  id: "send-whatsapp-message",
  queue: {
    name: "whatsapp-sending",
    concurrencyLimit: 5,
  },
  retry: {
    maxAttempts: 3,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 15000,
    factor: 2,
  },
  run: async (payload: {
    phone: string;
    message: string;
    conversationId?: string;
  }) => {
    const { phone, message, conversationId } = payload;

    logger.info("Sending WhatsApp message via Trigger.dev", { phone });

    const messageId = await notificationService.sendWhatsAppMessage(
      phone,
      message,
      conversationId
    );

    return { status: "sent", phone, messageId };
  },
});
