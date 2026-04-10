import { google } from "googleapis";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { captureException } from "./sentry.js";

/** Time slot representation */
export interface TimeSlot {
  start: string;
  end: string;
}

/** Calendar event data for creation */
export interface CalendarEventInput {
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
}

const TIMEZONE = "America/Sao_Paulo";

/**
 * Resolves the Google Service Account JSON credentials, trying multiple
 * strategies in order:
 *   1. GOOGLE_SERVICE_ACCOUNT_JSON env var (raw JSON string) — the most
 *      portable option, avoids filesystem path resolution entirely.
 *   2. Absolute path from GOOGLE_SERVICE_ACCOUNT_KEY_PATH.
 *   3. Relative path GOOGLE_SERVICE_ACCOUNT_KEY_PATH resolved against a
 *      list of candidate roots (mirroring the pattern used for
 *      service-reference.yaml in `service-reference.service.ts`):
 *        a) `process.cwd()` + keyPath  — most common in Docker (WORKDIR)
 *           and in Trigger.dev workers where additionalFiles land at cwd.
 *        b) fileURLToPath(new URL('.', import.meta.url)) + 2 ups — matches
 *           API container layout `/app/dist/lib/`.
 *        c) fileURLToPath(new URL('.', import.meta.url)) + 4 ups — matches
 *           local dev from `apps/api/src/lib/` to repo root.
 *        d) Absolute `/app/${keyPath}` — final fallback for Docker.
 * Throws with a helpful message listing all tried paths if none worked.
 */
let cachedKeyFile: { client_email: string; private_key: string } | null = null;

function loadServiceAccountKey(): { client_email: string; private_key: string } {
  if (cachedKeyFile) return cachedKeyFile;

  // Strategy 1: JSON directly in env var
  const rawJson = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        cachedKeyFile = {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
        };
        logger.info("Google Service Account loaded from GOOGLE_SERVICE_ACCOUNT_JSON env");
        return cachedKeyFile;
      }
      logger.warn("GOOGLE_SERVICE_ACCOUNT_JSON is set but missing client_email/private_key");
    } catch (err) {
      logger.warn("GOOGLE_SERVICE_ACCOUNT_JSON is set but not valid JSON", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Strategies 2 + 3: path-based loading
  const keyPath = env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      "Google credentials missing: set either GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_PATH"
    );
  }

  const moduleDir = fileURLToPath(new URL(".", import.meta.url));
  const candidates: string[] = keyPath.startsWith("/")
    ? [keyPath]
    : [
        resolve(process.cwd(), keyPath),
        resolve(moduleDir, "../../", keyPath), // /app/dist/lib → /app (API container)
        resolve(moduleDir, "../../../../", keyPath), // local dev apps/api/src/lib → repo root
        resolve("/app", keyPath),
      ];

  const triedAbsolute: string[] = [];
  for (const candidate of candidates) {
    triedAbsolute.push(candidate);
    try {
      statSync(candidate);
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        client_email?: string;
        private_key?: string;
      };
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error("Key file missing client_email or private_key");
      }
      cachedKeyFile = {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
      };
      logger.info("Google Service Account loaded from file", { path: candidate });
      return cachedKeyFile;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `Google credentials file not found. Tried: ${triedAbsolute.join(", ")}. ` +
      `Either set GOOGLE_SERVICE_ACCOUNT_JSON (preferred) or ensure the file at ` +
      `GOOGLE_SERVICE_ACCOUNT_KEY_PATH is accessible from the runtime.`
  );
}

/** Loads Service Account credentials and returns an authenticated calendar client */
function getCalendarClient() {
  const keyFile = loadServiceAccountKey();

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: keyFile.client_email,
      private_key: keyFile.private_key,
    },
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  return google.calendar({ version: "v3", auth });
}

/**
 * Gets busy intervals for a given date from Google Calendar.
 */
async function getBusySlots(date: string): Promise<TimeSlot[]> {
  const calendarId = env.GOOGLE_CALENDAR_ID ?? "primary";

  try {
    const calendar = getCalendarClient();

    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin: `${date}T00:00:00-03:00`,
        timeMax: `${date}T23:59:59-03:00`,
        timeZone: TIMEZONE,
        items: [{ id: calendarId }],
      },
    });

    const busy = response.data.calendars?.[calendarId]?.busy ?? [];
    return busy.map((slot) => ({
      start: slot.start ?? "",
      end: slot.end ?? "",
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google Calendar error";
    logger.error("Google Calendar freebusy error", { date, error: message });
    const wrappedError = new Error(`Google Calendar error: ${message}`);
    captureException(wrappedError, { source: "google-calendar.getBusySlots", date });
    throw wrappedError;
  }
}

/**
 * Returns available time slots for a given date and service duration.
 * Checks against Google Calendar freebusy data and business hours.
 */
export async function getAvailableSlots(
  date: string,
  durationMinutes: number,
  businessStart = "05:00",
  businessEnd = "22:00"
): Promise<TimeSlot[]> {
  const busySlots = await getBusySlots(date);
  const slots: TimeSlot[] = [];

  const startMinutes = timeToMinutes(businessStart);
  const endMinutes = timeToMinutes(businessEnd);
  const busyRanges = busySlots.map((s) => ({
    start: timeToMinutes(extractTime(s.start)),
    end: timeToMinutes(extractTime(s.end)),
  }));

  for (let m = startMinutes; m + durationMinutes <= endMinutes; m += 30) {
    const slotEnd = m + durationMinutes;
    const overlaps = busyRanges.some(
      (busy) => m < busy.end && slotEnd > busy.start
    );
    if (!overlaps) {
      slots.push({
        start: minutesToTime(m),
        end: minutesToTime(slotEnd),
      });
    }
  }

  return slots;
}

/**
 * Creates a calendar event and returns the event ID.
 */
export async function createEvent(event: CalendarEventInput): Promise<string> {
  const calendarId = env.GOOGLE_CALENDAR_ID ?? "primary";

  const startTime = event.startTime.length === 5 ? `${event.startTime}:00` : event.startTime.slice(0, 8);
  const endTime = event.endTime.length === 5 ? `${event.endTime}:00` : event.endTime.slice(0, 8);

  try {
    const calendar = getCalendarClient();

    const response = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: event.title,
        description: event.description,
        start: {
          dateTime: `${event.date}T${startTime}`,
          timeZone: TIMEZONE,
        },
        end: {
          dateTime: `${event.date}T${endTime}`,
          timeZone: TIMEZONE,
        },
        status: "confirmed",
      },
    });

    const eventId = response.data.id;
    if (!eventId) {
      throw new Error("Google Calendar did not return an event ID");
    }

    logger.info("Calendar event created", { eventId, title: event.title });
    return eventId;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google Calendar error";
    logger.error("Google Calendar create event error", { event: event.title, error: message });
    const wrappedError = new Error(`Google Calendar error: ${message}`);
    captureException(wrappedError, { source: "google-calendar.createEvent", title: event.title });
    throw wrappedError;
  }
}

/**
 * Deletes a calendar event by ID.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const calendarId = env.GOOGLE_CALENDAR_ID ?? "primary";

  try {
    const calendar = getCalendarClient();

    await calendar.events.delete({
      calendarId,
      eventId,
    });

    logger.info("Calendar event deleted", { eventId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google Calendar error";
    logger.error("Google Calendar delete event error", { eventId, error: message });
    const wrappedError = new Error(`Google Calendar error: ${message}`);
    captureException(wrappedError, { source: "google-calendar.deleteEvent", eventId });
    throw wrappedError;
  }
}

/**
 * Gets the public HTML link for a calendar event.
 */
export async function getEventLink(eventId: string): Promise<string> {
  const calendarId = env.GOOGLE_CALENDAR_ID ?? "primary";

  try {
    const calendar = getCalendarClient();

    const response = await calendar.events.get({
      calendarId,
      eventId,
    });

    return response.data.htmlLink ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Google Calendar error";
    logger.error("Google Calendar get event link error", { eventId, error: message });
    return "";
  }
}

/** Converts "HH:mm" to minutes since midnight */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Converts minutes since midnight to "HH:mm" */
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Extracts time portion from ISO datetime */
function extractTime(isoDateTime: string): string {
  const date = new Date(isoDateTime);
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}
