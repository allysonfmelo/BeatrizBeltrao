/**
 * judge.ts — LLM-as-judge scorer for the Sophia model-comparison matrix.
 *
 * Reads every `scripts/sophia-eval/results/<model-slug>/<scenario>.json`,
 * asks Claude (via OpenRouter) to score the transcript on 5 dimensions,
 * combines that with the deterministic `pass` flag, and emits:
 *   - scripts/sophia-eval/results/SCORECARD.md
 *   - scripts/sophia-eval/results/JUDGE-DETAILS.json
 *
 * Run: pnpm --filter api exec tsx ../../scripts/sophia-eval/judge.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import type { ScenarioResult } from "../sophia-test-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");
const JUDGE_MODEL = "anthropic/claude-opus-4.1";

const MODELS = [
  "openai/gpt-4o-mini",
  "deepseek/deepseek-v3.2",
  "minimax/minimax-m2.7",
  "google/gemini-3-flash-preview",
  "openai/gpt-5.4-mini",
];

const SCENARIOS: Record<string, { expectHandoff: boolean; description: string; expected: string }> = {
  "01-happy-makeup": {
    expectHandoff: false,
    description: "Cliente pede maquiagem direto, fluxo feliz até pagamento.",
    expected:
      "Sophia deve coletar dados (nome, serviço, data/hora), chamar check_availability ANTES de afirmar disponibilidade, confirmar com a cliente, chamar create_booking, e ENCERRAR com link de pagamento / instruções de sinal (30%). NÃO deve virar handoff.",
  },
  "02-handoff-bridal": {
    expectHandoff: true,
    description: "Noiva pergunta sobre maquiagem de casamento.",
    expected:
      "Sophia DEVE identificar que é casamento/noiva e disparar handoff_to_human (pacote fechado com a Bia). Handoff com motivo apropriado (noiva/casamento) — NUNCA com 'Max tool iterations reached'.",
  },
  "03-edge-unavailable": {
    expectHandoff: false,
    description: "Cliente pede domingo (fechado) e depois recupera com outra data.",
    expected:
      "Sophia deve informar que não atendem domingo, oferecer alternativas (seg-sáb), e seguir o fluxo normal quando a cliente escolher outro dia. NÃO deve virar handoff.",
  },
};

interface JudgeScores {
  adherence: number;
  toolCalling: number;
  flow: number;
  recovery: number;
  noHallucination: number;
}

interface JudgeOutput {
  scores: JudgeScores;
  rationale: string;
}

interface JudgedResult {
  model: string;
  scenario: string;
  deterministicPass: boolean;
  failures: string[];
  isHandoff: boolean;
  handoffReason: string | null;
  judge: JudgeOutput;
  judgeTotal: number;
  finalScore: number;
}

function modelToSlug(model: string): string {
  return model.replace(/\//g, "__");
}

function loadResult(model: string, scenario: string): ScenarioResult | null {
  const path = join(RESULTS_DIR, modelToSlug(model), `${scenario}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ScenarioResult;
  } catch (err) {
    console.warn(`[judge] failed to parse ${path}:`, err);
    return null;
  }
}

function buildJudgePrompt(
  scenario: string,
  spec: { expectHandoff: boolean; description: string; expected: string },
  result: ScenarioResult
): string {
  const transcript = result.transcript
    .map((t) => `[${t.role.toUpperCase()}] ${t.content}`)
    .join("\n");
  return `Você é um juiz técnico avaliando a performance de uma assistente de WhatsApp (Sophia) de um estúdio de maquiagem.

## Cenário: ${scenario}
${spec.description}

## Comportamento esperado
${spec.expected}
expectHandoff: ${spec.expectHandoff}

## Resultado determinístico
pass: ${result.pass}
isHandoff: ${result.isHandoff}
handoffReason: ${result.handoffReason ?? "null"}
failures: ${JSON.stringify(result.failures)}
websiteLinkSentCount: ${result.websiteLinkSentCount}

## Transcrição completa
${transcript || "(vazio)"}

## Sua tarefa
Dê uma nota de 0 a 5 (inteira) em cada dimensão:

1. **adherence** — Aderência ao prompt Sophia: tom acolhedor/feminino, emojis sutis (✨💄💬), UMA pergunta por mensagem, NUNCA revela ser IA.
2. **toolCalling** — Corretude de tool calling: check_availability antes de afirmar disponibilidade; handoff_to_human no caso noiva; create_booking na confirmação.
3. **flow** — Fluxo de agendamento: coleta dados completos, confirma antes de criar booking, envia link de pagamento no final (happy-path).
4. **recovery** — Edge handling: trata pedido de domingo informando fechamento; oferece alternativas em indisponibilidade.
5. **noHallucination** — Não inventa preços, não consolida "ambos R$ 430", não promete o impossível, não cria datas/horários sem validar.

RESPONDA APENAS COM JSON válido, sem markdown, no formato EXATO:
{"scores":{"adherence":N,"toolCalling":N,"flow":N,"recovery":N,"noHallucination":N},"rationale":"1-3 frases explicando os principais acertos e erros"}`;
}

function parseJudge(raw: string): JudgeOutput | null {
  // strip markdown fences if any
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();
  // grab first {...} block
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as JudgeOutput;
    if (!obj.scores || typeof obj.rationale !== "string") return null;
    const s = obj.scores;
    for (const k of ["adherence", "toolCalling", "flow", "recovery", "noHallucination"] as const) {
      if (typeof s[k] !== "number") return null;
      s[k] = Math.max(0, Math.min(5, Math.round(s[k])));
    }
    return obj;
  } catch {
    return null;
  }
}

async function runJudge(client: OpenAI, prompt: string): Promise<JudgeOutput> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: JUDGE_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      });
      const raw = res.choices[0]?.message?.content ?? "";
      const parsed = parseJudge(raw);
      if (parsed) return parsed;
      console.warn(`[judge] parse failed on attempt ${attempt + 1}, raw head: ${raw.slice(0, 200)}`);
    } catch (err) {
      console.warn(`[judge] API error on attempt ${attempt + 1}:`, err);
    }
  }
  return {
    scores: { adherence: 0, toolCalling: 0, flow: 0, recovery: 0, noHallucination: 0 },
    rationale: "JUDGE_PARSE_FAILED",
  };
}

function sumScores(s: JudgeScores): number {
  return s.adherence + s.toolCalling + s.flow + s.recovery + s.noHallucination;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmt(n: number, d = 2): string {
  return n.toFixed(d);
}

function hasAnyResults(): boolean {
  if (!existsSync(RESULTS_DIR)) return false;
  for (const model of MODELS) {
    const dir = join(RESULTS_DIR, modelToSlug(model));
    if (existsSync(dir) && statSync(dir).isDirectory()) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      if (files.length > 0) return true;
    }
  }
  return false;
}

function writePlaceholder(reason: string): void {
  const md = `# Sophia Eval Scorecard\n\n_No results to score yet_: ${reason}\n\nRun the matrix first, then re-run this judge.\n`;
  writeFileSync(join(RESULTS_DIR, "SCORECARD.md"), md);
  writeFileSync(join(RESULTS_DIR, "JUDGE-DETAILS.json"), JSON.stringify({}, null, 2));
  console.log("[judge] placeholder SCORECARD written.");
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required (source your .env first)");
  }
  if (!existsSync(RESULTS_DIR) || !hasAnyResults()) {
    writePlaceholder("no result files found under scripts/sophia-eval/results/");
    return;
  }

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  const judged: JudgedResult[] = [];
  const details: Record<string, JudgeOutput & { deterministicPass: boolean; failures: string[] }> = {};

  for (const model of MODELS) {
    const modelDir = join(RESULTS_DIR, modelToSlug(model));
    if (!existsSync(modelDir)) {
      console.warn(`[judge] skipping ${model} — no results dir`);
      continue;
    }
    for (const scenario of Object.keys(SCENARIOS)) {
      const result = loadResult(model, scenario);
      if (!result) {
        console.warn(`[judge] skipping ${model}/${scenario} — missing result file`);
        continue;
      }
      console.log(`[judge] scoring ${model} / ${scenario} ...`);
      const prompt = buildJudgePrompt(scenario, SCENARIOS[scenario], result);
      const judge = await runJudge(client, prompt);
      const judgeTotal = sumScores(judge.scores);
      const detScore = result.pass ? 25 : 0;
      const finalScore = 0.4 * detScore + 0.6 * judgeTotal;
      judged.push({
        model,
        scenario,
        deterministicPass: result.pass,
        failures: result.failures,
        isHandoff: result.isHandoff,
        handoffReason: result.handoffReason,
        judge,
        judgeTotal,
        finalScore,
      });
      details[`${model}/${scenario}`] = {
        ...judge,
        deterministicPass: result.pass,
        failures: result.failures,
      };
    }
  }

  writeFileSync(join(RESULTS_DIR, "JUDGE-DETAILS.json"), JSON.stringify(details, null, 2));

  if (judged.length === 0) {
    writePlaceholder("results dir exists but no scenario files matched");
    return;
  }

  // Aggregate per model
  const perModel = MODELS.map((model) => {
    const rows = judged.filter((r) => r.model === model);
    if (rows.length === 0) return null;
    const dims: (keyof JudgeScores)[] = [
      "adherence",
      "toolCalling",
      "flow",
      "recovery",
      "noHallucination",
    ];
    const dimAvgs = Object.fromEntries(
      dims.map((d) => [d, avg(rows.map((r) => r.judge.scores[d]))])
    ) as Record<keyof JudgeScores, number>;
    return {
      model,
      rows,
      avgFinal: avg(rows.map((r) => r.finalScore)),
      passRate: rows.filter((r) => r.deterministicPass).length / rows.length,
      dimAvgs,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  perModel.sort((a, b) => b.avgFinal - a.avgFinal);
  const winner = perModel[0];

  // Build SCORECARD.md
  const lines: string[] = [];
  lines.push("# Sophia Eval Scorecard");
  lines.push("");
  lines.push(`**Winner:** \`${winner.model}\` with avg final score **${fmt(winner.avgFinal)}/25**.`);
  lines.push("");
  lines.push("## Ranking");
  lines.push("");
  lines.push("| # | Model | Avg Final | Pass Rate | Adh | Tool | Flow | Recov | NoHallu |");
  lines.push("|---|-------|-----------|-----------|-----|------|------|-------|---------|");
  perModel.forEach((m, i) => {
    lines.push(
      `| ${i + 1} | \`${m.model}\` | **${fmt(m.avgFinal)}** | ${fmt(m.passRate * 100, 0)}% | ${fmt(m.dimAvgs.adherence)} | ${fmt(m.dimAvgs.toolCalling)} | ${fmt(m.dimAvgs.flow)} | ${fmt(m.dimAvgs.recovery)} | ${fmt(m.dimAvgs.noHallucination)} |`
    );
  });
  lines.push("");
  lines.push("## Per-scenario breakdown (final score, max 25)");
  lines.push("");
  const scenarioKeys = Object.keys(SCENARIOS);
  lines.push(`| Model | ${scenarioKeys.join(" | ")} |`);
  lines.push(`|-------|${scenarioKeys.map(() => "---").join("|")}|`);
  for (const m of perModel) {
    const cells = scenarioKeys.map((sc) => {
      const row = m.rows.find((r) => r.scenario === sc);
      if (!row) return "—";
      return `${fmt(row.finalScore)}${row.deterministicPass ? " ✓" : " ✗"}`;
    });
    lines.push(`| \`${m.model}\` | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Qualitative findings");
  lines.push("");
  for (const m of perModel) {
    lines.push(`### \`${m.model}\``);
    for (const row of m.rows) {
      const r = row.judge.rationale.replace(/\s+/g, " ").trim();
      lines.push(`- **${row.scenario}** (${fmt(row.finalScore)}/25, ${row.deterministicPass ? "pass" : "fail"}): ${r}`);
    }
    lines.push("");
  }

  writeFileSync(join(RESULTS_DIR, "SCORECARD.md"), lines.join("\n"));
  console.log(`[judge] wrote SCORECARD.md and JUDGE-DETAILS.json — winner: ${winner.model} (${fmt(winner.avgFinal)}/25)`);
}

main().catch((err) => {
  console.error("[judge] crashed:", err);
  process.exit(1);
});
