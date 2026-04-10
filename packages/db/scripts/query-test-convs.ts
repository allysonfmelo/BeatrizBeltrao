import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  const convs = await sql<Array<{
    id: string;
    phone: string;
    status: string;
    is_handoff: boolean;
    handoff_reason: string | null;
    created_at: string;
  }>>`
    SELECT id::text AS id, phone, status, is_handoff, handoff_reason, created_at::text AS created_at
    FROM conversations
    WHERE phone LIKE '5500099%'
    ORDER BY phone, created_at ASC
  `;

  console.log(`\nTotal conversations for test phones: ${convs.length}`);

  for (const c of convs) {
    console.log(`\n=== Conv ${c.id.slice(0, 8)} phone=${c.phone} status=${c.status} handoff=${c.is_handoff}`);
    console.log(`    created: ${c.created_at}`);
    console.log(`    reason: ${c.handoff_reason ?? "(none)"}`);

    const msgs = await sql<Array<{
      role: string;
      content: string;
      created_at: string;
    }>>`
      SELECT role, content, created_at::text AS created_at
      FROM messages
      WHERE conversation_id = ${c.id}
      ORDER BY created_at ASC
    `;

    for (const m of msgs) {
      const t = m.created_at.slice(11, 19);
      console.log(`    ${t} ${m.role.padEnd(8)} ${m.content.slice(0, 120)}`);
    }
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
