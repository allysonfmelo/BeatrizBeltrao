import type { Context } from "hono";
import * as clientService from "./client.service.js";

/**
 * GET /api/v1/clients — List clients with optional search and pagination.
 */
export async function listClients(c: Context) {
  const search = c.req.query("search");
  const page = Number(c.req.query("page") ?? 1);
  const limit = Number(c.req.query("limit") ?? 20);

  const result = await clientService.list({ search, page, limit });
  return c.json(result);
}

/**
 * GET /api/v1/clients/:id/bookings — List booking history for a client.
 */
export async function getClientBookings(c: Context) {
  const clientId = c.req.param("id") as string;
  const status = c.req.query("status");
  const dateFrom = c.req.query("date_from");
  const dateTo = c.req.query("date_to");
  const page = Number(c.req.query("page") ?? 1);
  const limit = Number(c.req.query("limit") ?? 20);

  const client = await clientService.findById(clientId);
  if (!client) {
    return c.json({ data: null, error: "Cliente não encontrada" }, 404);
  }

  const result = await clientService.listBookingsByClient(clientId, {
    status,
    dateFrom,
    dateTo,
    page,
    limit,
  });

  return c.json(result);
}
