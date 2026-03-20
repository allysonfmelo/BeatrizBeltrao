import type { Context } from "hono";
import * as serviceService from "./service.service.js";

/**
 * GET /api/v1/services — List all active services.
 */
export async function listServices(c: Context) {
  const data = await serviceService.listActive();
  return c.json({ data });
}
