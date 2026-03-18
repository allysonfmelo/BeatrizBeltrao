import { Hono } from "hono";

export const bookingRoutes = new Hono();

/** GET /api/v1/bookings -- List bookings */
bookingRoutes.get("/", async (c) => {
  // TODO: Implement list bookings
  return c.json({ data: [], meta: { total: 0, page: 1, limit: 20 } });
});

/** GET /api/v1/bookings/:id -- Get booking details */
bookingRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  // TODO: Implement get booking by ID
  return c.json({ data: null, error: "Not implemented" }, 501);
});
