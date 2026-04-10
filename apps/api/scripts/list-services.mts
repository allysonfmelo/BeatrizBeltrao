import { createDb, services } from "@studio/db";
import { desc } from "drizzle-orm";

const db = createDb(process.env.DATABASE_URL!);
const all = await db.select().from(services).orderBy(desc(services.createdAt));
console.log(`Total services: ${all.length}`);
for (const s of all) {
  console.log(
    `  ${s.isActive ? "[on]" : "[off]"} ${s.name.padEnd(40)} | ${s.type.padEnd(9)} | ${String(s.durationMinutes).padStart(3)}min | R$ ${s.price} | ${s.id}`
  );
}
process.exit(0);
