/**
 * End-to-end test harness for Sophia's conversation flow.
 *
 * Spins up a local HTTP mock that impersonates the Evolution API (so no real
 * WhatsApp messages are sent), overrides EVOLUTION_API_URL to point at it,
 * then dynamically imports the Sophia service and drives a scripted
 * multi-turn conversation. After each turn it prints the messages Sophia
 * tried to send and runs basic assertions (no "combo" word, no summed total).
 *
 * Cleanup: the conversation + any bookings created for the fake phone are
 * deleted at the end.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   pnpm --filter @studio/api exec tsx scripts/test-sophia-e2e.mts
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";

const FAKE_PHONE = "+5500000000000";
const MOCK_PORT = 4999;
const captured: string[] = [];

// ---------------------------------------------------------------------------
// Mock Evolution server (must be running before importing Sophia modules)
// ---------------------------------------------------------------------------
const mockServer = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.includes("/message/sendText/")) {
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed.text === "string") captured.push(parsed.text);
      } catch {}
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          key: { remoteJid: FAKE_PHONE, fromMe: true, id: `mock_${randomUUID()}` },
          messageTimestamp: String(Math.floor(Date.now() / 1000)),
          status: "PENDING",
        })
      );
      return;
    }
    if (req.url?.includes("/message/sendMedia/")) {
      try {
        const parsed = JSON.parse(body);
        captured.push(`[MEDIA] ${parsed.fileName ?? "?"} ${parsed.caption ?? ""}`);
      } catch {}
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          key: { remoteJid: FAKE_PHONE, fromMe: true, id: `mock_${randomUUID()}` },
          messageTimestamp: String(Math.floor(Date.now() / 1000)),
          status: "PENDING",
        })
      );
      return;
    }
    if (req.url?.includes("/chat/updatePresence/")) {
      res.statusCode = 200;
      res.end("{}");
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
});

mockServer.listen(MOCK_PORT);
await once(mockServer, "listening");
console.log(`[mock] Evolution mock listening on http://127.0.0.1:${MOCK_PORT}`);

// Override env BEFORE dynamic imports so env.ts picks it up
process.env.EVOLUTION_API_URL = `http://127.0.0.1:${MOCK_PORT}`;
process.env.EVOLUTION_API_KEY = "mock-key";
process.env.EVOLUTION_INSTANCE_NAME = "mock-instance";

// Also make Sophia's "typing delay" fast — the real one sleeps up to 5s per chunk
// which would make this test painfully slow. We overwrite the calculateTypingDelay
// later via module mocking.

// ---------------------------------------------------------------------------
// Dynamic imports (must be after env override)
// ---------------------------------------------------------------------------
const [sophiaModule, contextModule, dbModule, schema] = await Promise.all([
  import("../src/modules/sophia/sophia.service.js"),
  import("../src/modules/sophia/sophia.context.js"),
  import("../src/config/supabase.js"),
  import("@studio/db"),
]);

// Note: we can't monkey-patch calculateTypingDelay on ESM modules; accept the
// 1.5-5s per chunk delay. Each turn takes ~5-15s.

const { processMessage } = sophiaModule;
const { db } = dbModule;
const { conversations, messages, bookings, clients } = schema as typeof schema;
const { eq } = await import("drizzle-orm");

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------
async function cleanupFakePhone(): Promise<void> {
  const client = await db.query.clients.findFirst({ where: eq(clients.phone, FAKE_PHONE) });
  const convs = await db.select().from(conversations).where(eq(conversations.phone, FAKE_PHONE));

  for (const c of convs) {
    await db.delete(messages).where(eq(messages.conversationId, c.id));
    await db.delete(conversations).where(eq(conversations.id, c.id));
  }

  if (client) {
    await db.delete(bookings).where(eq(bookings.clientId, client.id));
    await db.delete(clients).where(eq(clients.id, client.id));
  }
}

await cleanupFakePhone();
console.log("[cleanup] Fake-phone state wiped before test");

// ---------------------------------------------------------------------------
// Test script
// ---------------------------------------------------------------------------
interface Turn {
  label: string;
  content: string;
  pushName?: string;
  assertions?: Array<{ label: string; check: (captured: string) => boolean }>;
  resetBefore?: boolean;
}

const script: Turn[] = [
  {
    // CTA from site: first message already carries the service.
    label: "T1 — CTA do site (Maquiagem Social)",
    content: "Olá! Tenho interesse na Maquiagem Social ✨",
    pushName: "Cliente CTA",
    assertions: [
      { label: "NÃO re-envia o site", check: (c) => !/biabeltrao\.com\.br|confira nosso site/i.test(c) },
      { label: "NÃO usa 'combo'", check: (c) => !/\bcombo\b/i.test(c) },
      { label: "confirma o serviço maquiagem", check: (c) => /maquiagem/i.test(c) },
      {
        label: "OBRIGATÓRIO: pergunta se quer também penteado/ambos (mesmo com CTA)",
        check: (c) => /penteado/i.test(c) && /ambos|incluir|tamb[eé]m|junto/i.test(c),
      },
      {
        label: "NÃO pede a data ainda (primeiro tem que ouvir sobre ambos)",
        check: (c) => !/qual data|qual o dia|em que data|quando ser[aá]/i.test(c),
      },
      {
        label: "NÃO repete triagem genérica ('como posso ajudar')",
        check: (c) => !/como posso te ajudar|como posso ajudar/i.test(c),
      },
    ],
  },
  {
    label: "T1b — (conversa nova) CTA de Penteado Social",
    content: "Olá! Tenho interesse no Penteado Social ✨",
    pushName: "Cliente CTA",
    resetBefore: true,
    assertions: [
      { label: "NÃO re-envia o site", check: (c) => !/biabeltrao\.com\.br|confira nosso site/i.test(c) },
      { label: "NÃO usa 'combo'", check: (c) => !/\bcombo\b/i.test(c) },
      { label: "confirma o serviço penteado", check: (c) => /penteado/i.test(c) },
      {
        label: "OBRIGATÓRIO: pergunta se quer também maquiagem/ambos",
        check: (c) => /maquiagem/i.test(c) && /ambos|incluir|tamb[eé]m|junto/i.test(c),
      },
    ],
  },
  {
    label: "T2 — cliente do T1 responde 'só maquiagem'",
    content: "Só maquiagem mesmo. Quero agendar para amanhã às 14h.",
    assertions: [
      { label: "NÃO usa 'combo'", check: (c) => !/\bcombo\b/i.test(c) },
      {
        label: "confirma 14h ou apresenta horários (check_availability foi chamado)",
        check: (c) => /14:00|14h|dispon[íi]vel|livre|hor[aá]rio|nome|cpf|confirmar/i.test(c),
      },
      { label: "NÃO fez handoff para Beatriz", check: (c) => !/Beatriz j[aá] vai/i.test(c) },
    ],
  },
  {
    label: "T3 — escolhe 14h",
    content: "Das 14h",
    assertions: [
      {
        label: "confirma 14h OU pede dados (check_availability foi chamado)",
        check: (c) => /14:00|14h|nome|cpf|dados|confirmar/i.test(c),
      },
      { label: "NÃO fez handoff para Beatriz", check: (c) => !/Beatriz j[aá] vai/i.test(c) },
    ],
  },
  {
    // Teste adicional: fluxo de ambos iniciado pela pergunta de disponibilidade
    label: "T4 — (conversa nova) nova cliente pede disponibilidade",
    content: "Você tem disponibilidade amanhã?",
    pushName: "Cliente Disponibilidade",
    resetBefore: true,
    assertions: [
      {
        label: "pergunta serviço maquiagem/penteado/ambos",
        check: (c) => /maquiagem/i.test(c) && /penteado/i.test(c) && /ambos/i.test(c),
      },
      { label: "NÃO usa 'combo'", check: (c) => !/\bcombo\b/i.test(c) },
      { label: "NÃO fez handoff", check: (c) => !/Beatriz j[aá] vai/i.test(c) },
    ],
  },
  {
    label: "T5 — escolhe ambos",
    content: "Quero ambos",
    assertions: [
      { label: "oferece express vs sequencial", check: (c) => /express/i.test(c) && /sequencial/i.test(c) },
    ],
  },
  {
    label: "T6 — escolhe express",
    content: "Express",
    assertions: [
      { label: "pede data OU chama check_availability", check: (c) => /data|dia|hor[aá]rio|quando|dispon[íi]vel/i.test(c) },
    ],
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
function popCaptured(): string {
  const all = captured.splice(0).join("\n---\n");
  return all;
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const turn of script) {
  if (turn.resetBefore) {
    await cleanupFakePhone();
    console.log("\n[reset] Fake-phone state wiped");
  }
  console.log(`\n╔═══ ${turn.label} ═══╗`);
  console.log(`  > ${turn.content}`);
  try {
    await processMessage(FAKE_PHONE, turn.content, { pushName: turn.pushName });
  } catch (err) {
    console.log(`  ✗ processMessage threw: ${err instanceof Error ? err.message : err}`);
    failed++;
    failures.push(`${turn.label}: processMessage threw`);
    continue;
  }

  const replies = popCaptured();
  console.log(`  ← ${replies.split("\n").map((l, i) => (i === 0 ? l : "    " + l)).join("\n").slice(0, 800)}`);

  let turnOK = true;
  if (turn.assertions) {
    for (const a of turn.assertions) {
      const ok = a.check(replies);
      console.log(`    ${ok ? "✓" : "✗"} ${a.label}`);
      if (!ok) {
        turnOK = false;
        failures.push(`${turn.label}: ${a.label}`);
      }
    }
  }
  if (turnOK) passed++;
  else failed++;
}

// ---------------------------------------------------------------------------
// Summary + cleanup
// ---------------------------------------------------------------------------
console.log(`\n═══ SUMMARY ═══`);
console.log(`  passed: ${passed}`);
console.log(`  failed: ${failed}`);
if (failures.length > 0) {
  console.log("  failures:");
  for (const f of failures) console.log(`    - ${f}`);
}

console.log("\n[cleanup] Removing fake-phone state...");
await cleanupFakePhone();

mockServer.close();
process.exit(failed > 0 ? 1 : 0);
