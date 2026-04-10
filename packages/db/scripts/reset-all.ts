/**
 * reset-all.ts — DESTRUCTIVE one-off script para zerar TODAS as tabelas.
 *
 * ⚠️  APAGA TUDO, inclusive catálogo (services) e configurações (settings).
 *     Só rode se quiser um banco completamente vazio.
 *
 * Tabelas afetadas (TRUNCATE RESTART IDENTITY CASCADE):
 *   - payments
 *   - bookings
 *   - messages
 *   - conversations
 *   - clients
 *   - services
 *   - settings
 *
 * Uso:
 *   DATABASE_URL="postgres://..." tsx packages/db/scripts/reset-all.ts
 *
 * Requer a variável de ambiente DATABASE_URL apontando para o banco alvo.
 * O script imprime counts antes/depois de cada tabela para auditoria.
 * Depois do TRUNCATE, rode `pnpm db:seed` (que lê o service-reference.yaml)
 * para repopular services e settings.
 */

import postgres from "postgres";

const ALL_TABLES = [
  "payments",
  "bookings",
  "messages",
  "conversations",
  "clients",
  "services",
  "settings",
] as const;

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
    console.log(`⚠️  WIPE TOTAL — ${url.hostname}:${url.port || "5432"}/${url.pathname.replace(/^\//, "") || "(default)"}`);
    console.log("    Todas as 7 tabelas serão TRUNCATE'd incluindo services e settings.");
  } catch {
    console.log("⚠️  WIPE TOTAL (URL não parseável)");
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    // 1. Pre-counts
    const pre = await countRows(sql, ALL_TABLES);
    printCounts("📊 ANTES — TODAS as tabelas:", pre);

    const totalBefore = Object.values(pre).reduce((a, b) => a + b, 0);
    if (totalBefore === 0) {
      console.log("\n✓ Nada para limpar — banco já está vazio.");
      return;
    }

    // 2. TRUNCATE — statement único e atômico por natureza no Postgres
    console.log("\n▸ Executando TRUNCATE TABLE payments, bookings, messages, conversations, clients, services, settings RESTART IDENTITY CASCADE...");
    await sql`TRUNCATE TABLE payments, bookings, messages, conversations, clients, services, settings RESTART IDENTITY CASCADE`;
    console.log("✓ TRUNCATE executado");

    // 3. Post-counts
    const post = await countRows(sql, ALL_TABLES);
    printCounts("📊 DEPOIS — TODAS as tabelas:", post);

    // 4. Sanity check
    const totalAfter = Object.values(post).reduce((a, b) => a + b, 0);
    if (totalAfter !== 0) {
      console.error(`\n✗ ERRO: ainda há ${totalAfter} linhas após TRUNCATE`);
      process.exit(2);
    }

    console.log(`\n✓ Reset total concluído. ${totalBefore.toLocaleString("pt-BR")} linhas apagadas no total.`);
    console.log("  Próximo passo: rode `tsx packages/db/src/seed/index.ts` para repopular services e settings do YAML.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\n✗ Reset-all falhou:", err);
  process.exit(1);
});
