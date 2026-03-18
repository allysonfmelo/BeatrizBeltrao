import { createDb } from "../index.js";
import { services, settings } from "../schema/index.js";

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const db = createDb(databaseUrl);

  console.log("Seeding services...");
  await db.insert(services).values([
    {
      name: "Maquiagem Social",
      type: "maquiagem",
      category: "estudio",
      description: "Maquiagem completa para eventos sociais",
      price: "250.00",
      durationMinutes: 60,
    },
    {
      name: "Maquiagem para Festa",
      type: "maquiagem",
      category: "estudio",
      description: "Maquiagem elaborada para festas e formaturas",
      price: "300.00",
      durationMinutes: 75,
    },
    {
      name: "Penteado Social",
      type: "penteado",
      category: "estudio",
      description: "Penteado para eventos sociais",
      price: "200.00",
      durationMinutes: 60,
    },
    {
      name: "Penteado para Festa",
      type: "penteado",
      category: "estudio",
      description: "Penteado elaborado para festas e formaturas",
      price: "280.00",
      durationMinutes: 75,
    },
    {
      name: "Combo Maquiagem + Penteado",
      type: "combo",
      category: "estudio",
      description: "Maquiagem completa + penteado",
      price: "400.00",
      durationMinutes: 120,
    },
    {
      name: "Maquiagem Noiva (Est\u00fadio)",
      type: "maquiagem",
      category: "externo",
      description: "Maquiagem para noivas \u2014 sob consulta",
      price: "0.00",
      durationMinutes: 120,
    },
    {
      name: "Combo Noiva (Est\u00fadio)",
      type: "combo",
      category: "externo",
      description: "Maquiagem + penteado para noivas \u2014 sob consulta",
      price: "0.00",
      durationMinutes: 180,
    },
  ]);

  console.log("Seeding settings...");
  await db.insert(settings).values([
    {
      key: "business_hours",
      value: { start: "05:00", end: "22:00", days: [1, 2, 3, 4, 5, 6] },
      description: "Hor\u00e1rio de funcionamento do est\u00fadio",
    },
    {
      key: "deposit_percentage",
      value: 30,
      description: "Percentual do sinal de pagamento",
    },
    {
      key: "payment_timeout_hours",
      value: 24,
      description: "Horas limite para pagamento do sinal",
    },
    {
      key: "daily_report_time",
      value: "20:00",
      description: "Hor\u00e1rio de envio do resumo di\u00e1rio",
    },
  ]);

  console.log("Seed completed!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
