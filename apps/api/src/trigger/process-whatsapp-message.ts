import { task } from "@trigger.dev/sdk/v3";
import { randomUUID } from "node:crypto";
import * as sophiaService from "../modules/sophia/sophia.service.js";
import { redis } from "../config/redis.js";
import { logger } from "../lib/logger.js";

const PHONE_LOCK_PREFIX = "sophia:processing-lock:";
// TTL must be > worst-case Sophia processMessage time (LLM + tools + DB writes).
const PHONE_LOCK_TTL_MS = 45_000;
// Total wait window before giving up on contention. ~10s with jittered backoff.
const LOCK_ACQUIRE_ATTEMPTS = 40;
const LOCK_RETRY_BASE_MS = 250;

async function acquirePhoneLock(phone: string, token: string): Promise<boolean> {
  const lockKey = `${PHONE_LOCK_PREFIX}${phone}`;
  for (let attempt = 0; attempt < LOCK_ACQUIRE_ATTEMPTS; attempt++) {
    const acquired = await redis.set(lockKey, token, "PX", PHONE_LOCK_TTL_MS, "NX");
    if (acquired === "OK") return true;
    // Jitter ±50ms to avoid thundering herd when many retries collide.
    const jitter = Math.floor((Math.random() - 0.5) * 100);
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_BASE_MS + jitter));
  }
  return false;
}

async function releasePhoneLock(phone: string, token: string): Promise<void> {
  const lockKey = `${PHONE_LOCK_PREFIX}${phone}`;
  const lua = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
  `;
  await redis.eval(lua, 1, lockKey, token);
}

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
  run: async (payload: { phone: string; combinedText: string; pushName?: string }) => {
    const { phone, combinedText, pushName } = payload;
    const lockToken = randomUUID();

    logger.info("Processing WhatsApp message via Sophia", {
      phone,
      messageLength: combinedText.length,
    });

    const lockAcquired = await acquirePhoneLock(phone, lockToken);
    if (!lockAcquired) {
      logger.warn("Could not acquire per-phone processing lock", { phone });
      throw new Error(`Phone processing lock busy for ${phone}`);
    }

    try {
      await sophiaService.processMessage(phone, combinedText, { pushName });
    } finally {
      await releasePhoneLock(phone, lockToken);
    }

    return { status: "processed", phone };
  },
});
