import { Hono } from "hono";
import * as dashboardController from "./dashboard.controller.js";

export const dashboardRoutes = new Hono();

/** GET /api/v1/dashboard/metrics — Aggregated dashboard metrics */
dashboardRoutes.get("/metrics", dashboardController.getMetrics);
