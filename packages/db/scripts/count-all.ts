/**
 * count-all.ts — quick diagnostic: counts all rows per table and shows
 * the populated services + settings after seed + sync.
 */

import postgres from "postgres";

const TABLES = [
  "clients",
  "conversations",
  "messages",
  "bookings",
  "payments",
  "services",
  "settings",
] as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ DATABASE_URL is required");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    console.log("📊 Row counts per table:");
    for (const table of TABLES) {
      const [{ count }] = await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM ${sql(table)}`;
      console.log(`  ${table.padEnd(16)} ${count}`);
    }

    console.log("\n📋 Services:");
    const services = await sql<{ name: string; type: string; category: string; price: string; duration_minutes: number }[]>`
      SELECT name, type, category, price, duration_minutes FROM services ORDER BY name
    `;
    for (const s of services) {
      console.log(`  - ${s.name.padEnd(36)} ${s.type}/${s.category}  R$ ${s.price}  ${s.duration_minutes} min`);
    }

    console.log("\n⚙️  Settings:");
    const settingRows = await sql<{ key: string; value: unknown }[]>`SELECT key, value FROM settings ORDER BY key`;
    for (const s of settingRows) {
      const display = typeof s.value === "object" ? JSON.stringify(s.value).slice(0, 80) : String(s.value);
      console.log(`  - ${s.key.padEnd(24)} ${display}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("✗ Count failed:", err);
  process.exit(1);
});
