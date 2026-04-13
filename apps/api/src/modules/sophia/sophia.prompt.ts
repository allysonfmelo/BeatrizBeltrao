import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatPhone } from "@studio/shared/utils";
import type { FirstMessageCategory } from "./sophia.context.js";

interface ServiceRow {
  id: string;
  name: string;
  type: string;
  category: string;
  description: string | null;
  price: string;
  durationMinutes: number;
  isActive: boolean;
}

interface CollectedData {
  serviceName?: string;
  serviceId?: string;
  scheduledDate?: string;
  scheduledTime?: string;
  clientName?: string;
  clientCpf?: string;
  clientEmail?: string;
  [key: string]: unknown;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPromptFile(filename: string): string {
  const candidates = [
    join(__dirname, filename),
    join(process.cwd(), filename),
    join(process.cwd(), "src", "modules", "sophia", filename),
    join(process.cwd(), "dist", "modules", "sophia", filename),
    join("/app", filename),
    join("/app", "src", "modules", "sophia", filename),
    join("/app", "dist", "modules", "sophia", filename),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // try next
    }
  }
  throw new Error(`Unable to locate prompt file ${filename}. Tried: ${candidates.join(", ")}`);
}

const SYSTEM_MD = loadPromptFile("sophia.system.md");
const RUNTIME_MD = loadPromptFile("sophia.runtime.md");

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
] as const;

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function buildDateLookupTable(now: Date): string {
  const rows: string[] = [];
  for (let i = 0; i <= 14; i++) {
    const d = addDays(now, i);
    const wd = WEEKDAYS[d.getDay()];
    let label: string;
    if (i === 0) label = "hoje";
    else if (i === 1) label = "amanhã";
    else if (i === 2) label = "depois de amanhã";
    else label = `daqui a ${i} dias`;
    rows.push(`  - ${isoDate(d)} (${wd}) ← ${label}`);
  }
  return rows.join("\n");
}

function buildNextWeekdayTable(now: Date): string {
  const rows: string[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    let offset = (weekday - now.getDay() + 7) % 7;
    if (offset === 0) offset = 7;
    const d = addDays(now, offset);
    rows.push(`  - "próximo(a) ${WEEKDAYS[weekday]}" → ${isoDate(d)}`);
  }
  return rows.join("\n");
}

function buildCollectedSummary(collected: CollectedData): string {
  const entries = Object.entries(collected).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return "Nenhum dado coletado ainda.";

  return entries
    .map(([k, v]) => {
      if (k === "bookingDraft" && typeof v === "object" && v !== null) {
        return Object.entries(v as Record<string, unknown>)
          .map(([dk, dv]) => `- bookingDraft.${dk}: ${dv}`)
          .join("\n");
      }
      return `- ${k}: ${v}`;
    })
    .join("\n");
}

function buildServiceList(services: ServiceRow[]): string {
  return services
    .map(
      (s) =>
        `- ${s.name} (${s.type}/${s.category}): R$ ${parseFloat(s.price).toFixed(2)} — ${s.durationMinutes} min — ID: ${s.id}`
    )
    .join("\n");
}

function buildServiceIdMap(services: ServiceRow[]): string {
  return services.map((s) => `- ${s.name}: ${s.id}`).join("\n");
}

/**
 * Builds the full system prompt for Sophia.
 *
 * Composition: sophia.system.md (static rules) + sophia.runtime.md (dynamic
 * context with {{placeholders}} filled from the current conversation state).
 */
export function buildSystemPrompt(context: {
  services: ServiceRow[];
  serviceReferenceSummary: string;
  collectedData: CollectedData;
  conversationStatus: string;
  clientName?: string;
  hasPendingBooking: boolean;
  phone: string;
  firstClientMessage: string;
  firstMessageCategory: FirstMessageCategory;
  websiteLinkAlreadySent: boolean;
}): string {
  const now = new Date();
  const todayISO = isoDate(now);
  const todayWeekday = WEEKDAYS[now.getDay()];

  const replacements: Record<string, string> = {
    todayISO,
    todayWeekday,
    conversationStatus: context.conversationStatus,
    clientName: context.clientName ?? "Não identificada",
    phoneDisplay: formatPhone(context.phone),
    hasPendingBooking: context.hasPendingBooking ? "Sim" : "Não",
    firstMessageCategory: context.firstMessageCategory,
    websiteLinkAlreadySent: context.websiteLinkAlreadySent ? "Sim" : "Não",
    firstClientMessage: context.firstClientMessage || "Não disponível",
    collectedDataSummary: buildCollectedSummary(context.collectedData),
    dateLookupTable: buildDateLookupTable(now),
    nextWeekdayTable: buildNextWeekdayTable(now),
    serviceIdMap: buildServiceIdMap(context.services),
    serviceList: buildServiceList(context.services),
    serviceReferenceSummary: context.serviceReferenceSummary,
  };

  const runtimeRendered = Object.entries(replacements).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    RUNTIME_MD
  );

  return `${SYSTEM_MD}\n\n---\n\n${runtimeRendered}`;
}
