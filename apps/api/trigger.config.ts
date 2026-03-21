import { defineConfig } from "@trigger.dev/sdk/v3";
import { loadEnvFile } from "node:process";

// Load .env from project root so Trigger.dev worker has access to env vars
try {
  loadEnvFile("../../.env");
} catch {
  // .env may not exist in production (env vars injected by platform)
}

export default defineConfig({
  project: "proj_ldikgkaqoxearhbubkwl",
  dirs: ["./src/trigger"],
  maxDuration: 300, // 5 minutes max per task
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
});
