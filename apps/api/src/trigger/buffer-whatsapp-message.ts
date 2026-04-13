import { task } from "@trigger.dev/sdk/v3";
import { redis, BUFFER_PREFIX } from "../config/redis.js";
import { processWhatsappMessage } from "./process-whatsapp-message.js";
import { logger } from "../lib/logger.js";

/**
 * Buffer task that executes after 15s of inactivity.
 * Collects all accumulated messages from Redis, concatenates them,
 * and triggers Sophia processing with the combined text.
 */
export const bufferWhatsappMessage = task({
  id: "buffer-whatsapp-message",
  retry: {
    maxAttempts: 3,
  },
  run: async (payload: { phone: string; pushName?: string; modelOverride?: string }) => {
    const { phone, pushName, modelOverride } = payload;
    const bufferKey = `${BUFFER_PREFIX}${phone}`;

    // Fetch all buffered messages (RPUSH preserves chronological order)
    const bufferedMessages = await redis.lrange(bufferKey, 0, -1);

    if (bufferedMessages.length === 0) {
      logger.info("Buffer empty, skipping processing", { phone });
      return { status: "empty", phone };
    }

    // Clear the buffer
    await redis.del(bufferKey);

    // Concatenate messages in chronological order
    const combinedText = bufferedMessages.join("\n");

    logger.info("Buffer flushed, processing combined message", {
      phone,
      messageCount: bufferedMessages.length,
      combinedLength: combinedText.length,
    });

    // Trigger Sophia processing with combined text
    await processWhatsappMessage.triggerAndWait({
      phone,
      combinedText,
      pushName,
      modelOverride,
    });

    return {
      status: "processed",
      phone,
      messageCount: bufferedMessages.length,
    };
  },
});
