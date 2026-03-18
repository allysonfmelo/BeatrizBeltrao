import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { webhookRoutes } from "./modules/webhook/webhook.routes.js";
import { bookingRoutes } from "./modules/booking/booking.routes.js";
import { serviceRoutes } from "./modules/service/service.routes.js";
import { clientRoutes } from "./modules/client/client.routes.js";
import { env } from "./config/env.js";

export const app = new Hono();

// Global middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN,
  })
);

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// API routes
const api = new Hono();
api.route("/webhook", webhookRoutes);
api.route("/bookings", bookingRoutes);
api.route("/services", serviceRoutes);
api.route("/clients", clientRoutes);

app.route("/api/v1", api);
