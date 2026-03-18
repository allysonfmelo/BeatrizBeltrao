import { pgTable, uuid, varchar, text, decimal, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const serviceTypeEnum = pgEnum("service_type", ["maquiagem", "penteado", "combo"]);
export const serviceCategoryEnum = pgEnum("service_category", ["estudio", "externo"]);

export const services = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  type: serviceTypeEnum("type").notNull(),
  category: serviceCategoryEnum("category").notNull().default("estudio"),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
