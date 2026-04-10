import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  // Get recent bookings + their payment records
  const rows = await sql<
    Array<{
      booking_id: string;
      client_name: string | null;
      service_name: string | null;
      scheduled_date: string;
      scheduled_time: string;
      deposit_amount: string;
      booking_status: string;
      payment_id: string | null;
      asaas_payment_id: string | null;
      asaas_invoice_url: string | null;
      payment_status: string | null;
      created_at: string;
    }>
  >`
    SELECT
      b.id::text AS booking_id,
      c.full_name AS client_name,
      s.name AS service_name,
      b.scheduled_date,
      b.scheduled_time::text AS scheduled_time,
      b.deposit_amount::text AS deposit_amount,
      b.status AS booking_status,
      p.id::text AS payment_id,
      p.asaas_payment_id,
      p.asaas_invoice_url,
      p.status AS payment_status,
      b.created_at::text AS created_at
    FROM bookings b
    LEFT JOIN clients c ON c.id = b.client_id
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN payments p ON p.booking_id = b.id
    ORDER BY b.created_at DESC
    LIMIT 10
  `;

  if (rows.length === 0) {
    console.log("No bookings found.");
  }

  for (const r of rows) {
    console.log(`\n=== Booking ${r.booking_id.slice(0, 8)}`);
    console.log(`  Client:       ${r.client_name ?? "(none)"}`);
    console.log(`  Service:      ${r.service_name ?? "(none)"}`);
    console.log(`  Scheduled:    ${r.scheduled_date} ${r.scheduled_time}`);
    console.log(`  Deposit:      R$ ${r.deposit_amount}`);
    console.log(`  Status:       ${r.booking_status}`);
    console.log(`  Created:      ${r.created_at}`);
    if (r.payment_id) {
      console.log(`  Payment ID:   ${r.payment_id.slice(0, 8)}`);
      console.log(`  ASAAS ID:     ${r.asaas_payment_id ?? "(none)"}`);
      console.log(`  Invoice URL:  ${r.asaas_invoice_url ?? "(EMPTY)"}`);
      console.log(`  Pay Status:   ${r.payment_status ?? "(none)"}`);
    } else {
      console.log(`  Payment:      NO PAYMENT RECORD`);
    }
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
