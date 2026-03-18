import { pgTable, uuid, varchar, decimal, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { bookings } from "./bookings.js";

export const paymentMethodEnum = pgEnum("payment_method", ["pix", "credito", "debito"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pendente",
  "confirmado",
  "cancelado",
  "expirado",
  "estornado",
]);

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id")
    .notNull()
    .unique()
    .references(() => bookings.id),
  asaasPaymentId: varchar("asaas_payment_id", { length: 255 }).notNull().unique(),
  asaasInvoiceUrl: varchar("asaas_invoice_url", { length: 500 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  method: paymentMethodEnum("method"),
  status: paymentStatusEnum("status").notNull().default("pendente"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
