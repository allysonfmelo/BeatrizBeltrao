import { pgTable, uuid, varchar, text, boolean, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { clients } from "./clients.js";

export const conversationStatusEnum = pgEnum("conversation_status", [
  "ativa",
  "aguardando_humano",
  "finalizada",
]);

export const conversationIntentEnum = pgEnum("conversation_intent", [
  "agendamento",
  "cancelamento",
  "remarcacao",
  "duvida",
  "orcamento",
  "outro",
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").references(() => clients.id),
  phone: varchar("phone", { length: 20 }).notNull(),
  status: conversationStatusEnum("status").notNull().default("ativa"),
  intent: conversationIntentEnum("intent"),
  contextSummary: text("context_summary"),
  collectedData: jsonb("collected_data"),
  isHandoff: boolean("is_handoff").default(false).notNull(),
  handoffReason: text("handoff_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
