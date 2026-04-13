import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { captureException } from "./sentry.js";

const baseUrl = `${env.EVOLUTION_API_URL}/message`;
const chatBaseUrl = `${env.EVOLUTION_API_URL}/chat`;
const instance = env.EVOLUTION_INSTANCE_NAME;

/** Response from Evolution API after sending a message */
export interface EvolutionMessageResponse {
  key: {
    remoteJid: string;
    fromMe: boolean;
    id: string;
  };
  messageTimestamp: string;
  status: string;
}

interface EvolutionApiOptions {
  endpoint: string;
  body: Record<string, unknown>;
}

const DATA_URL_RE = /^data:[^;]+;base64,(.+)$/i;

/**
 * Evolution accepts media as either a public URL or raw base64.
 * Notification flows often provide a data URL (`data:...;base64,xxx`),
 * so we normalize to raw base64 before sending.
 */
function normalizeMediaInput(media: string): string {
  const trimmed = media.trim();
  const match = trimmed.match(DATA_URL_RE);
  return match ? match[1] : trimmed;
}

/** Makes a POST request to Evolution API v2 (chat namespace) */
async function evolutionChatPost({ endpoint, body }: EvolutionApiOptions): Promise<void> {
  const url = `${chatBaseUrl}/${endpoint}/${instance}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.warn("Evolution Chat API error (non-critical)", {
      endpoint,
      status: response.status,
      response: text,
    });
  }
}

/** Makes a POST request to Evolution API v2 */
async function evolutionPost<T = EvolutionMessageResponse>({ endpoint, body }: EvolutionApiOptions): Promise<T> {
  const url = `${baseUrl}/${endpoint}/${instance}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("Evolution API error", {
      endpoint,
      status: response.status,
      response: text,
    });
    const error = new Error(`Evolution API error: ${response.status} - ${text}`);
    captureException(error, { source: "evolution.api", endpoint, status: response.status });
    throw error;
  }

  const data = await response.json() as T;
  logger.debug("Evolution API message sent", { endpoint });
  return data;
}

/**
 * Sends a text message via WhatsApp through Evolution API v2.
 * @returns The Evolution message ID for tracking
 */
export async function sendTextMessage(phone: string, text: string): Promise<string> {
  const result = await evolutionPost({
    endpoint: "sendText",
    body: {
      number: phone,
      text,
    },
  });
  return result.key.id;
}

/**
 * Sends a document file via WhatsApp through Evolution API v2.
 * Used for sending HTML catalogs, PDFs, and other files.
 * @param mimetype - MIME type (e.g., "application/pdf", "text/html")
 */
export async function sendDocument(
  phone: string,
  media: string,
  fileName: string,
  mimetype: string,
  caption?: string
): Promise<string> {
  const normalizedMedia = normalizeMediaInput(media);
  const result = await evolutionPost({
    endpoint: "sendMedia",
    body: {
      number: phone,
      mediatype: "document",
      mimetype,
      media: normalizedMedia,
      fileName,
      caption: caption ?? "",
    },
  });
  return result.key.id;
}

/**
 * Sends an image via WhatsApp through Evolution API v2.
 */
export async function sendImage(
  phone: string,
  media: string,
  caption?: string
): Promise<string> {
  const normalizedMedia = normalizeMediaInput(media);
  const result = await evolutionPost({
    endpoint: "sendMedia",
    body: {
      number: phone,
      mediatype: "image",
      mimetype: "image/png",
      media: normalizedMedia,
      fileName: "image.png",
      caption: caption ?? "",
    },
  });
  return result.key.id;
}

/**
 * Sends a "composing" (typing) presence indicator via Evolution API v2.
 * Non-critical — errors are logged but not thrown.
 */
export async function sendTypingIndicator(phone: string): Promise<void> {
  await evolutionChatPost({
    endpoint: "updatePresence",
    body: {
      number: phone,
      presence: "composing",
    },
  });
}

/**
 * Calculates a realistic typing delay based on message length.
 * Simulates ~50ms per character, clamped between 1.5s and 5s.
 */
export function calculateTypingDelay(text: string): number {
  const ms = text.length * 50;
  return Math.max(1500, Math.min(ms, 5000));
}

/** Simple async delay utility */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
