import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { captureException } from "./sentry.js";

const baseUrl = `${env.EVOLUTION_API_URL}/message`;
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
  const result = await evolutionPost({
    endpoint: "sendMedia",
    body: {
      number: phone,
      mediatype: "document",
      mimetype,
      media,
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
  const result = await evolutionPost({
    endpoint: "sendMedia",
    body: {
      number: phone,
      mediatype: "image",
      mimetype: "image/png",
      media,
      fileName: "image.png",
      caption: caption ?? "",
    },
  });
  return result.key.id;
}
