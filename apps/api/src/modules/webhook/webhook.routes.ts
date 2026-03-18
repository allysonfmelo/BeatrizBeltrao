import { Hono } from "hono";

export const webhookRoutes = new Hono();

/** POST /api/v1/webhook/evolution -- Receive WhatsApp messages */
webhookRoutes.post("/evolution", async (c) => {
  // TODO: Implement Evolution API webhook handler
  return c.json({ status: "received" });
});

/** POST /api/v1/webhook/asaas -- Receive payment notifications */
webhookRoutes.post("/asaas", async (c) => {
  // TODO: Implement ASAAS webhook handler
  return c.json({ status: "processed" });
});
