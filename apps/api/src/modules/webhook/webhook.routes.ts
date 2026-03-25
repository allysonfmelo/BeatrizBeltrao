import { Hono } from "hono";
import * as webhookController from "./webhook.controller.js";

export const webhookRoutes = new Hono();

/** POST /api/v1/webhook/evolution — Receive WhatsApp messages */
webhookRoutes.post("/evolution", webhookController.handleEvolution);
/** POST /api/v1/webhook/evolution/:event — Compatibility when "Webhook by Events" is enabled */
webhookRoutes.post("/evolution/:event", webhookController.handleEvolution);

/** POST /api/v1/webhook/asaas — Receive payment notifications */
webhookRoutes.post("/asaas", webhookController.handleAsaas);
