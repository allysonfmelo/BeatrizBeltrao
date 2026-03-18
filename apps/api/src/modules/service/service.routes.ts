import { Hono } from "hono";

export const serviceRoutes = new Hono();

/** GET /api/v1/services -- List active services */
serviceRoutes.get("/", async (c) => {
  // TODO: Implement list services
  return c.json({ data: [] });
});
