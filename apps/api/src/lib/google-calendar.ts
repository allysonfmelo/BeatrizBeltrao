import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { captureException } from "./sentry.js";

const execFileAsync = promisify(execFile);

const calendarId = env.GOOGLE_CALENDAR_ID ?? "primary";

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

/** Runs a gws CLI command and returns parsed JSON output */
async function gwsCommand(args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync("gws", args, {
      timeout: 15000,
    });
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown gws error";
    logger.error("Google Workspace CLI error", { args, error: message });
    const wrappedError = new Error(`Google Calendar error: ${message}`);
    captureException(wrappedError, { source: "google-calendar.gws", args });
    throw wrappedError;
  }
}

/**
 * Gets busy intervals for a given date from Google Calendar.
 */
async function getBusySlots(date: string): Promise<TimeSlot[]> {
  const timeMin = `${date}T00:00:00Z`;
  const timeMax = `${date}T23:59:59Z`;

  const result = await gwsCommand([
    "calendar",
    "freebusy",
    "query",
    "--json",
    JSON.stringify({
      timeMin,
      timeMax,
      timeZone: "America/Sao_Paulo",
      items: [{ id: calendarId }],
    }),
  ]);

  const data = result as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  };

  return data.calendars?.[calendarId]?.busy ?? [];
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
  const startTime = event.startTime.length === 5 ? `${event.startTime}:00` : event.startTime.slice(0, 8);
  const endTime = event.endTime.length === 5 ? `${event.endTime}:00` : event.endTime.slice(0, 8);
  const startDateTime = `${event.date}T${startTime}`;
  const endDateTime = `${event.date}T${endTime}`;

  const result = await gwsCommand([
    "calendar",
    "events",
    "insert",
    "--params",
    JSON.stringify({
      calendarId,
    }),
    "--json",
    JSON.stringify({
      summary: event.title,
      description: event.description,
      start: {
        dateTime: startDateTime,
        timeZone: "America/Sao_Paulo",
      },
      end: {
        dateTime: endDateTime,
        timeZone: "America/Sao_Paulo",
      },
      status: "confirmed",
    }),
  ]);

  const data = result as { id?: string; htmlLink?: string };

  if (!data.id) {
    throw new Error("Google Calendar did not return an event ID");
  }

  logger.info("Calendar event created", { eventId: data.id, title: event.title });
  return data.id;
}

/**
 * Deletes a calendar event by ID.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  await gwsCommand([
    "calendar",
    "events",
    "delete",
    "--params",
    JSON.stringify({
      calendarId,
      eventId,
    }),
  ]);

  logger.info("Calendar event deleted", { eventId });
}

/**
 * Gets the public HTML link for a calendar event.
 */
export async function getEventLink(eventId: string): Promise<string> {
  const result = await gwsCommand([
    "calendar",
    "events",
    "get",
    "--params",
    JSON.stringify({
      calendarId,
      eventId,
    }),
  ]);

  const data = result as { htmlLink?: string };
  return data.htmlLink ?? "";
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
