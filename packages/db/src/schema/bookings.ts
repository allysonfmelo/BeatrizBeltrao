import { pgTable, uuid, varchar, text, decimal, date, time, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";
import { services } from "./services.js";

export const bookingStatusEnum = pgEnum("booking_status", [
  "pendente",
  "confirmado",
  "cancelado",
  "concluido",
  "expirado",
]);

export const bookings = pgTable("bookings", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id),
  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id),
  scheduledDate: date("scheduled_date").notNull(),
  scheduledTime: time("scheduled_time").notNull(),
  endTime: time("end_time").notNull(),
  status: bookingStatusEnum("status").notNull().default("pendente"),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  depositAmount: decimal("deposit_amount", { precision: 10, scale: 2 }).notNull(),
  googleCalendarEventId: varchar("google_calendar_event_id", { length: 255 }),
  paymentDeadline: timestamp("payment_deadline").notNull(),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
