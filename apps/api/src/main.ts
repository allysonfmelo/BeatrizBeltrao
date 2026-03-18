import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./config/env.js";

const port = env.PORT;

console.log(`Starting server on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Server running on http://localhost:${port}`);
