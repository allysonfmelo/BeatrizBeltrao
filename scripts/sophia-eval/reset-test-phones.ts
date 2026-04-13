/**
 * Resets conversation/message state for the 4 test phones so each scenario
 * starts from a clean slate. Does NOT touch clients or bookings tables to
 * avoid collateral damage to any existing state.
 *
 * Usage: DATABASE_URL=... pnpm tsx scripts/sophia-eval/reset-test-phones.ts [phone1 phone2 ...]
 *
 * Defaults to the 4 approved test phones if no args passed.
 */
import postgres from "postgres";

const DEFAULT_PHONES = [
  "5581994599042",
  "5581994599040",
  "5581999245606",
  "5581996069046",
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const phones = process.argv.slice(2);
  const targets = phones.length > 0 ? phones : DEFAULT_PHONES;
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const phone of targets) {
      const conversations = await sql<Array<{ id: string }>>`
        SELECT id::text AS id FROM conversations WHERE phone = ${phone}
      `;
      const ids = conversations.map((c) => c.id);
      if (ids.length === 0) {
        console.log(`  ${phone}: no conversations to reset`);
        continue;
      }
      await sql`DELETE FROM messages WHERE conversation_id = ANY(${ids})`;
      await sql`DELETE FROM conversations WHERE id = ANY(${ids})`;
      console.log(`  ${phone}: deleted ${ids.length} conversation(s) + all messages`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("reset failed:", err);
  process.exit(1);
});
