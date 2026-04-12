import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { sendTextMessage, sendDocument, sendImage, sendTypingIndicator, calculateTypingDelay, delay } from "../../lib/evolution.js";
import { sendEmail } from "../../lib/resend.js";
import { db } from "../../config/supabase.js";
import { messages } from "@studio/db";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";
import { formatBRL } from "@studio/shared/utils";
import { getPdfCatalogPath, type CatalogTopic } from "../service/service-reference.service.js";

/** Messages shorter than this are never split */
const MIN_SPLIT_LENGTH = 200;
/** Soft character limit per chunk — paragraphs are grouped up to this size */
const SOFT_CHUNK_LIMIT = 600;
/** Maximum number of WhatsApp messages per Sophia response */
const MAX_CHUNKS = 3;
/** Patterns that indicate a structured block that must stay together */
const STRUCTURED_BLOCK_RE = /^(✨\s*(PRE-AGENDAMENTO|AGENDAMENTO)|DADOS DA CLIENTE|PAGAMENTO|Vou confirmar seus dados)/;

/** WhatsApp bold uses single asterisks; collapse markdown-style double asterisks. */
export function normalizeWhatsAppFormatting(content: string): string {
  let normalized = content;
  while (normalized.includes("**")) {
    normalized = normalized.replace(/\*\*/g, "*");
  }
  return normalized;
}

/**
 * Test phone prefix: conversations coming from numbers starting with this
 * prefix are treated as internal test scenarios. For these:
 *   - Sophia's replies are persisted to the DB as normal (so the test harness
 *     can poll the `messages` table and assemble the transcript).
 *   - The actual Evolution API send is SKIPPED, because these numbers don't
 *     exist on real WhatsApp and Evolution rejects them with HTTP 400
 *     ("jid exists: false"), which crashes the whole Trigger.dev run and
 *     prevents the DB log from being written.
 * The prefix "5500099" is not a valid Brazilian DDD (all start with 1–9),
 * so there is zero risk of colliding with real clients.
 */
const TEST_PHONE_PREFIX = "5500099";

function isTestPhone(phone: string): boolean {
  return phone.startsWith(TEST_PHONE_PREFIX);
}

/**
 * Splits a Sophia reply into natural WhatsApp-sized chunks.
 *
 * Rules:
 * - Short messages (< MIN_SPLIT_LENGTH) are never split.
 * - Splits on double-newline paragraph boundaries.
 * - Keeps bullet/list blocks together.
 * - Structured blocks (payment, booking confirmation) are never split.
 * - Caps at MAX_CHUNKS; excess is merged into the last chunk.
 */
export function splitSophiaMessage(content: string): string[] {
  const normalized = content.trim();
  if (!normalized) return [];
  if (normalized.length < MIN_SPLIT_LENGTH) return [normalized];

  // Structured blocks (payment, confirmation) stay as one
  if (STRUCTURED_BLOCK_RE.test(normalized)) return [normalized];

  const paragraphs = normalized
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) return [normalized];

  // Group paragraphs into chunks up to SOFT_CHUNK_LIMIT
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (!current) {
      current = para;
      continue;
    }

    const combined = `${current}\n\n${para}`;
    if (combined.length <= SOFT_CHUNK_LIMIT) {
      current = combined;
    } else {
      chunks.push(current);
      current = para;
    }
  }
  if (current) chunks.push(current);

  // Cap at MAX_CHUNKS — merge overflow into the last chunk
  if (chunks.length > MAX_CHUNKS) {
    const capped = chunks.slice(0, MAX_CHUNKS - 1);
    capped.push(chunks.slice(MAX_CHUNKS - 1).join("\n\n"));
    return capped;
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
  const normalizedContent = normalizeWhatsAppFormatting(content.trim());

  // Test phones: persist to DB but skip Evolution (prefix is not a real WhatsApp number).
  if (isTestPhone(phone)) {
    const fakeMsgId = `test_${Date.now()}`;
    if (conversationId) {
      await db.insert(messages).values({
        conversationId,
        role: "sophia",
        content: normalizedContent,
        messageType: "text",
        evolutionMessageId: fakeMsgId,
      });
    }
    logger.info("WhatsApp message persisted (test phone — Evolution send skipped)", { phone, conversationId });
    return fakeMsgId;
  }

  const evolutionMsgId = await sendTextMessage(phone, normalizedContent);

  if (conversationId) {
    await db.insert(messages).values({
      conversationId,
      role: "sophia",
      content: normalizedContent,
      messageType: "text",
      evolutionMessageId: evolutionMsgId,
    });
  }

  logger.info("WhatsApp message sent", { phone, conversationId });
  return evolutionMsgId;
}

/**
 * Sends Sophia reply with humanised delivery: typing indicator,
 * realistic delay, and natural message splitting.
 * Logs the full content as a single DB row.
 */
export async function sendSophiaMessage(
  phone: string,
  content: string,
  conversationId?: string
): Promise<string[]> {
  const trimmed = normalizeWhatsAppFormatting(content.trim());
  if (!trimmed) return [];

  const chunks = splitSophiaMessage(trimmed);

  // Test phones: persist to DB but skip Evolution send (number is not on real WhatsApp).
  // This keeps the test harness flow intact — the `messages` table still receives
  // Sophia's response, so the polling loop in sophia-test-client.ts sees it.
  if (isTestPhone(phone)) {
    const fakeMessageIds = chunks.map((_, i) => `test_${Date.now()}_${i}`);

    if (conversationId) {
      await db.insert(messages).values({
        conversationId,
        role: "sophia",
        content: trimmed,
        messageType: "text",
        evolutionMessageId: fakeMessageIds[0],
      });
    }

    logger.info("Sophia response persisted (test phone — Evolution send skipped)", {
      phone,
      conversationId,
      chunks: chunks.length,
    });

    return fakeMessageIds;
  }

  const messageIds: string[] = [];

  for (const chunk of chunks) {
    // 1. Show "typing…" indicator (fire-and-forget)
    await sendTypingIndicator(phone).catch(() => {});

    // 2. Simulate realistic typing delay
    await delay(calculateTypingDelay(chunk));

    // 3. Send the chunk
    const msgId = await sendTextMessage(phone, chunk);
    messageIds.push(msgId);
  }

  // 4. Log as single message in DB (full original content)
  if (conversationId) {
    await db.insert(messages).values({
      conversationId,
      role: "sophia",
      content: trimmed,
      messageType: "text",
      evolutionMessageId: messageIds[0],
    });
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
    await sendWhatsAppMessage(env.MAQUIADORA_PHONE, `${subject}\n\n${details}`);
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

/** Data needed for booking confirmation with images */
interface BookingConfirmationWithImagesData {
  clientName: string;
  serviceName: string;
  scheduledDate: string;
  scheduledTime: string;
  totalPrice: string;
  depositAmount: string;
  paymentMethod: string;
}

/**
 * Sends booking confirmation with branded images + informational text via WhatsApp.
 * Called after ASAAS payment is confirmed.
 */
export async function sendBookingConfirmationWithImages(
  phone: string,
  data: BookingConfirmationWithImagesData
): Promise<void> {
  const { resolve, join } = await import("node:path");

  const assetsDir = resolve(join(import.meta.dirname, "../../../../assets/confirmacao"));

  // 1. Send "Agendamento Confirmado" image with booking details
  const confirmImgBuffer = await readFile(join(assetsDir, "agendamento-confirmado.png"));
  const confirmMedia = `data:image/png;base64,${confirmImgBuffer.toString("base64")}`;

  const totalPrice = parseFloat(data.totalPrice).toFixed(2);
  const depositAmount = parseFloat(data.depositAmount).toFixed(2);
  const remainingAmount = (parseFloat(data.totalPrice) - parseFloat(data.depositAmount)).toFixed(2);

  const confirmCaption = [
    "✨ AGENDAMENTO CONFIRMADO",
    "",
    "DADOS DA CLIENTE",
    `NOME: ${data.clientName}`,
    `DATA: ${data.scheduledDate}`,
    `HORÁRIO: ${data.scheduledTime}`,
    "",
    "✨ AGENDAMENTO",
    `💳 Agendamento: R$${depositAmount}`,
    `💰 Pagamento no dia: R$${remainingAmount}`,
    "",
    "⏳ O pagamento do sinal foi confirmado com sucesso!",
    "Sua data está reservada 🤍",
  ].join("\n");

  await sendImage(phone, confirmMedia, confirmCaption);
  logger.info("Booking confirmation image step sent", {
    phone,
    step: "agendamento-confirmado",
    service: data.serviceName,
  });

  // 2. Send "Aviso" image with address + care instructions
  const avisoImgBuffer = await readFile(join(assetsDir, "aviso.png"));
  const avisoMedia = `data:image/png;base64,${avisoImgBuffer.toString("base64")}`;

  const avisoCaption = [
    "📍 *Nosso endereço:*",
    "Empresarial Quartier",
    "Estrada do Arraial, 2483",
    "Sala 1405, 14° andar",
    "Ponto de referência: em frente à Padaria Cidade Jardim.",
    "",
    "🅿️ *Estacionamento*: pago (segunda a sexta). A partir das 20h e sábados a partir das 12h fica gratuito. Pode estacionar na rua da frente também.",
    "",
    "📍 https://maps.app.goo.gl/R244R9ofY9CufA539",
    "",
    "🎨 *SOBRE MAQUIAGEM:*",
    "➡️ Vir com rosto limpo e sem protetor solar",
    "",
    "💇‍♀️ *SOBRE CABELO:*",
    "➡️ Cabelos limpos e secos, lavados apenas com shampoo (isso influencia na durabilidade do penteado)",
    "➡️ Não utilizar óleo, apenas protetor térmico",
    "➡️ Cacheadas: cabelos secos e limpos, finalizar apenas com geleia (não utilizar creme)",
    "",
    `Te espero, com carinho, ${data.clientName.split(" ")[0]}! 🤍`,
  ].join("\n");

  await sendImage(phone, avisoMedia, avisoCaption);
  logger.info("Booking confirmation image step sent", {
    phone,
    step: "aviso",
    service: data.serviceName,
  });

  logger.info("Booking confirmation images sent", { phone, service: data.serviceName });
}
