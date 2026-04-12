/**
 * End-to-end test harness for Sophia's conversation flow.
 *
 * The runner starts a local mock Evolution API, overrides EVOLUTION_API_URL,
 * then drives multiple independent personas in parallel.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   pnpm --filter @studio/api exec tsx scripts/test-sophia-e2e.mts
 *   pnpm --filter @studio/api exec tsx scripts/test-sophia-e2e.mts --scenario=direct-info
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WEBSITE_INDEX_PATH = fileURLToPath(new URL("../../../bia-beltrao-website/index.html", import.meta.url));

interface CaptureEvent {
  kind: "text" | "media";
  phone: string;
  content: string;
  messageId: string;
  createdAt: number;
}

interface WebsiteCta {
  href: string;
  label: string;
  message: string;
  index: number;
}

interface TurnResult {
  recentTranscript: string;
  cumulativeTranscript: string;
}

interface ScenarioContext {
  phone: string;
  ctas: WebsiteCta[];
  log: (line: string) => void;
  turn: (message: string, pushName?: string) => Promise<TurnResult>;
  transcript: () => string;
  recent: () => string;
  expect: ReturnType<typeof createExpect>;
}

interface ScenarioSpec {
  slug: string;
  title: string;
  phone: string;
  pushName: string;
  run: (ctx: ScenarioContext) => Promise<void>;
}

type SupabaseDb = typeof import("../src/config/supabase.js").db;
type DbSchema = typeof import("@studio/db");
type NodeSocket = import("node:net").Socket;

const capturedByPhone = new Map<string, CaptureEvent[]>();

function ensureBuffer(phone: string): CaptureEvent[] {
  const existing = capturedByPhone.get(phone);
  if (existing) return existing;
  const buffer: CaptureEvent[] = [];
  capturedByPhone.set(phone, buffer);
  return buffer;
}

function pushCapture(event: CaptureEvent): void {
  ensureBuffer(event.phone).push(event);
}

function formatTranscript(events: CaptureEvent[]): string {
  return events
    .map((event) => (event.kind === "media" ? `[MEDIA] ${event.content}` : event.content))
    .join("\n---\n");
}

function makePreview(text: string, limit = 700): string {
  const compact = text.replace(/\n{3,}/g, "\n\n").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit)}...`;
}

function countMatches(text: string, pattern: RegExp): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  return text.match(globalPattern)?.length ?? 0;
}

function assertInOrder(text: string, tokens: string[]): boolean {
  let cursor = 0;
  const lowerText = text.toLowerCase();

  for (const token of tokens) {
    const lowerToken = token.toLowerCase();
    const index = lowerText.indexOf(lowerToken, cursor);
    if (index === -1) return false;
    cursor = index + lowerToken.length;
  }

  return true;
}

function createExpect(log: (line: string) => void) {
  const results: string[] = [];

  return {
    pass(label: string): void {
      results.push(`✓ ${label}`);
      log(`    ✓ ${label}`);
    },
    fail(label: string): void {
      results.push(`✗ ${label}`);
      log(`    ✗ ${label}`);
    },
    ok(condition: boolean, label: string): void {
      if (condition) this.pass(label);
      else this.fail(label);
    },
    match(text: string, pattern: RegExp, label: string): void {
      this.ok(pattern.test(text), label);
    },
    notMatch(text: string, pattern: RegExp, label: string): void {
      this.ok(!pattern.test(text), label);
    },
    count(text: string, pattern: RegExp, expected: number, label: string): void {
      this.ok(countMatches(text, pattern) === expected, `${label} (expected ${expected})`);
    },
    order(text: string, tokens: string[], label: string): void {
      this.ok(assertInOrder(text, tokens), label);
    },
    getResults(): string[] {
      return results.slice();
    },
  };
}

function parseScenarioFilter(argv: string[]): string[] {
  const exact = argv.find((arg) => arg.startsWith("--scenario="));
  if (exact) {
    const value = exact.slice("--scenario=".length).trim();
    return value === "" || value === "all"
      ? []
      : value.split(",").map((part) => part.trim()).filter(Boolean);
  }

  const index = argv.indexOf("--scenario");
  if (index !== -1) {
    const value = argv[index + 1]?.trim() ?? "";
    return value === "" || value === "all"
      ? []
      : value.split(",").map((part) => part.trim()).filter(Boolean);
  }

  return [];
}

function parseMockPort(argv: string[]): number {
  const exact = argv.find((arg) => arg.startsWith("--port="));
  const fromFlag = exact
    ? exact.slice("--port=".length).trim()
    : argv.includes("--port")
      ? (argv[argv.indexOf("--port") + 1] ?? "").trim()
      : "";
  const fromEnv = process.env.SOPHIA_E2E_MOCK_PORT?.trim() ?? "";
  const raw = fromFlag || fromEnv || "4999";
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid mock port: ${raw}`);
  }

  return parsed;
}

async function loadWebsiteCtas(filePath: string): Promise<WebsiteCta[]> {
  const html = await readFile(filePath, "utf8");
  const ctas: WebsiteCta[] = [];
  const anchorPattern = /<a\b[^>]*href="(https:\/\/wa\.me[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1];
    const innerHtml = match[2];
    const label = innerHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const url = new URL(href);
    const message = url.searchParams.get("text") ?? "";

    ctas.push({
      href,
      label,
      message,
      index: ctas.length + 1,
    });
  }

  return ctas;
}

function findWebsiteCta(ctas: WebsiteCta[], predicate: (cta: WebsiteCta) => boolean, description: string): WebsiteCta {
  const match = ctas.find(predicate);
  if (match) return match;

  const available = ctas
    .map((cta) => `#${cta.index} ${cta.label} -> ${cta.message}`)
    .join("\n");

  throw new Error(`Unable to find ${description} in bia-beltrao-website/index.html\nAvailable CTAs:\n${available}`);
}

async function cleanupPhone(db: SupabaseDb, schema: DbSchema, phone: string): Promise<void> {
  const { conversations, messages, bookings, clients, payments } = schema;
  const { eq } = await import("drizzle-orm");

  const client = await db.query.clients.findFirst({ where: eq(clients.phone, phone) });
  const phoneConversations = await db.select().from(conversations).where(eq(conversations.phone, phone));
  const clientConversations = client
    ? await db.select().from(conversations).where(eq(conversations.clientId, client.id))
    : [];
  const conversationsToDelete = new Map(
    [...phoneConversations, ...clientConversations].map((conversation) => [conversation.id, conversation])
  );

  for (const conversation of conversationsToDelete.values()) {
    await db.delete(messages).where(eq(messages.conversationId, conversation.id));
    await db.delete(conversations).where(eq(conversations.id, conversation.id));
  }

  if (!client) {
    capturedByPhone.delete(phone);
    return;
  }

  const clientBookings = await db.select().from(bookings).where(eq(bookings.clientId, client.id));
  for (const booking of clientBookings) {
    await db.delete(payments).where(eq(payments.bookingId, booking.id));
  }

  await db.delete(bookings).where(eq(bookings.clientId, client.id));
  await db.delete(clients).where(eq(clients.id, client.id));
  capturedByPhone.delete(phone);
}

async function cleanupPhones(db: SupabaseDb, schema: DbSchema, phones: string[]): Promise<void> {
  for (const phone of phones) {
    await cleanupPhone(db, schema, phone);
  }
}

async function loadTranscriptEvents(
  db: SupabaseDb,
  schema: DbSchema,
  phone: string
): Promise<CaptureEvent[]> {
  const { messages, conversations } = schema;
  const { and, asc, eq } = await import("drizzle-orm");
  const rows = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
      evolutionMessageId: messages.evolutionMessageId,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.phone, phone), eq(messages.role, "sophia")))
    .orderBy(asc(messages.createdAt));

  return rows.map((row, index) => ({
    kind: "text",
    phone,
    content: row.content,
    messageId: row.evolutionMessageId ?? `db_${index}`,
    createdAt: row.createdAt.getTime(),
  }));
}

function buildScenarioLogger(title: string): { log: (line: string) => void; flush: () => string[] } {
  const lines: string[] = [];
  return {
    log(line: string): void {
      lines.push(line);
    },
    flush(): string[] {
      return [`╔═══ ${title} ═══╗`, ...lines];
    },
  };
}

async function runTurn(
  db: SupabaseDb,
  schema: DbSchema,
  processMessage: (phone: string, message: string, options?: { pushName?: string }) => Promise<unknown>,
  phone: string,
  message: string,
  pushName: string | undefined,
  log: (line: string) => void
): Promise<TurnResult & { events: CaptureEvent[]; recentEvents: CaptureEvent[] }> {
  const beforeTextEvents = await loadTranscriptEvents(db, schema, phone);
  const beforeMediaCount = capturedByPhone.get(phone)?.length ?? 0;
  log(`  > ${message}`);

  await processMessage(phone, message, pushName ? { pushName } : undefined);

  const textEvents = await loadTranscriptEvents(db, schema, phone);
  const mediaEvents = (capturedByPhone.get(phone) ?? []).slice();
  const events = [...textEvents, ...mediaEvents].sort((a, b) => a.createdAt - b.createdAt);
  const recentTextEvents = textEvents.slice(beforeTextEvents.length);
  const recentMediaEvents = mediaEvents.slice(beforeMediaCount);
  const recentEvents = [...recentTextEvents, ...recentMediaEvents].sort(
    (a, b) => a.createdAt - b.createdAt
  );
  const recentTranscript = formatTranscript(recentEvents);
  const cumulativeTranscript = formatTranscript(events);

  log(`  < ${makePreview(recentTranscript || "[no reply]")}`);

  return {
    events,
    recentEvents,
    recentTranscript,
    cumulativeTranscript,
  };
}

const scenarioSpecs: ScenarioSpec[] = [
  {
    slug: "direct-info",
    title: "Direct info -> site -> CTA maquiagem",
    phone: "550009900001",
    pushName: "Cliente Info",
    async run({ ctas, log, turn, transcript, expect }) {
      const maquiagemCta = findWebsiteCta(
        ctas,
        (cta) => /Tenho interesse na Maquiagem Social/i.test(cta.message),
        "Maquiagem Social CTA"
      );

      log(`  [cta] using: ${maquiagemCta.message}`);

      const first = await turn("Oi, quero saber mais sobre os servicos.", "Cliente Info");
      expect.match(first.cumulativeTranscript, /link do nosso site|quer que eu te mande o link/i, "offers the site link");
      expect.notMatch(first.cumulativeTranscript, /biabeltrao\.com\.br/i, "has not sent the URL yet");
      expect.notMatch(first.recentTranscript, /\*\*/, "does not use double asterisks");

      const second = await turn("Pode me mandar o link do site.", "Cliente Info");
      expect.match(second.cumulativeTranscript, /biabeltrao\.com\.br/i, "sends the actual site URL");
      expect.count(second.cumulativeTranscript, /biabeltrao\.com\.br/gi, 1, "site URL is sent once");
      expect.notMatch(second.recentTranscript, /\*\*/, "still does not use double asterisks");

      const third = await turn(maquiagemCta.message, "Cliente Info");
      expect.notMatch(third.recentTranscript, /biabeltrao\.com\.br|confira nosso site/i, "does not resend the site");
      expect.match(third.recentTranscript, /maquiagem/i, "continues the maquiagem flow");
      expect.notMatch(third.recentTranscript, /\bcombo\b/i, "does not use combo wording");
      expect.notMatch(transcript(), /R\$\s?430\b/, "does not collapse service prices into a summed total");

      const finalTranscript = transcript();
      expect.notMatch(finalTranscript, /\*\*/, "keeps WhatsApp formatting with single asterisks only");
    },
  },
  {
    slug: "booking-maquiagem",
    title: "Direct booking maquiagem social",
    phone: "550009900002",
    pushName: "Alysson Fernando",
    async run({ turn, transcript, expect }) {
      const first = await turn(
        "Quero agendar maquiagem social para amanha as 14h. Nome completo: Alysson Fernando. CPF: 10285798456. E-mail: alyssonmelo@msn.com.br. Telefone: (81) 99999-0002.",
        "Alysson Fernando"
      );
      expect.notMatch(first.cumulativeTranscript, /biabeltrao\.com\.br/i, "does not send the site link in a direct booking flow");
      expect.notMatch(first.cumulativeTranscript, /\bcombo\b/i, "does not use combo wording");
      expect.notMatch(first.cumulativeTranscript, /\*\*/, "does not emit double asterisks");

      const second = await turn("Pode seguir com o agendamento.", "Alysson Fernando");
      expect.notMatch(second.cumulativeTranscript, /\bcombo\b/i, "still avoids combo wording");
      expect.notMatch(second.cumulativeTranscript, /\*\*/, "still avoids double asterisks");

      const third = await turn("Confirmo os dados e posso continuar.", "Alysson Fernando");
      expect.notMatch(third.cumulativeTranscript, /\bcombo\b/i, "still avoids combo wording after confirmation");
      expect.notMatch(third.cumulativeTranscript, /\*\*/, "still avoids double asterisks after confirmation");

      const finalTranscript = transcript();
      if (/vou confirmar seus dados/i.test(finalTranscript)) {
        expect.match(finalTranscript, /vou confirmar seus dados/i, "emits the confirmation block");
        expect.order(
          finalTranscript,
          [
            "Vou confirmar seus dados",
            "Nome completo:",
            "CPF:",
            "E-mail:",
            "Telefone:",
            "Serviço:",
            "Data e horário:",
          ],
          "keeps the confirmation fields in the expected order"
        );
      } else {
        expect.fail("emits the confirmation block");
      }
    },
  },
  {
    slug: "site-maquiagem",
    title: "CTA maquiagem social from site",
    phone: "550009900003",
    pushName: "Cliente Maquiagem",
    async run({ ctas, log, turn, transcript, expect }) {
      const maquiagemCta = findWebsiteCta(
        ctas,
        (cta) => /Tenho interesse na Maquiagem Social/i.test(cta.message),
        "Maquiagem Social CTA"
      );

      log(`  [cta] using: ${maquiagemCta.message}`);

      const first = await turn(maquiagemCta.message, "Cliente Maquiagem");
      expect.notMatch(first.cumulativeTranscript, /biabeltrao\.com\.br/i, "does not resend the site after a CTA");
      expect.notMatch(first.recentTranscript, /\*\*/, "uses single asterisks only");
      expect.notMatch(first.recentTranscript, /\bcombo\b/i, "does not use combo wording");

      const second = await turn("Apenas maquiagem, obrigada.", "Cliente Maquiagem");
      expect.notMatch(second.cumulativeTranscript, /biabeltrao\.com\.br/i, "still does not resend the site");
      expect.match(transcript(), /maquiagem/i, "stays in the maquiagem flow");
      expect.notMatch(transcript(), /\*\*/, "keeps WhatsApp formatting clean");
    },
  },
  {
    slug: "site-penteado",
    title: "CTA penteado social from site",
    phone: "550009900004",
    pushName: "Cliente Penteado",
    async run({ ctas, log, turn, transcript, expect }) {
      const penteadoCta = findWebsiteCta(
        ctas,
        (cta) => /Tenho interesse em Penteado Social - Lisos & Ondulados/i.test(cta.message),
        "Penteado Social CTA"
      );

      log(`  [cta] using: ${penteadoCta.message}`);

      const first = await turn(penteadoCta.message, "Cliente Penteado");
      expect.notMatch(first.cumulativeTranscript, /biabeltrao\.com\.br/i, "does not resend the site after a CTA");
      expect.notMatch(first.recentTranscript, /\*\*/, "uses single asterisks only");

      const second = await turn("Apenas penteado, obrigada.", "Cliente Penteado");
      expect.notMatch(second.cumulativeTranscript, /\bcombo\b/i, "does not use combo wording");
      expect.notMatch(second.cumulativeTranscript, /biabeltrao\.com\.br/i, "still does not resend the site");
      expect.match(transcript(), /penteado/i, "stays in the penteado flow");
    },
  },
  {
    slug: "site-noiva",
    title: "Noiva from site with gentle handoff",
    phone: "550009900005",
    pushName: "Cliente Noiva",
    async run({ ctas, log, turn, transcript, expect }) {
      const noivaCta = findWebsiteCta(
        ctas,
        (cta) => /agendar uma consultoria para noivas \(Dia da Noiva\)/i.test(cta.message),
        "Dia da Noiva CTA"
      );

      log(`  [cta] using: ${noivaCta.message}`);

      const first = await turn(noivaCta.message, "Cliente Noiva");
      expect.notMatch(first.cumulativeTranscript, /biabeltrao\.com\.br/i, "does not resend the site after a bridal CTA");
      expect.notMatch(first.recentTranscript, /Beatriz j[aá] vai te atender|handoff|transfer/i, "does not hand off immediately");
      expect.notMatch(first.recentTranscript, /\*\*/, "uses single asterisks only");

      const second = await turn("Quais servicos estao inclusos?", "Cliente Noiva");
      expect.notMatch(second.cumulativeTranscript, /Beatriz j[aá] vai te atender|handoff|transfer/i, "does not hand off after the first question");
      expect.match(second.cumulativeTranscript, /noiva|maquiagem|penteado/i, "keeps the bridal context active");

      const third = await turn("Quero seguir com o fechamento.", "Cliente Noiva");
      expect.notMatch(third.cumulativeTranscript, /biabeltrao\.com\.br/i, "still does not resend the site");
      expect.notMatch(third.cumulativeTranscript, /\*\*/, "keeps WhatsApp formatting clean");
      expect.match(transcript(), /noiva|fech|agend|consulta/i, "moves toward a closing action");
    },
  },
  {
    slug: "ambos-direct",
    title: "Direct both-services flow",
    phone: "550009900006",
    pushName: "Cliente Ambos",
    async run({ log, turn, transcript, expect }) {
      const first = await turn(
        "Quero maquiagem e penteado juntos para o mesmo evento. Me mostra as opcoes para ambos.",
        "Cliente Ambos"
      );
      expect.notMatch(first.cumulativeTranscript, /\bcombo\b/i, "does not use combo wording");
      expect.notMatch(first.cumulativeTranscript, /biabeltrao\.com\.br/i, "does not send the site in a direct combined-service flow");
      expect.match(first.cumulativeTranscript, /ambos|maquiagem e penteado|os dois/i, "keeps the combined-service wording");
      expect.match(first.cumulativeTranscript, /express|sequencial/i, "offers express and sequencial");
      expect.notMatch(first.cumulativeTranscript, /R\$\s?430\b/, "does not sum the service prices");
      expect.notMatch(first.cumulativeTranscript, /\*\*/, "uses single asterisks only");

      const second = await turn("Quero a opcao sequencial.", "Cliente Ambos");
      expect.notMatch(second.cumulativeTranscript, /\bcombo\b/i, "still avoids combo wording");
      expect.notMatch(second.cumulativeTranscript, /R\$\s?430\b/, "still avoids a summed total");
      expect.match(transcript(), /sequencial|express|maquiagem|penteado/i, "keeps the both-services flow active");
    },
  },
];

async function main(): Promise<number> {
  const mockPort = parseMockPort(process.argv.slice(2));
  process.env.VITEST = process.env.VITEST || "1";
  process.env.EVOLUTION_API_URL = `http://127.0.0.1:${mockPort}`;
  process.env.EVOLUTION_API_KEY = "mock-key";
  process.env.EVOLUTION_INSTANCE_NAME = "mock-instance";
  process.env.MAQUIADORA_PHONE = "5500099777777";
  delete process.env.MAQUIADORA_EMAIL;
  delete process.env.RESEND_API_KEY;

  const websiteCtas = await loadWebsiteCtas(WEBSITE_INDEX_PATH);
  const selectedFilters = parseScenarioFilter(process.argv.slice(2));
  const selectedScenarios =
    selectedFilters.length === 0
      ? scenarioSpecs
      : scenarioSpecs.filter((scenario) => selectedFilters.includes(scenario.slug));

  if (selectedFilters.length > 0 && selectedScenarios.length === 0) {
    console.log(`[setup] Unknown scenario filter: ${selectedFilters.join(", ")}`);
    console.log(`[setup] Available scenarios: ${scenarioSpecs.map((scenario) => scenario.slug).join(", ")}`);
    return 1;
  }

  const [sophiaModule, dbModule, schema] = await Promise.all([
    import("../src/modules/sophia/sophia.service.js"),
    import("../src/config/supabase.js"),
    import("@studio/db"),
  ]);

  const processMessage = sophiaModule.processMessage as (
    phone: string,
    message: string,
    options?: { pushName?: string }
  ) => Promise<unknown>;
  const db = dbModule.db as SupabaseDb;

  console.log(`[setup] Loaded ${websiteCtas.length} wa.me CTAs from bia-beltrao-website/index.html`);
  console.log(`[setup] Selected scenarios: ${selectedScenarios.map((scenario) => scenario.slug).join(", ")}`);

  const phones = selectedScenarios.map((scenario) => scenario.phone);
  await cleanupPhones(db, schema, phones);
  console.log("[cleanup] Fake-phone state wiped before test");

  const mockServer = createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      let parsed: Record<string, unknown> = {};

      try {
        parsed = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }

      const phone = typeof parsed.number === "string" && parsed.number.trim() ? parsed.number.trim() : "+5500000000000";
      const endpoint = req.url ?? "";

      if (endpoint.includes("/message/sendText/")) {
        const text = typeof parsed.text === "string" ? parsed.text : "";
        pushCapture({
          kind: "text",
          phone,
          content: text,
          messageId: `mock_${randomUUID()}`,
          createdAt: Date.now(),
        });
      } else if (endpoint.includes("/message/sendMedia/")) {
        const fileName = typeof parsed.fileName === "string" ? parsed.fileName : "?";
        const caption = typeof parsed.caption === "string" && parsed.caption.trim() ? ` | ${parsed.caption.trim()}` : "";
        pushCapture({
          kind: "media",
          phone,
          content: `${fileName}${caption}`,
          messageId: `mock_${randomUUID()}`,
          createdAt: Date.now(),
        });
      }

      res.setHeader("Content-Type", "application/json");
      if (endpoint.includes("/message/sendText/") || endpoint.includes("/message/sendMedia/")) {
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            key: { remoteJid: phone, fromMe: true, id: `mock_${randomUUID()}` },
            messageTimestamp: String(Math.floor(Date.now() / 1000)),
            status: "PENDING",
          })
        );
        return;
      }

      if (endpoint.includes("/chat/updatePresence/")) {
        res.statusCode = 200;
        res.end("{}");
        return;
      }

      res.statusCode = 404;
      res.end("{}");
    });
  });
  const sockets = new Set<NodeSocket>();
  mockServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  mockServer.listen(mockPort);
  await once(mockServer, "listening");
  console.log(`[mock] Evolution mock listening on http://127.0.0.1:${mockPort}`);

  type ScenarioResult = {
    slug: string;
    title: string;
    phone: string;
    passed: boolean;
    failures: string[];
    logLines: string[];
  };

  async function runScenario(spec: ScenarioSpec): Promise<ScenarioResult> {
    const logger = buildScenarioLogger(spec.title);
    const expect = createExpect(logger.log);
    ensureBuffer(spec.phone);
    let buffer = await loadTranscriptEvents(db, schema, spec.phone);
    let recentBuffer: CaptureEvent[] = [];

    logger.log(`  phone: ${spec.phone}`);

    const context: ScenarioContext = {
      phone: spec.phone,
      ctas: websiteCtas,
      log: logger.log,
      expect,
      transcript: () => formatTranscript(buffer),
      recent: () => formatTranscript(recentBuffer),
      turn: async (message: string, pushName?: string) => {
        const result = await runTurn(
          db,
          schema,
          processMessage,
          spec.phone,
          message,
          pushName ?? spec.pushName,
          logger.log
        );
        buffer = result.events;
        recentBuffer = result.recentEvents;
        return result;
      },
    };

    try {
      await spec.run(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.log(`  ✗ scenario error: ${message}`);
      return {
        slug: spec.slug,
        title: spec.title,
        phone: spec.phone,
        passed: false,
        failures: [`${spec.slug}: scenario error - ${message}`],
        logLines: logger.flush(),
      };
    }

    const scenarioResults = expect.getResults();
    const failures = scenarioResults.filter((line) => line.startsWith("✗")).map((line) => `${spec.slug}: ${line.slice(2)}`);

    return {
      slug: spec.slug,
      title: spec.title,
      phone: spec.phone,
      passed: failures.length === 0,
      failures,
      logLines: logger.flush(),
    };
  }

  try {
    const results = await Promise.all(selectedScenarios.map((scenario) => runScenario(scenario)));
    let passed = 0;
    let failed = 0;
    const allFailures: string[] = [];

    for (const result of results) {
      console.log("");
      for (const line of result.logLines) console.log(line);
      if (result.passed) {
        passed += 1;
      } else {
        failed += 1;
        allFailures.push(...result.failures);
      }
      console.log(`  result: ${result.passed ? "PASS" : "FAIL"} (${result.phone})`);
    }

    console.log("");
    console.log("═══ SUMMARY ═══");
    console.log(`  passed: ${passed}`);
    console.log(`  failed: ${failed}`);
    if (allFailures.length > 0) {
      console.log("  failures:");
      for (const failure of allFailures) console.log(`    - ${failure}`);
    }

    return failed > 0 ? 1 : 0;
  } finally {
    console.log("\n[cleanup] Closing mock server...");
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  }
}

const exitCode = await main();
process.exit(exitCode);
