import { fileURLToPath } from "node:url";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import { services } from "@studio/db";
import { logger } from "../../lib/logger.js";

const REFERENCE_PATH = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../assets/catalog-html/service-reference.yaml"
);

const referenceSchema = z.object({
  version: z.string(),
  updated_at: z.string(),
  policies: z.object({
    deposit_percentage: z.number(),
    payment_timeout_hours: z.number(),
    handoff_immediate_topics: z.array(z.string()),
    source_priority: z.array(z.string()),
  }),
  pdf_catalog: z.record(
    z.object({
      title: z.string(),
      path: z.string(),
    })
  ),
  services: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      type: z.enum(["maquiagem", "penteado", "combo"]),
      category: z.enum(["estudio", "externo"]),
      mode: z.string(),
      bookable: z.boolean(),
      sync_to_db: z.boolean().default(false),
      pdf_topic: z.enum(["maquiagem", "penteado", "noivas"]),
      pricing: z.object({
        policy: z.enum(["fixed", "sob_consulta"]),
        amount_brl: z.number().optional(),
      }),
      duration_minutes: z.number().optional(),
      includes: z.array(z.string()).optional(),
      care_notes: z.array(z.string()).optional(),
      notes: z.array(z.string()).optional(),
      handoff_required: z.boolean().optional(),
    })
  ),
  faq: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
    })
  ),
});

export type ServiceReference = z.infer<typeof referenceSchema>;
export type ReferenceService = ServiceReference["services"][number];
export type CatalogTopic = keyof ServiceReference["pdf_catalog"];

let cachedReference: ServiceReference | null = null;
let cachedMtime = 0;

function loadFromDisk(): ServiceReference {
  const mtimeMs = statSync(REFERENCE_PATH).mtimeMs;

  if (cachedReference && cachedMtime === mtimeMs) {
    return cachedReference;
  }

  const raw = readFileSync(REFERENCE_PATH, "utf8");
  const parsed = referenceSchema.parse(YAML.parse(raw));

  cachedReference = parsed;
  cachedMtime = mtimeMs;

  return parsed;
}

export function getServiceReference(): ServiceReference {
  return loadFromDisk();
}

export function getReferenceServices(): ReferenceService[] {
  return getServiceReference().services;
}

export function getPdfCatalogPath(topic: CatalogTopic): string | null {
  const reference = getServiceReference();
  const entry = reference.pdf_catalog[topic];

  if (!entry) return null;

  return resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../../", entry.path);
}

export function buildServiceReferenceSummary(): string {
  const reference = getServiceReference();

  const serviceLines = reference.services.map((service) => {
    const price =
      service.pricing.policy === "fixed" && typeof service.pricing.amount_brl === "number"
        ? `R$ ${service.pricing.amount_brl.toFixed(2)}`
        : "sob consulta";

    const booking = service.bookable ? "agendavel" : "nao agendavel";
    const duration =
      typeof service.duration_minutes === "number"
        ? `${service.duration_minutes} min`
        : "duracao sob consulta";

    return `- ${service.name} (${service.type}/${service.category}) | ${price} | ${duration} | ${booking}`;
  });

  const faqLines = reference.faq.map((item) => `- ${item.question}: ${item.answer}`);

  return [
    "### REFERENCIA OPERACIONAL (PRIORIDADE MAXIMA)",
    "",
    "Servicos:",
    ...serviceLines,
    "",
    "FAQ:",
    ...faqLines,
  ].join("\n");
}

export async function syncReferenceServicesToDb(): Promise<{
  created: number;
  updated: number;
  skipped: number;
}> {
  const reference = getServiceReference();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of reference.services) {
    const amount = item.pricing.amount_brl;
    const duration = item.duration_minutes;
    const shouldSync =
      item.sync_to_db &&
      item.bookable &&
      item.pricing.policy === "fixed" &&
      typeof amount === "number" &&
      typeof duration === "number";

    if (!shouldSync) {
      skipped++;
      continue;
    }

    const existing = await db.query.services.findFirst({
      where: eq(services.name, item.name),
    });

    const values = {
      name: item.name,
      type: item.type,
      category: item.category,
      description: item.notes?.join(" | ") ?? null,
      price: amount.toFixed(2),
      durationMinutes: duration,
      isActive: true,
    };

    if (existing) {
      await db
        .update(services)
        .set({
          ...values,
          updatedAt: new Date(),
        })
        .where(eq(services.id, existing.id));
      updated++;
      continue;
    }

    await db.insert(services).values(values);
    created++;
  }

  logger.info("Service reference sync completed", { created, updated, skipped });

  return { created, updated, skipped };
}
