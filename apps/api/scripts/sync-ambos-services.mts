/**
 * Idempotent sync of the two new "Ambos" services into the production database.
 *
 * - Inserts "Maquiagem + Penteado (Express)" and "Maquiagem + Penteado (Sequencial)"
 *   if they are not already present (checked by name).
 * - Deactivates the legacy "Combo Maquiagem + Penteado" row (if any) so Sophia
 *   stops offering it via the list_services tool. We do NOT delete it to preserve
 *   historical booking references (foreign keys).
 *
 * Usage:
 *   set -a && source .env && set +a
 *   pnpm --filter @studio/api exec tsx scripts/sync-ambos-services.mts
 */
import { createDb, services } from "@studio/db";
import { and, eq } from "drizzle-orm";

const db = createDb(process.env.DATABASE_URL!);

const newServices = [
  {
    name: "Maquiagem + Penteado (Express)",
    type: "combo" as const,
    category: "estudio" as const,
    description:
      "Maquiagem e penteado executados simultaneamente em 1h. Valores: Maquiagem R$ 240 + Penteado R$ 190 (apresentados separadamente na conversa).",
    price: "430.00",
    durationMinutes: 60,
  },
  {
    name: "Maquiagem + Penteado (Sequencial)",
    type: "combo" as const,
    category: "estudio" as const,
    description:
      "Maquiagem em 1h e penteado em 1h, total 2h consecutivas. Valores: Maquiagem R$ 240 + Penteado R$ 190 (apresentados separadamente na conversa).",
    price: "430.00",
    durationMinutes: 120,
  },
];

console.log("Sync 'Ambos' services → production database");
console.log("DB host:", (process.env.DATABASE_URL ?? "").replace(/^.*@([^:/]+).*/, "$1"));

for (const svc of newServices) {
  const existing = await db.query.services.findFirst({
    where: eq(services.name, svc.name),
  });

  if (existing) {
    // Update price/duration/description so operators can re-run this idempotently
    // after tweaks, without touching the id.
    await db
      .update(services)
      .set({
        type: svc.type,
        category: svc.category,
        description: svc.description,
        price: svc.price,
        durationMinutes: svc.durationMinutes,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(services.id, existing.id));
    console.log(`  [updated] ${svc.name} (id=${existing.id})`);
  } else {
    const [inserted] = await db.insert(services).values(svc).returning();
    console.log(`  [inserted] ${svc.name} (id=${inserted.id})`);
  }
}

// Deactivate legacy "Combo Maquiagem + Penteado" if present
const legacy = await db.query.services.findFirst({
  where: and(eq(services.name, "Combo Maquiagem + Penteado"), eq(services.isActive, true)),
});

if (legacy) {
  await db
    .update(services)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(services.id, legacy.id));
  console.log(`  [deactivated] Combo Maquiagem + Penteado (id=${legacy.id})`);
} else {
  console.log("  [skip] legacy 'Combo Maquiagem + Penteado' not found or already inactive");
}

console.log("Done.");
process.exit(0);
