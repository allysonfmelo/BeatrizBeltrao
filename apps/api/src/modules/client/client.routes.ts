import { Hono } from "hono";

export const clientRoutes = new Hono();

/** GET /api/v1/clients -- List clients */
clientRoutes.get("/", async (c) => {
  // TODO: Implement list clients
  return c.json({ data: [], meta: { total: 0, page: 1, limit: 20 } });
});
