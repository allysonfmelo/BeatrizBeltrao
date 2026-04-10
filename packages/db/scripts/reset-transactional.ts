/**
 * reset-transactional.ts — one-off script para zerar dados transacionais.
 *
 * Tabelas afetadas (TRUNCATE RESTART IDENTITY CASCADE):
 *   - payments
 *   - bookings
 *   - messages
 *   - conversations
 *   - clients
 *
 * Tabelas PRESERVADAS (NÃO são tocadas):
 *   - services  (catálogo)
 *   - settings  (business_hours, deposit_percentage, etc.)
 *
 * Uso:
 *   DATABASE_URL="postgres://..." tsx packages/db/scripts/reset-transactional.ts
 *
 * Requer a variável de ambiente DATABASE_URL apontando para o banco alvo.
 * O script imprime counts antes/depois de cada tabela para auditoria.
 */

import postgres from "postgres";

const TRANSACTIONAL_TABLES = [
  "payments",
  "bookings",
  "messages",
  "conversations",
  "clients",
] as const;

const PRESERVED_TABLES = ["services", "settings"] as const;

async function countRows(sql: postgres.Sql, tables: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM ${sql(table)}`;
    counts[table] = Number(result[0]?.count ?? 0);
  }
  return counts;
}

function printCounts(label: string, counts: Record<string, number>): void {
  console.log(`\n${label}`);
  const maxTable = Math.max(...Object.keys(counts).map((t) => t.length));
  for (const [table, count] of Object.entries(counts)) {
    console.log(`  ${table.padEnd(maxTable)}  ${count.toLocaleString("pt-BR")}`);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`  ${"TOTAL".padEnd(maxTable)}  ${total.toLocaleString("pt-BR")}`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DATABASE_URL is required");
    process.exit(1);
  }

  // Safety log — show only host portion, never credentials
  try {
    const url = new URL(databaseUrl);
    console.log(`▸ Conectando em ${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "") || "(default)"}`);
  } catch {
    console.log("▸ Conectando (URL não parseável)");
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    // 1. Pre-counts
    const preTransactional = await countRows(sql, TRANSACTIONAL_TABLES);
    const prePreserved = await countRows(sql, PRESERVED_TABLES);
    printCounts("📊 ANTES — dados transacionais (serão zerados):", preTransactional);
    printCounts("🔒 ANTES — dados preservados (NÃO serão tocados):", prePreserved);

    const totalBefore = Object.values(preTransactional).reduce((a, b) => a + b, 0);
    if (totalBefore === 0) {
      console.log("\n✓ Nada para limpar — tabelas transacionais já estão zeradas.");
      return;
    }

    // 2. TRUNCATE — statement único e atômico por natureza no Postgres
    console.log("\n▸ Executando TRUNCATE TABLE payments, bookings, messages, conversations, clients RESTART IDENTITY CASCADE...");
    await sql`TRUNCATE TABLE payments, bookings, messages, conversations, clients RESTART IDENTITY CASCADE`;
    console.log("✓ TRUNCATE executado");

    // 3. Post-counts
    const postTransactional = await countRows(sql, TRANSACTIONAL_TABLES);
    const postPreserved = await countRows(sql, PRESERVED_TABLES);
    printCounts("📊 DEPOIS — dados transacionais:", postTransactional);
    printCounts("🔒 DEPOIS — dados preservados:", postPreserved);

    // 4. Sanity checks
    const totalAfterTransactional = Object.values(postTransactional).reduce((a, b) => a + b, 0);
    if (totalAfterTransactional !== 0) {
      console.error(`\n✗ ERRO: ainda há ${totalAfterTransactional} linhas em tabelas transacionais após TRUNCATE`);
      process.exit(2);
    }

    const servicesDiff = postPreserved.services !== prePreserved.services;
    const settingsDiff = postPreserved.settings !== prePreserved.settings;
    if (servicesDiff || settingsDiff) {
      console.error("\n✗ ERRO: tabelas preservadas foram alteradas!");
      console.error(`  services: ${prePreserved.services} → ${postPreserved.services}`);
      console.error(`  settings: ${prePreserved.settings} → ${postPreserved.settings}`);
      process.exit(3);
    }

    console.log(`\n✓ Reset concluído. ${totalBefore.toLocaleString("pt-BR")} linhas transacionais apagadas. Catálogo (services=${postPreserved.services}) e config (settings=${postPreserved.settings}) preservados.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\n✗ Reset falhou:", err);
  process.exit(1);
});
