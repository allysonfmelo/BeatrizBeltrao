/**
 * seed/index.ts — popula a tabela `settings` (KV) a partir do YAML operacional.
 *
 * Fonte de verdade: `assets/catalog-html/service-reference.yaml`
 *
 * Por que só settings?
 *   A tabela `services` é sincronizada automaticamente no boot da API
 *   (`apps/api/src/main.ts:34` → `syncReferenceServicesToDb()`), então não
 *   faz sentido duplicar a lógica aqui. Este seed cobre APENAS o que o
 *   sync automático NÃO cobre:
 *     - business_hours  (horário comercial — não existe no YAML, usa constant)
 *     - deposit_percentage  (30 — do policies do YAML)
 *     - payment_timeout_hours  (24 — do policies do YAML)
 *     - daily_report_time  (20:00 — operacional, fixo)
 *     - faq  (perguntas e respostas do YAML, serializadas como JSONB)
 *
 * Idempotente: usa `onConflictDoUpdate` para permitir re-execução segura.
 *
 * Uso:
 *   DATABASE_URL="postgres://..." tsx packages/db/src/seed/index.ts
 */

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import YAML from "yaml";
import { createDb } from "../index.js";
import { settings } from "../schema/index.js";

/** Resolves the path to service-reference.yaml, trying multiple common locations. */
function resolveReferencePath(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    // From packages/db/src/seed/ → repo root → assets/
    resolve(here, "../../../../assets/catalog-html/service-reference.yaml"),
    // Running via tsx from repo root
    resolve(process.cwd(), "assets/catalog-html/service-reference.yaml"),
  ];

  for (const path of candidates) {
    try {
      statSync(path);
      return path;
    } catch {
      // try next
    }
  }

  throw new Error(`service-reference.yaml not found. Tried: ${candidates.join(", ")}`);
}

interface ReferenceYaml {
  policies: {
    deposit_percentage: number;
    payment_timeout_hours: number;
  };
  faq: Array<{ question: string; answer: string }>;
}

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  // Safety log — only host portion, no credentials
  try {
    const url = new URL(databaseUrl);
    console.log(`▸ Conectando em ${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "")}`);
  } catch {
    console.log("▸ Conectando (URL não parseável)");
  }

  const referencePath = resolveReferencePath();
  console.log(`▸ Lendo referência de ${referencePath}`);
  const raw = readFileSync(referencePath, "utf8");
  const reference = YAML.parse(raw) as ReferenceYaml;

  const db = createDb(databaseUrl);

  // Bundle of settings to upsert
  const entries: Array<{
    key: string;
    value: unknown;
    description: string;
  }> = [
    {
      key: "business_hours",
      value: { start: "05:00", end: "22:00", days: [1, 2, 3, 4, 5, 6] },
      description: "Horário comercial do estúdio (segunda a sábado, 05:00–22:00 horário de Brasília)",
    },
    {
      key: "deposit_percentage",
      value: reference.policies.deposit_percentage,
      description: "Percentual do sinal obrigatório sobre o valor do serviço",
    },
    {
      key: "payment_timeout_hours",
      value: reference.policies.payment_timeout_hours,
      description: "Horas limite para pagamento do sinal antes do cancelamento automático",
    },
    {
      key: "daily_report_time",
      value: "20:00",
      description: "Horário de envio do resumo diário para a maquiadora",
    },
    {
      key: "faq",
      value: reference.faq,
      description: "Perguntas frequentes (derivadas de service-reference.yaml)",
    },
  ];

  console.log(`\n▸ Upserting ${entries.length} settings...`);
  for (const entry of entries) {
    await db
      .insert(settings)
      .values({
        key: entry.key,
        value: entry.value,
        description: entry.description,
      })
      .onConflictDoUpdate({
        target: settings.key,
        set: {
          value: entry.value,
          description: entry.description,
          updatedAt: new Date(),
        },
      });
    console.log(`  ✓ ${entry.key}`);
  }

  console.log(`\n✓ Seed completed. ${entries.length} settings upserted.`);
  console.log("  Serviços (tabela services) são populados automaticamente no boot da API via syncReferenceServicesToDb().");
  process.exit(0);
}

seed().catch((err) => {
  console.error("\n✗ Seed failed:", err);
  process.exit(1);
});
