import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { sendTextMessage, sendDocument } from "../../lib/evolution.js";
import { sendEmail } from "../../lib/resend.js";
import { db } from "../../config/supabase.js";
import { messages } from "@studio/db";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";
import { formatBRL } from "@studio/shared/utils";
import { getPdfCatalogPath, type CatalogTopic } from "../service/service-reference.service.js";

const MAX_LINES_PER_SOPHIA_MESSAGE = 2;

/**
 * Splits Sophia replies into short chunks with max 2 lines each.
 */
export function splitSophiaMessage(content: string): string[] {
  const normalized = content.trim();
  if (!normalized) return [];

  const sentenceSegments = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .map((segment) => segment.trim())
        .filter(Boolean)
    );

  if (sentenceSegments.length === 0) {
    return [normalized];
  }

  const chunks: string[] = [];
  for (let i = 0; i < sentenceSegments.length; i += MAX_LINES_PER_SOPHIA_MESSAGE) {
    chunks.push(sentenceSegments.slice(i, i + MAX_LINES_PER_SOPHIA_MESSAGE).join("\n"));
  }

  return chunks;
}

/**
 * Sends a WhatsApp message and logs it in the messages table.
 */
export async function sendWhatsAppMessage(
  phone: string,
  content: string,
  conversationId?: string
): Promise<string> {
  const evolutionMsgId = await sendTextMessage(phone, content);

  if (conversationId) {
    await db.insert(messages).values({
      conversationId,
      role: "sophia",
      content,
      messageType: "text",
      evolutionMessageId: evolutionMsgId,
    });
  }

  logger.info("WhatsApp message sent", { phone, conversationId });
  return evolutionMsgId;
}

/**
 * Sends Sophia replies in short chunks and logs every outbound chunk.
 * This is used only by the Sophia conversational flow.
 */
export async function sendSophiaMessage(
  phone: string,
  content: string,
  conversationId?: string
): Promise<string[]> {
  const chunks = splitSophiaMessage(content);
  const messageIds: string[] = [];

  for (const chunk of chunks) {
    const evolutionMsgId = await sendTextMessage(phone, chunk);
    messageIds.push(evolutionMsgId);

    if (conversationId) {
      await db.insert(messages).values({
        conversationId,
        role: "sophia",
        content: chunk,
        messageType: "text",
        evolutionMessageId: evolutionMsgId,
      });
    }
  }

  logger.info("Sophia WhatsApp response sent", {
    phone,
    conversationId,
    chunks: chunks.length,
  });

  return messageIds;
}

/**
 * Sends a service catalog PDF by topic and logs the outgoing document message.
 */
export async function sendWhatsAppServicePdf(
  phone: string,
  topic: CatalogTopic,
  conversationId?: string,
  caption?: string
): Promise<string> {
  const pdfPath = getPdfCatalogPath(topic);
  if (!pdfPath) {
    throw new Error(`Catálogo PDF não encontrado para o tema: ${topic}`);
  }

  const fileBuffer = await readFile(pdfPath);
  const media = `data:application/pdf;base64,${fileBuffer.toString("base64")}`;
  const fileName = basename(pdfPath);

  const evolutionMsgId = await sendDocument(
    phone,
    media,
    fileName,
    "application/pdf",
    caption
  );

  if (conversationId) {
    await db.insert(messages).values({
      conversationId,
      role: "sophia",
      content: caption ?? `Catálogo PDF (${topic})`,
      messageType: "document",
      evolutionMessageId: evolutionMsgId,
    });
  }

  logger.info("WhatsApp PDF sent", { phone, topic, conversationId });
  return evolutionMsgId;
}

/** Data needed for booking confirmation email */
interface BookingConfirmationData {
  clientName: string;
  serviceName: string;
  scheduledDate: string;
  scheduledTime: string;
  totalPrice: number;
  depositAmount: number;
}

/**
 * Sends a booking confirmation email to the client.
 */
export async function sendBookingConfirmationEmail(
  to: string,
  data: BookingConfirmationData
): Promise<void> {
  const subject = `Agendamento Confirmado — Studio Beatriz Beltrão`;
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #d4a373;">✨ Agendamento Confirmado!</h2>
      <p>Olá, <strong>${data.clientName}</strong>!</p>
      <p>Seu agendamento foi confirmado com sucesso:</p>
      <table style="border-collapse: collapse; width: 100%; margin: 16px 0;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Serviço</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.serviceName}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Data</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.scheduledDate}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Horário</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${data.scheduledTime}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Valor Total</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${formatBRL(data.totalPrice)}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Sinal Pago</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${formatBRL(data.depositAmount)}</td></tr>
      </table>
      <p>Nos vemos em breve! 💄</p>
      <p style="color: #888; font-size: 12px;">Studio Beatriz Beltrão — Maquiagem & Penteados</p>
    </div>
  `;

  await sendEmail(to, subject, html);
  logger.info("Booking confirmation email sent", { to });
}

/**
 * Notifies the client about a booking cancellation via WhatsApp.
 */
export async function notifyBookingCancelled(
  phone: string,
  conversationId: string | undefined,
  details: { serviceName: string; scheduledDate: string; reason?: string }
): Promise<void> {
  const reason = details.reason ? `\nMotivo: ${details.reason}` : "";
  const content = `Seu agendamento de ${details.serviceName} para ${details.scheduledDate} foi cancelado.${reason}\n\nSe quiser agendar novamente, é só me chamar! ✨`;

  await sendWhatsAppMessage(phone, content, conversationId);
}

/**
 * Notifies Beatriz (the makeup artist) about a booking event via WhatsApp and email.
 */
export async function notifyMaquiadora(
  subject: string,
  details: string
): Promise<void> {
  if (env.MAQUIADORA_PHONE) {
    await sendTextMessage(env.MAQUIADORA_PHONE, `${subject}\n\n${details}`);
  }

  if (env.MAQUIADORA_EMAIL) {
    const html = `
      <div style="font-family: sans-serif; max-width: 600px;">
        <h3>${subject}</h3>
        <p style="white-space: pre-line;">${details}</p>
      </div>
    `;
    await sendEmail(env.MAQUIADORA_EMAIL, subject, html);
  }

  logger.info("Maquiadora notified", { subject });
}
