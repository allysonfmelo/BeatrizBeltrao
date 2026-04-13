/**
 * Matrix runner for the Sophia model comparison evaluation.
 *
 * Executes (scenario × model) combinations sequentially against the LOCAL
 * dev API (http://localhost:3001), using one of the 4 approved test phones
 * in round-robin order. Each run is preceded by a state reset for the
 * phone so scenarios start fresh.
 *
 * Writes one JSON result per run under scripts/sophia-eval/results/<model>/<scenario>.json
 * and a consolidated SUMMARY.json at the end.
 *
 * Usage (from repo root):
 *   set -a && source .env && set +a && pnpm --filter api exec tsx ../../scripts/sophia-eval/run-matrix.ts
 *
 * Requires env:
 *   DATABASE_URL, SOPHIA_EVAL_TOKEN (already in .env)
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runScenario, type Scenario } from "../sophia-test-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, "scenarios");
const RESULTS_DIR = join(__dirname, "results");

const MODELS = [
  "openai/gpt-4o-mini",        // baseline (local .env)
  "deepseek/deepseek-v3.2",
  "minimax/minimax-m2.7",
  "google/gemini-3-flash-preview",
  "openai/gpt-5.4-mini",
];

/**
 * Using test-prefix phones (`5500099...`) so Evolution API send is SKIPPED
 * (see isTestPhone in notification.service.ts). Messages still persist to DB
 * so the harness poll works, Trigger.dev runs still fire and are observable
 * via MCP. Real WhatsApp numbers fail Evolution validation intermittently
 * (e.g. `exists:false` JID errors), which aborts the flow before DB persist
 * and destroys test data. Real-WhatsApp delivery is reserved for targeted
 * smokes outside this matrix.
 */
const PHONES = [
  "5500099991001",
  "5500099991002",
  "5500099991003",
  "5500099991004",
];

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
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");
  if (!process.env.SOPHIA_EVAL_TOKEN) throw new Error("SOPHIA_EVAL_TOKEN is required");

  const scenarioFiles = readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("smoke-"))
    .sort();
  const templates: Scenario[] = scenarioFiles.map((f) =>
    JSON.parse(readFileSync(join(SCENARIOS_DIR, f), "utf8"))
  );

  console.log(`\n▸ Matrix: ${templates.length} scenarios × ${MODELS.length} models = ${templates.length * MODELS.length} runs\n`);

  const sql = postgres(dbUrl, { max: 1 });
  const summary: Array<{
    model: string;
    scenario: string;
    phone: string;
    pass: boolean;
    failureCount: number;
    transcriptTurns: number;
    isHandoff: boolean;
    handoffReason: string | null;
    durationMs: number;
  }> = [];

  let runIdx = 0;
  try {
    for (const model of MODELS) {
      const modelSlug = slugify(model);
      const modelDir = join(RESULTS_DIR, modelSlug);
      mkdirSync(modelDir, { recursive: true });

      for (const tmpl of templates) {
        const phone = PHONES[runIdx % PHONES.length];
        runIdx++;

        console.log(`\n=== [${runIdx}/${templates.length * MODELS.length}] model=${model}  scenario=${tmpl.scenarioName}  phone=${phone} ===`);

        await resetPhone(sql, phone);

        const scenario: Scenario = {
          ...tmpl,
          fakePhone: phone,
          modelOverride: model,
          scenarioName: `${tmpl.scenarioName}__${modelSlug}`,
        };

        try {
          const result = await runScenario(scenario);
          const outPath = join(modelDir, `${tmpl.scenarioName}.json`);
          writeFileSync(outPath, JSON.stringify(result, null, 2));
          summary.push({
            model,
            scenario: tmpl.scenarioName,
            phone,
            pass: result.pass,
            failureCount: result.failures.length,
            transcriptTurns: result.transcript.length,
            isHandoff: result.isHandoff,
            handoffReason: result.handoffReason,
            durationMs: result.durationMs,
          });
        } catch (err) {
          console.error(`  ✗ run crashed: ${err instanceof Error ? err.message : String(err)}`);
          summary.push({
            model,
            scenario: tmpl.scenarioName,
            phone,
            pass: false,
            failureCount: -1,
            transcriptTurns: 0,
            isHandoff: false,
            handoffReason: `CRASH: ${err instanceof Error ? err.message : String(err)}`,
            durationMs: 0,
          });
        }

        // Brief pacing to avoid slamming Evolution / OpenRouter across phones
        await new Promise((r) => setTimeout(r, 8000));
      }
    }
  } finally {
    await sql.end();
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, "SUMMARY.json"), JSON.stringify(summary, null, 2));

  const passed = summary.filter((s) => s.pass).length;
  const total = summary.length;
  console.log(`\n\n▸ Matrix done: ${passed}/${total} pass.`);
  console.log(`▸ Results in ${RESULTS_DIR}/`);

  // Group by model for quick scan
  console.log(`\nBy model:`);
  for (const model of MODELS) {
    const rows = summary.filter((s) => s.model === model);
    const p = rows.filter((r) => r.pass).length;
    console.log(`  ${model.padEnd(38)} ${p}/${rows.length} pass`);
  }
}

main().catch((err) => {
  console.error("matrix crashed:", err);
  process.exit(1);
});
