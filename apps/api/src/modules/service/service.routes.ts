import { Hono } from "hono";
import { listServices } from "./service.controller.js";

export const serviceRoutes = new Hono();

/** GET /api/v1/services — List active services */
serviceRoutes.get("/", listServices);
