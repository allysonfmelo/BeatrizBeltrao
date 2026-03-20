import type { Context } from "hono";
import * as webhookService from "./webhook.service.js";
import { logger } from "../../lib/logger.js";

/**
 * POST /api/v1/webhook/evolution — Handle incoming WhatsApp messages.
 */
export async function handleEvolution(c: Context) {
  try {
    const body = await c.req.json();
    await webhookService.handleEvolutionWebhook(body);
    return c.json({ status: "received" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Evolution webhook processing failed", { error: message });
    // Always return 200 to prevent retries from Evolution API
    return c.json({ status: "error", error: message });
  }
}

/**
 * POST /api/v1/webhook/asaas — Handle payment notifications from ASAAS.
 */
export async function handleAsaas(c: Context) {
  try {
    const body = await c.req.json();
    const token = c.req.header("asaas-access-token") ?? c.req.query("token");
    await webhookService.handleAsaasWebhook(body, token ?? undefined);
    return c.json({ status: "processed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("ASAAS webhook processing failed", { error: message });
    return c.json({ status: "error", error: message }, 400);
  }
}
