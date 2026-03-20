import { sendTextMessage } from "../../lib/evolution.js";
import { sendEmail } from "../../lib/resend.js";
import { db } from "../../config/supabase.js";
import { messages } from "@studio/db";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";
import { formatBRL } from "@studio/shared/utils";

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
