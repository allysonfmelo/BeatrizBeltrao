import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { startBookingCron } from "./modules/booking/booking.cron.js";

const port = env.PORT;

logger.info(`Starting server on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

// Start background jobs
startBookingCron();

logger.info(`Server running on http://localhost:${port}`);
