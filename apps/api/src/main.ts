import { serve } from "@hono/node-server";
import process from "node:process";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { initSentry, captureException, flushSentry, isSentryEnabled } from "./lib/sentry.js";
import { syncReferenceServicesToDb } from "./modules/service/service-reference.service.js";

const port = env.PORT;

initSentry();

process.on("unhandledRejection", (reason) => {
  captureException(reason, { source: "process.unhandledRejection" });
  logger.error("Unhandled promise rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (error) => {
  captureException(error, { source: "process.uncaughtException" });
  logger.error("Uncaught exception", { error: error.message });
});

process.on("SIGTERM", async () => {
  if (isSentryEnabled()) {
    await flushSentry();
  }
  process.exit(0);
});

logger.info(`Starting server on port ${port}...`);

void syncReferenceServicesToDb().catch((error) => {
  logger.error("Failed to sync service reference on startup", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
});

serve({
  fetch: app.fetch,
  port,
});

// Background jobs are now managed by Trigger.dev
// Run `npx trigger.dev@latest dev` to start the task runner
logger.info(`Server running on http://localhost:${port}`);
logger.info("Background tasks managed by Trigger.dev — run 'pnpm trigger:dev' to start");
