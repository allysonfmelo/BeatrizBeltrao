import Redis from "ioredis";
import { env } from "./env.js";
import { logger } from "../lib/logger.js";

/** Redis client singleton for message buffering */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on("error", (err) => {
  logger.error("Redis connection error", { error: err.message });
});

redis.on("connect", () => {
  logger.info("Redis connected");
});

/** Buffer key prefix for WhatsApp message accumulation */
export const BUFFER_PREFIX = "buffer:";

/** TTL in seconds for buffer safety net (5 minutes) */
export const BUFFER_TTL = 300;
