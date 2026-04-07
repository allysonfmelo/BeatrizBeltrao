import type { Context } from "hono";
import * as dashboardService from "./dashboard.service.js";

/**
 * GET /api/v1/dashboard/metrics — Returns aggregated dashboard metrics.
 */
export async function getMetrics(c: Context) {
  const month =
    c.req.query("month") ??
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return c.json({ data: null, error: "Parâmetro 'month' inválido. Use o formato YYYY-MM (ex: 2026-04)." }, 400);
  }

  try {
    const data = await dashboardService.getMetrics(month);
    return c.json({ data, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ data: null, error: message }, 500);
  }
}
