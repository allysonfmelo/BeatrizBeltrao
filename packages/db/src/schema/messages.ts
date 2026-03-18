import { pgTable, uuid, varchar, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { conversations } from "./conversations.js";

export const messageRoleEnum = pgEnum("message_role", ["client", "sophia", "maquiadora"]);
export const messageTypeEnum = pgEnum("message_type", ["text", "image", "audio", "document", "link"]);

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  messageType: messageTypeEnum("message_type").default("text").notNull(),
  evolutionMessageId: varchar("evolution_message_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
