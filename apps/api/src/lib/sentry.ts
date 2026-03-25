import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const sentryDsn = env.SENTRY_DSN;
let isInitialized = false;

/**
 * Initializes Sentry monitoring for the API process.
 */
export function initSentry(): void {
  if (!sentryDsn || isInitialized) return;

  Sentry.init({
    dsn: sentryDsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    tracesSampleRate: 0.2,
  });

  isInitialized = true;
  logger.info("Sentry initialized");
}

/**
 * Captures an exception in Sentry with optional context metadata.
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!sentryDsn || !isInitialized) return;

  Sentry.withScope((scope) => {
    if (context) {
      scope.setContext("metadata", context);
    }
    Sentry.captureException(error);
  });
}

/**
 * Flushes Sentry's event queue before shutdown.
 */
export async function flushSentry(timeout = 2000): Promise<boolean> {
  if (!sentryDsn || !isInitialized) return true;
  return Sentry.flush(timeout);
}

/**
 * Indicates whether Sentry is configured and initialized.
 */
export function isSentryEnabled(): boolean {
  return Boolean(sentryDsn && isInitialized);
}
