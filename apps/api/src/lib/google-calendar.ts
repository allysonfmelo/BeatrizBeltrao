import { google } from "googleapis";
import { readFileSync } from "node:fs";
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

/** Loads Service Account credentials and returns an authenticated calendar client */
function getCalendarClient() {
  const keyPath = env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  if (!keyPath) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_PATH is not configured");
  }

  // Resolve relative paths from project root
  const absolutePath = keyPath.startsWith("/")
    ? keyPath
    : resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../", keyPath);

  const keyFile = JSON.parse(readFileSync(absolutePath, "utf8"));

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
