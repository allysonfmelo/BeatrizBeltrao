import { evolutionWebhookSchema, extractTextFromWebhook, extractPhoneFromJid } from "@studio/shared/validators";
import { asaasWebhookSchema } from "@studio/shared/validators";
import * as sophiaService from "../sophia/sophia.service.js";
import * as paymentService from "../payment/payment.service.js";
import * as notificationService from "../notification/notification.service.js";
import { logger } from "../../lib/logger.js";
import { env } from "../../config/env.js";

/**
 * Processes an incoming Evolution API webhook (WhatsApp message).
 */
export async function handleEvolutionWebhook(body: unknown): Promise<void> {
  // Validate payload
  const parsed = evolutionWebhookSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Invalid Evolution webhook payload", {
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const payload = parsed.data;

  // Only process incoming messages (messages.upsert event)
  if (payload.event !== "messages.upsert") {
    logger.debug("Ignoring non-message Evolution event", { event: payload.event });
    return;
  }

  // Ignore messages sent by us
  if (payload.data.key.fromMe) {
    return;
  }

  // Extract phone number
  const phone = extractPhoneFromJid(payload.data.key.remoteJid);

  // Ignore group messages
  if (payload.data.key.remoteJid.includes("@g.us")) {
    logger.debug("Ignoring group message", { remoteJid: payload.data.key.remoteJid });
    return;
  }

  // Extract text content
  const text = extractTextFromWebhook(payload.data);

  if (!text) {
    // Non-text message — send polite response
    await notificationService.sendWhatsAppMessage(
      phone,
      "Oi! No momento consigo responder apenas mensagens de texto. Pode me escrever o que precisa? 💬"
    );
    logger.debug("Non-text message received, sent polite response", { phone });
    return;
  }

  // Process through Sophia
  logger.info("Processing WhatsApp message", { phone, messageLength: text.length });
  await sophiaService.processMessage(phone, text);
}

/**
 * Processes an incoming ASAAS webhook (payment notification).
 */
export async function handleAsaasWebhook(
  body: unknown,
  webhookToken?: string
): Promise<void> {
  // Validate token
  if (webhookToken && webhookToken !== env.ASAAS_WEBHOOK_TOKEN) {
    logger.warn("Invalid ASAAS webhook token");
    throw new Error("Invalid webhook token");
  }

  // Validate payload
  const parsed = asaasWebhookSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn("Invalid ASAAS webhook payload", {
      errors: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const { event, payment } = parsed.data;

  logger.info("ASAAS webhook received", {
    event,
    paymentId: payment.id,
    status: payment.status,
  });

  switch (event) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      await paymentService.processPaymentConfirmation(
        payment.id,
        payment.billingType
      );
      break;

    case "PAYMENT_OVERDUE":
    case "PAYMENT_DELETED":
      logger.info("Payment expired/deleted via ASAAS", { paymentId: payment.id });
      break;

    case "PAYMENT_REFUNDED":
      logger.info("Payment refunded via ASAAS", { paymentId: payment.id });
      break;

    default:
      logger.debug("Unhandled ASAAS event", { event });
  }
}
