import { defineConfig } from "@trigger.dev/sdk/v3";
import { syncEnvVars, additionalFiles } from "@trigger.dev/build/extensions/core";
import { loadEnvFile } from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load env from project root for local dev and deploy
try {
  loadEnvFile("../../.env.production");
} catch {
  try {
    loadEnvFile("../../.env");
  } catch {
    // .env may not exist in CI (env vars injected by platform)
  }
}

/** Parses a .env file into key-value pairs */
function parseEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, "utf8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

export default defineConfig({
  project: "proj_ldikgkaqoxearhbubkwl",
  dirs: ["./src/trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
  build: {
    extensions: [
      // Sync env vars from .env.production to Trigger.dev cloud workers
      syncEnvVars(async () => {
        const prodPath = resolve(__dirname, "../../.env.production");
        const devPath = resolve(__dirname, "../../.env");
        const vars = { ...parseEnvFile(devPath), ...parseEnvFile(prodPath) };

        // Keys that must be available in the Trigger.dev worker
        const requiredKeys = [
          "DATABASE_URL",
          "OPENROUTER_API_KEY",
          "OPENROUTER_MODEL",
          "EVOLUTION_API_URL",
          "EVOLUTION_API_KEY",
          "EVOLUTION_INSTANCE_NAME",
          "GOOGLE_SERVICE_ACCOUNT_KEY_PATH",
          "GOOGLE_SERVICE_ACCOUNT_JSON",
          "GOOGLE_CALENDAR_ID",
          "ASAAS_API_KEY",
          "ASAAS_WEBHOOK_TOKEN",
          "ASAAS_ENVIRONMENT",
          "REDIS_URL",
          "RESEND_API_KEY",
          "RESEND_FROM_EMAIL",
          "MAQUIADORA_PHONE",
          "MAQUIADORA_EMAIL",
          "DEPOSIT_PERCENTAGE",
          "PAYMENT_TIMEOUT_HOURS",
          "SENTRY_DSN",
          "SENTRY_ENVIRONMENT",
          "SENTRY_RELEASE",
          "CORS_ORIGIN",
          "PORT",
          "NODE_ENV",
        ];

        return requiredKeys
          .filter((key) => vars[key])
          .map((key) => ({ name: key, value: vars[key] }));
      }),
      // Include assets (service-reference.yaml + PDF catalogs)
      // and Google Service Account credentials needed by calendar integration
      additionalFiles({
        files: [
          "../../assets/**",
          "../../credentials/**",
          "./src/modules/sophia/*.md",
        ],
      }),
    ],
  },
});
