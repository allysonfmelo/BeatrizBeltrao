import { createDb, messages, conversations } from "@studio/db";
import { desc, eq } from "drizzle-orm";

const db = createDb(process.env.DATABASE_URL!);

const convs = await db.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(3);
console.log("=== LAST 3 CONVERSATIONS ===");
for (const c of convs) {
  console.log(`\n--- conv ${c.id} | phone ${c.phone} | status ${c.status} | handoff=${c.isHandoff} | updated ${c.updatedAt.toISOString()} ---`);
  const msgs = await db.select().from(messages).where(eq(messages.conversationId, c.id)).orderBy(desc(messages.createdAt)).limit(60);
  for (const m of msgs.reverse()) {
    const ts = m.createdAt.toISOString().slice(11, 19);
    const content = (m.content || "").replace(/\n/g, " ").slice(0, 320);
    console.log(`  [${ts}] ${m.role}: ${content}`);
  }
}

process.exit(0);
