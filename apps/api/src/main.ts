import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

const port = env.PORT;

logger.info(`Starting server on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

// Background jobs are now managed by Trigger.dev
// Run `npx trigger.dev@latest dev` to start the task runner
logger.info(`Server running on http://localhost:${port}`);
logger.info("Background tasks managed by Trigger.dev — run 'pnpm trigger:dev' to start");
