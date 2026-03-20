import { Hono } from "hono";
import { listClients } from "./client.controller.js";

export const clientRoutes = new Hono();

/** GET /api/v1/clients — List clients with search and pagination */
clientRoutes.get("/", listClients);
