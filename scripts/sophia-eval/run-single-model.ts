/**
 * Per-model runner — handles ONE model across all scenarios using a dedicated
 * phone slot that avoids collision with other parallel workers.
 *
 * Invocation:
 *   set -a && source .env && set +a && pnpm --filter api exec tsx \
 *     ../../scripts/sophia-eval/run-single-model.ts <model-id> <phone-prefix>
 *
 * Example:
 *   tsx run-single-model.ts "openai/gpt-5.4-mini" "5500099950"
 *
 * The phone-prefix must be 10 digits; scenario index (01/02/03) is appended
 * to give the final 12-digit phone. Each parallel worker MUST receive a
 * unique phone-prefix so per-phone Redis locks never collide.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runScenario, type Scenario } from "../sophia-test-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, "scenarios");
const RESULTS_DIR = join(__dirname, "results");

function slugify(model: string): string {
  return model.replace(/[\/:]/g, "__");
}

async function resetPhone(sql: postgres.Sql, phone: string): Promise<void> {
  const rows = await sql<Array<{ id: string }>>`
    SELECT id::text AS id FROM conversations WHERE phone = ${phone}
  `;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return;
  await sql`DELETE FROM messages WHERE conversation_id = ANY(${ids})`;
  await sql`DELETE FROM conversations WHERE id = ANY(${ids})`;
}

async function main(): Promise<void> {
  const [, , model, phonePrefix] = process.argv;
  if (!model || !phonePrefix) {
    console.error("Usage: tsx run-single-model.ts <model-id> <10-digit-phone-prefix>");
    process.exit(1);
  }
  if (!/^\d{10}$/.test(phonePrefix)) {
    console.error("phone-prefix must be exactly 10 digits");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");
  if (!process.env.SOPHIA_EVAL_TOKEN) throw new Error("SOPHIA_EVAL_TOKEN is required");

  const scenarioFiles = readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("smoke-"))
    .sort();
  const templates: Scenario[] = scenarioFiles.map((f) =>
    JSON.parse(readFileSync(join(SCENARIOS_DIR, f), "utf8"))
  );

  const modelSlug = slugify(model);
  const modelDir = join(RESULTS_DIR, modelSlug);
  mkdirSync(modelDir, { recursive: true });

  console.log(`\n▸ [${model}] starting ${templates.length} scenarios with phone-prefix ${phonePrefix}\n`);

  const sql = postgres(dbUrl, { max: 1 });
  const localSummary: Array<{ scenario: string; phone: string; pass: boolean; durationMs: number; isHandoff: boolean }> = [];

  try {
    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      const phone = `${phonePrefix}${String(i + 1).padStart(2, "0")}`;

      console.log(`\n=== [${model}] ${i + 1}/${templates.length} ${tmpl.scenarioName} phone=${phone} ===`);
      await resetPhone(sql, phone);

      const scenario: Scenario = {
        ...tmpl,
        fakePhone: phone,
        modelOverride: model,
        scenarioName: `${tmpl.scenarioName}__${modelSlug}`,
      };

      try {
        const result = await runScenario(scenario);
        writeFileSync(join(modelDir, `${tmpl.scenarioName}.json`), JSON.stringify(result, null, 2));
        localSummary.push({
          scenario: tmpl.scenarioName,
          phone,
          pass: result.pass,
          durationMs: result.durationMs,
          isHandoff: result.isHandoff,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ crash: ${msg}`);
        writeFileSync(
          join(modelDir, `${tmpl.scenarioName}.json`),
          JSON.stringify({ crashed: true, error: msg, scenario: tmpl.scenarioName, phone }, null, 2)
        );
        localSummary.push({ scenario: tmpl.scenarioName, phone, pass: false, durationMs: 0, isHandoff: false });
      }
    }
  } finally {
    await sql.end();
  }

  writeFileSync(
    join(modelDir, "_model-summary.json"),
    JSON.stringify({ model, phonePrefix, runs: localSummary }, null, 2)
  );

  const passed = localSummary.filter((s) => s.pass).length;
  console.log(`\n▸ [${model}] DONE: ${passed}/${localSummary.length} pass`);
}

main().catch((err) => {
  console.error("per-model runner crashed:", err);
  process.exit(1);
});
