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
