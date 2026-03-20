import { env } from "../config/env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = env.NODE_ENV === "production" ? "info" : "debug";

/**
 * Masks CPF patterns in text for secure logging.
 * Matches formats: 12345678900, 123.456.789-00
 */
function maskSensitiveData(text: string): string {
  return text.replace(
    /\b(\d{3})[\.]?(\d{3})[\.]?(\d{3})[-]?(\d{2})\b/g,
    "$1.***.***-$4"
  );
}

function formatMessage(level: LogLevel, message: string, context?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const masked = maskSensitiveData(message);
  const base = `[${timestamp}] [${level.toUpperCase()}] ${masked}`;
  if (context) {
    const maskedContext = maskSensitiveData(JSON.stringify(context));
    return `${base} ${maskedContext}`;
  }
  return base;
}

/** Structured logger with CPF auto-masking and level filtering */
export const logger = {
  /** Debug-level log (suppressed in production) */
  debug(message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.debug) {
      console.debug(formatMessage("debug", message, context));
    }
  },

  /** Info-level log */
  info(message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.info) {
      console.info(formatMessage("info", message, context));
    }
  },

  /** Warning-level log */
  warn(message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.warn) {
      console.warn(formatMessage("warn", message, context));
    }
  },

  /** Error-level log */
  error(message: string, context?: Record<string, unknown>): void {
    console.error(formatMessage("error", message, context));
  },
};
