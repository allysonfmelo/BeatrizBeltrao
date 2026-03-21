import { task } from "@trigger.dev/sdk/v3";
import * as sophiaService from "../modules/sophia/sophia.service.js";
import { logger } from "../lib/logger.js";

/**
 * Processes a combined WhatsApp message through Sophia.
 * Uses concurrency control to ensure only 1 processing per phone at a time.
 */
export const processWhatsappMessage = task({
  id: "process-whatsapp-message",
  queue: {
    name: "whatsapp-processing",
    concurrencyLimit: 10,
  },
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: { phone: string; combinedText: string }) => {
    const { phone, combinedText } = payload;

    logger.info("Processing WhatsApp message via Sophia", {
      phone,
      messageLength: combinedText.length,
    });

    await sophiaService.processMessage(phone, combinedText);

    return { status: "processed", phone };
  },
});
