/**
 * sophia-test-client.ts — test harness for running multi-turn Sophia conversations
 * against the deployed API at api.biabeltrao.com.br.
 *
 * Usage (CLI mode — run a single scenario):
 *   DATABASE_URL=... tsx scripts/sophia-test-client.ts <scenario-json-file>
 *
 * Or programmatic:
 *   import { runScenario } from "./sophia-test-client.js";
 *   const result = await runScenario(scenario);
 *
 * Scenario JSON shape:
 *   {
 *     "scenarioName": "makeup-whatsapp-direct",
 *     "fakePhone": "5500099991001",
 *     "pushName": "Test Maria",
 *     "turns": [
 *       { "send": "Oi, quero agendar maquiagem pra sábado 15h", "waitSeconds": 30 }
 *     ]
 *   }
 *
 * The harness:
 *  1. POSTs Evolution-compatible webhook payloads to the deployed API
 *  2. Waits for each turn (the API has a 15s debounce via Trigger.dev)
 *  3. Polls the `messages` table for new Sophia responses (`role='sophia'`)
 *  4. Captures the full transcript, handoff state, and conversation metadata
 *  5. Returns a structured ScenarioResult with pass/fail and diagnostic info
 *
 * IMPORTANT: uses real production DB for polling AND real API for sending.
 * Use fake phones with prefix `5500099` to avoid colliding with real clients.
 */

import { readFileSync } from "node:fs";
import postgres from "postgres";

const API_BASE = "https://api.biabeltrao.com.br";
const WEBHOOK_PATH = "/api/v1/webhook/evolution";
const DEFAULT_WAIT_SECONDS = 25; // 15s debounce + ~5s LLM + buffer
const POLL_INTERVAL_MS = 2000;

export interface ScenarioTurn {
  /** Text to send as if from the client */
  send: string;
  /** How long to wait for Sophia's response before giving up (default 25s) */
  waitSeconds?: number;
  /** Optional: assertions — must-include substrings (case-insensitive) */
  expectIncludes?: string[];
  /** Optional: must-NOT-include substrings */
  expectNotIncludes?: string[];
}

export interface Scenario {
  scenarioName: string;
  fakePhone: string; // digits only, e.g. "5500099991001"
  pushName?: string;
  turns: ScenarioTurn[];
  /** Overall assertion: must the conversation end in handoff? */
  expectHandoff?: boolean;
  /** If expectHandoff is true, the reason must NOT be this string (default: "Max tool iterations reached") */
  rejectHandoffReason?: string;
}

export interface TurnTranscriptEntry {
  role: "client" | "sophia";
  content: string;
  timestamp: string;
}

export interface ScenarioResult {
  scenarioName: string;
  fakePhone: string;
  conversationId: string | null;
  transcript: TurnTranscriptEntry[];
  isHandoff: boolean;
  handoffReason: string | null;
  websiteLinkSentCount: number;
  pass: boolean;
  failures: string[];
  durationMs: number;
}

function makeWebhookPayload(scenario: Scenario, text: string): object {
  const id = `test_${scenario.scenarioName}_${Date.now()}`;
  return {
    event: "messages.upsert",
    instance: "test-instance",
    data: {
      pushName: scenario.pushName ?? "Test User",
      key: {
        remoteJid: `${scenario.fakePhone}@s.whatsapp.net`,
        fromMe: false,
        id,
      },
      message: {
        conversation: text,
      },
      messageType: "conversation",
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
}

async function postWebhook(scenario: Scenario, text: string): Promise<void> {
  const payload = makeWebhookPayload(scenario, text);
  const res = await fetch(`${API_BASE}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Webhook POST failed: ${res.status} ${res.statusText}`);
  }
}

async function pollForSophiaResponse(
  sql: postgres.Sql,
  phone: string,
  sinceIso: string,
  timeoutMs: number
): Promise<Array<{ content: string; createdAt: string; conversationId: string }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await sql<Array<{ content: string; created_at: string; conversation_id: string }>>`
      SELECT m.content, m.created_at::text AS created_at, m.conversation_id::text AS conversation_id
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.phone = ${phone}
        AND m.role = 'sophia'
        AND m.created_at > ${sinceIso}
      ORDER BY m.created_at ASC
    `;
    if (rows.length > 0) {
      return rows.map((r) => ({
        content: r.content,
        createdAt: r.created_at,
        conversationId: r.conversation_id,
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return [];
}

async function getConversationState(
  sql: postgres.Sql,
  phone: string
): Promise<{ id: string; isHandoff: boolean; handoffReason: string | null } | null> {
  const rows = await sql<Array<{ id: string; is_handoff: boolean; handoff_reason: string | null }>>`
    SELECT id::text AS id, is_handoff, handoff_reason
    FROM conversations
    WHERE phone = ${phone}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    isHandoff: row.is_handoff,
    handoffReason: row.handoff_reason,
  };
}

async function getAllConversationMessages(
  sql: postgres.Sql,
  conversationId: string
): Promise<TurnTranscriptEntry[]> {
  const rows = await sql<Array<{ role: string; content: string; created_at: string }>>`
    SELECT role, content, created_at::text AS created_at
    FROM messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
  `;
  return rows
    .filter((r) => r.role === "client" || r.role === "sophia")
    .map((r) => ({
      role: r.role as "client" | "sophia",
      content: r.content,
      timestamp: r.created_at,
    }));
}

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const startTime = Date.now();
  const failures: string[] = [];
  let lastPollSince = new Date(Date.now() - 5000).toISOString(); // 5s slack for safety

  try {
    console.log(`\n▸ [${scenario.scenarioName}] iniciando com telefone ${scenario.fakePhone}`);

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];
      const turnNumber = i + 1;
      const waitMs = (turn.waitSeconds ?? DEFAULT_WAIT_SECONDS) * 1000;

      console.log(`\n  Turn ${turnNumber}/${scenario.turns.length}:`);
      console.log(`    → cliente: ${turn.send.slice(0, 80)}${turn.send.length > 80 ? "..." : ""}`);

      // Capture "since" marker BEFORE posting
      lastPollSince = new Date().toISOString();

      // Post webhook
      await postWebhook(scenario, turn.send);
      console.log(`    … webhook enviado, aguardando resposta (timeout ${waitMs / 1000}s)`);

      // Poll for Sophia response
      const responses = await pollForSophiaResponse(
        sql,
        scenario.fakePhone,
        lastPollSince,
        waitMs
      );

      if (responses.length === 0) {
        failures.push(`Turn ${turnNumber}: timeout — no response from Sophia within ${waitMs / 1000}s`);
        console.log(`    ✗ TIMEOUT — nenhuma resposta em ${waitMs / 1000}s`);
        break; // don't continue if Sophia didn't respond
      }

      for (const r of responses) {
        console.log(`    ← sophia: ${r.content.slice(0, 120)}${r.content.length > 120 ? "..." : ""}`);
      }

      // Run turn-level assertions
      const fullResponseText = responses.map((r) => r.content).join("\n").toLowerCase();
      if (turn.expectIncludes) {
        for (const needle of turn.expectIncludes) {
          if (!fullResponseText.includes(needle.toLowerCase())) {
            failures.push(`Turn ${turnNumber}: expected response to include "${needle}"`);
          }
        }
      }
      if (turn.expectNotIncludes) {
        for (const needle of turn.expectNotIncludes) {
          if (fullResponseText.includes(needle.toLowerCase())) {
            failures.push(`Turn ${turnNumber}: expected response to NOT include "${needle}"`);
          }
        }
      }
    }

    // Final state collection
    const state = await getConversationState(sql, scenario.fakePhone);
    const transcript = state
      ? await getAllConversationMessages(sql, state.id)
      : [];

    // Count website link occurrences in Sophia messages
    const websiteLinkSentCount = transcript.filter(
      (t) => t.role === "sophia" && t.content.toLowerCase().includes("biabeltrao.com.br")
    ).length;

    // Top-level assertions
    if (scenario.expectHandoff === false && state?.isHandoff) {
      failures.push(
        `Conversation ended in handoff but was NOT expected to. Reason: "${state.handoffReason ?? "unknown"}"`
      );
    }
    if (scenario.expectHandoff === true && !state?.isHandoff) {
      failures.push(`Expected conversation to end in handoff but it did not`);
    }
    if (state?.isHandoff && scenario.rejectHandoffReason && state.handoffReason === scenario.rejectHandoffReason) {
      failures.push(
        `Handoff occurred with forbidden reason: "${state.handoffReason}" — this indicates the bug we want to catch`
      );
    }

    // A handoff with "Max tool iterations reached" is ALWAYS a bug, regardless of expectHandoff
    if (state?.handoffReason === "Max tool iterations reached") {
      failures.push(`CRITICAL BUG CONFIRMED: handoffReason = "Max tool iterations reached" (auto-handoff fallback)`);
    }

    const pass = failures.length === 0;
    const result: ScenarioResult = {
      scenarioName: scenario.scenarioName,
      fakePhone: scenario.fakePhone,
      conversationId: state?.id ?? null,
      transcript,
      isHandoff: state?.isHandoff ?? false,
      handoffReason: state?.handoffReason ?? null,
      websiteLinkSentCount,
      pass,
      failures,
      durationMs: Date.now() - startTime,
    };

    console.log(`\n▸ [${scenario.scenarioName}] ${pass ? "✓ PASS" : "✗ FAIL"} — ${failures.length} failure(s)`);
    if (!pass) {
      for (const f of failures) {
        console.log(`    • ${f}`);
      }
    }

    return result;
  } finally {
    await sql.end();
  }
}

// CLI entry point
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: tsx scripts/sophia-test-client.ts <scenario.json>");
    process.exit(1);
  }

  const scenarioPath = args[0];
  const scenario: Scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));

  const result = await runScenario(scenario);

  console.log("\n=== RESULT JSON ===");
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.pass ? 0 : 1);
}

// CLI entry — invoked when script is run directly (not imported).
// Simpler than checking import.meta.url (tsx rewrites paths).
main().catch((err) => {
  console.error("✗ Harness crashed:", err);
  process.exit(2);
});
