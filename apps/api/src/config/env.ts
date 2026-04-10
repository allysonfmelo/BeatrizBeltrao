import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

function loadDotEnvFile() {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return;
  }

  const envPath = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../.env");

  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }
}

loadDotEnvFile();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4"),
  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE_NAME: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: z.string().optional(),
  /**
   * Raw JSON string containing the Google Service Account credentials.
   * Preferred over GOOGLE_SERVICE_ACCOUNT_KEY_PATH because it avoids
   * filesystem path resolution issues across Docker/Trigger.dev/local env.
   * If both are set, this takes precedence.
   */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  // Legacy OAuth (kept for backwards compatibility, not used with Service Account)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  ASAAS_API_KEY: z.string().min(1),
  ASAAS_WEBHOOK_TOKEN: z.string().min(1),
  ASAAS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().default("contato@studiobeatrizbeltrao.com.br"),
  DEPOSIT_PERCENTAGE: z.coerce.number().default(30),
  PAYMENT_TIMEOUT_HOURS: z.coerce.number().default(24),
  PIX_KEY: z.string().optional(),
  PIX_HOLDER_NAME: z.string().optional(),
  MAQUIADORA_PHONE: z.string().optional(),
  MAQUIADORA_EMAIL: z.string().email().optional(),
  TRIGGER_SECRET_KEY: z.string().min(1).optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
});

let _env: z.infer<typeof envSchema> | null = null;

function loadEnv(): z.infer<typeof envSchema> {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  _env = result.data;
  return _env;
}

/** Lazy-loaded env — validates on first access, not on import.
 *  This allows Trigger.dev indexer to discover tasks without requiring all env vars at build time.
 */
export const env = new Proxy({} as z.infer<typeof envSchema>, {
  get(_target, prop: string) {
    return loadEnv()[prop as keyof z.infer<typeof envSchema>];
  },
});
export type Env = z.infer<typeof envSchema>;
