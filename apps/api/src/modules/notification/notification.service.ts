import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { sendTextMessage, sendDocument, sendImage } from "../../lib/evolution.js";
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
 * Sends Sophia reply as a single message and logs it.
 * This is used only by the Sophia conversational flow.
 */
export async function sendSophiaMessage(
  phone: string,
  content: string,
  conversationId?: string
): Promise<string[]> {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const evolutionMsgId = await sendTextMessage(phone, trimmed);
  const messageIds = [evolutionMsgId];

  if (conversationId) {
    await db.insert(messages).values({
      conversationId,
      role: "sophia",
      content: trimmed,
      messageType: "text",
      evolutionMessageId: evolutionMsgId,
    });
  }

  logger.info("Sophia WhatsApp response sent", {
    phone,
    conversationId,
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

  logger.info("Booking confirmation images sent", { phone, service: data.serviceName });
}
