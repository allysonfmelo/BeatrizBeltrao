import { eq, and, asc, desc, like } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import { conversations, messages, clients, bookings } from "@studio/db";
import * as serviceService from "../service/service.service.js";
import { logger } from "../../lib/logger.js";
import type { LlmMessage } from "../../lib/llm.js";

const WEBSITE_URL = "https://biabeltrao.com.br";

export type FirstMessageCategory =
  | "cta_interest"
  | "cta_question"
  | "cta_bridal"
  | "cta_generic"
  | "direct";

/** Full context loaded for a conversation */
export interface SophiaContext {
  conversationId: string;
  phone: string;
  conversationStatus: string;
  collectedData: Record<string, unknown>;
  isHandoff: boolean;
  clientId: string | null;
  clientName: string | undefined;
  hasPendingBooking: boolean;
  firstClientMessage: string;
  firstMessageCategory: FirstMessageCategory;
  websiteLinkAlreadySent: boolean;
  services: Awaited<ReturnType<typeof serviceService.listActive>>;
  messageHistory: LlmMessage[];
}

export function classifyFirstClientMessage(content: string): FirstMessageCategory {
  const normalized = content.trim();

  if (!normalized) return "direct";

  if (
    /\b(noiva|noivas|dia da noiva|retoque noiva|m[aã]e da noiva|consultoria para noivas|or[cç]amento para noivas)\b/i.test(
      normalized
    )
  ) {
    return "cta_bridal";
  }

  if (
    /\b(d[úu]vida(?:s)?|me explica|explica melhor|quero entender melhor|entender melhor)\b/i.test(
      normalized
    )
  ) {
    return "cta_question";
  }

  if (
    /(tenho interesse|vi no site e gostaria de agendar|gostaria de agendar um penteado|escova\s*\/\s*babyliss|curso de automaquiagem|maquiagem social|penteado social)/i.test(
      normalized
    )
  ) {
    return "cta_interest";
  }

  if (
    /(gostaria de agendar um hor[aá]rio|gostaria de solicitar um or[cç]amento|gostaria de agendar um or[cç]amento|quero or[cç]amento|quanto custa|quais os valores|quero saber mais|mais informa[cç][aã]o(?:es)?|mais detalhes)/i.test(
      normalized
    )
  ) {
    return "cta_generic";
  }

  return "direct";
}

async function loadFirstClientMessage(conversationId: string): Promise<string> {
  const [firstClientMessage] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.role, "client")))
    .orderBy(asc(messages.createdAt))
    .limit(1);

  return firstClientMessage?.content.trim() ?? "";
}

async function loadWebsiteLinkAlreadySent(conversationId: string): Promise<boolean> {
  const [websiteMessage] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, "sophia"),
        like(messages.content, `%${WEBSITE_URL}%`)
      )
    )
    .limit(1);

  return Boolean(websiteMessage);
}

/**
 * Gets or creates a conversation for a phone number.
 *
 * Rules:
 *  - Look for the MOST RECENT conversation for the phone (any status).
 *  - If found AND status is "ativa" → return it (normal flow).
 *  - If found AND status is "aguardando_humano" → return it (the caller
 *    `processMessage` checks `isHandoff` and skips Sophia processing,
 *    waiting for human intervention). We MUST NOT create a new conversation
 *    here, otherwise every message after a handoff would start from scratch
 *    with an empty history — which was the root cause of the "Oi, Test! Como
 *    posso te ajudar hoje?" (triage) reset bug observed in production.
 *  - If found AND status is "finalizada" OR there is no conversation at all
 *    → create a new one with status="ativa".
 */
export async function getOrCreateConversation(phone: string) {
  const latest = await db.query.conversations.findFirst({
    where: eq(conversations.phone, phone),
    orderBy: [desc(conversations.createdAt)],
  });

  // Reuse existing conversation unless it's fully terminated.
  if (latest && latest.status !== "finalizada") {
    return latest;
  }

  const [conversation] = await db
    .insert(conversations)
    .values({
      phone,
      status: "ativa",
      collectedData: {},
    })
    .returning();

  logger.info("New conversation created", {
    conversationId: conversation.id,
    phone,
    reasonPreviousStatus: latest?.status ?? "none",
  });

  return conversation;
}

/**
 * Loads full context for Sophia to process a message.
 */
export async function loadContext(
  conversationId: string,
  phone: string
): Promise<SophiaContext> {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  if (!conversation) throw new Error("Conversation not found");

  // Load client if linked
  let clientName: string | undefined;
  let hasPendingBooking = false;

  if (conversation.clientId) {
    const client = await db.query.clients.findFirst({
      where: eq(clients.id, conversation.clientId),
    });
    clientName = client?.fullName;

    // Check for pending booking
    const pendingBooking = await db.query.bookings.findFirst({
      where: and(
        eq(bookings.clientId, conversation.clientId),
        eq(bookings.status, "pendente")
      ),
    });
    hasPendingBooking = !!pendingBooking;
  }

  // Load services
  const services = await serviceService.listActive();

  // Load message history
  const messageHistory = await loadMessageHistory(conversationId);
  const firstClientMessage = await loadFirstClientMessage(conversationId);
  const websiteLinkAlreadySent = await loadWebsiteLinkAlreadySent(conversationId);

  const collectedData = (conversation.collectedData as Record<string, unknown>) ?? {};

  return {
    conversationId,
    phone,
    conversationStatus: conversation.status,
    collectedData,
    isHandoff: conversation.isHandoff,
    clientId: conversation.clientId,
    clientName,
    hasPendingBooking,
    firstClientMessage,
    firstMessageCategory: classifyFirstClientMessage(firstClientMessage),
    websiteLinkAlreadySent,
    services,
    messageHistory,
  };
}

/**
 * Updates the collected data (JSONB) for a conversation.
 */
export async function updateCollectedData(
  conversationId: string,
  data: Record<string, unknown>
): Promise<void> {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });

  const existing = (conversation?.collectedData as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...data };

  await db
    .update(conversations)
    .set({
      collectedData: merged,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

/**
 * Links a client to a conversation.
 */
export async function linkClient(
  conversationId: string,
  clientId: string
): Promise<void> {
  await db
    .update(conversations)
    .set({
      clientId,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

/**
 * Sets the conversation intent.
 */
export async function setIntent(
  conversationId: string,
  intent: "agendamento" | "cancelamento" | "remarcacao" | "duvida" | "orcamento" | "outro"
): Promise<void> {
  await db
    .update(conversations)
    .set({
      intent,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

/**
 * Marks conversation as handoff to human.
 */
export async function setHandoff(
  conversationId: string,
  reason: string
): Promise<void> {
  await db
    .update(conversations)
    .set({
      status: "aguardando_humano",
      isHandoff: true,
      handoffReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

/**
 * Loads the last N messages from a conversation and converts to LLM format.
 */
export async function loadMessageHistory(
  conversationId: string,
  limit = 20
): Promise<LlmMessage[]> {
  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  // Reverse to chronological order
  msgs.reverse();

  return msgs.map((m) => ({
    role: m.role === "client" ? "user" as const : "assistant" as const,
    content: m.content,
  }));
}

/**
 * Saves a message to the conversation history.
 */
export async function saveMessage(
  conversationId: string,
  role: "client" | "sophia" | "maquiadora",
  content: string,
  evolutionMessageId?: string
): Promise<void> {
  await db.insert(messages).values({
    conversationId,
    role,
    content,
    messageType: "text",
    evolutionMessageId: evolutionMessageId ?? null,
  });
}
