import { Hono } from "hono";
import { listClients, getClientBookings } from "./client.controller.js";

export const clientRoutes = new Hono();

/** GET /api/v1/clients — List clients with search and pagination */
clientRoutes.get("/", listClients);

/** GET /api/v1/clients/:id/bookings — List booking history for a client */
clientRoutes.get("/:id/bookings", getClientBookings);
