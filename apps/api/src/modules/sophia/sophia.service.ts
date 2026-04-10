import { sendMessage } from "../../lib/llm.js";
import type { LlmMessage } from "../../lib/llm.js";
import { buildSystemPrompt } from "./sophia.prompt.js";
import * as sophiaContext from "./sophia.context.js";
import { sophiaTools, executeTool } from "./sophia.tools.js";
import * as notificationService from "../notification/notification.service.js";
import * as clientService from "../client/client.service.js";
import { buildServiceReferenceSummary } from "../service/service-reference.service.js";
import { logger } from "../../lib/logger.js";

const MAX_TOOL_ITERATIONS = 5;
const NAME_PATTERN = /^[\p{L}\s]{2,}$/u;
const CLEAR_INTENT_PATTERN =
  /\b(servi[cç]o|maquiagem|penteado|ambos|express|sequencial|combo|noiva|extern[oa]|domic[ií]lio|agendar|agenda|disponibilidade|dispon[ií]vel|hor[aá]rio|data|valor|pre[cç]o|quanto|orcamento|orçamento|pdf|cat[aá]logo|duvida|d[úu]vida)\b/i;
const HANDOFF_PATTERN =
  /\b(noiva|casamento|extern[oa]|domic[ií]lio|a\s*domic[ií]lio|hotel|sal[aã]o)\b/i;

interface ProcessMessageOptions {
  pushName?: string;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function extractFirstName(fullName: string): string {
  const normalized = normalizeWhitespace(fullName);
  return normalized.split(" ")[0] ?? normalized;
}

function isValidName(value: string): boolean {
  const normalized = normalizeWhitespace(value);
  if (normalized.length < 2 || normalized.length > 50) return false;
  return NAME_PATTERN.test(normalized);
}

function normalizePushName(pushName?: string): string | null {
  if (!pushName) return null;
  const cleaned = normalizeWhitespace(pushName)
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ");

  if (!isValidName(cleaned)) {
    return null;
  }

  return cleaned;
}

function hasClearIntent(content: string): boolean {
  return CLEAR_INTENT_PATTERN.test(content);
}

function requiresImmediateHandoff(content: string): boolean {
  return HANDOFF_PATTERN.test(content);
}

function extractNameFromReply(content: string): string | null {
  const normalized = normalizeWhitespace(content);
  if (!normalized || hasClearIntent(normalized)) {
    return null;
  }

  const withoutPrefix = normalized.replace(
    /^(oi+|ol[aá]|bom dia|boa tarde|boa noite|meu nome [ée]|eu sou|sou)\s+/i,
    ""
  );

  const sanitized = withoutPrefix
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitized) return null;

  const tokens = sanitized.split(" ").filter(Boolean);
  if (tokens.length > 3) return null;
  if (!isValidName(sanitized)) return null;

  return sanitized;
}

/**
 * Processes an incoming WhatsApp message through Sophia's agentic loop.
 *
 * Flow:
 * 1. Load conversation context and message history
 * 2. Build system prompt with dynamic context
 * 3. Send to LLM with tools
 * 4. If tool_calls → execute → resubmit (up to MAX_TOOL_ITERATIONS)
 * 5. When text response → save + send via WhatsApp
 */
export async function processMessage(
  phone: string,
  content: string,
  options: ProcessMessageOptions = {}
): Promise<void> {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    logger.debug("Ignoring empty message content", { phone });
    return;
  }

  // 1. Get or create conversation
  const conversation = await sophiaContext.getOrCreateConversation(phone);

  // Check handoff — don't process if waiting for human
  if (conversation.isHandoff) {
    logger.info("Message received on handoff conversation, skipping Sophia", {
      conversationId: conversation.id,
      phone,
    });
    return;
  }

  // Save incoming message
  await sophiaContext.saveMessage(conversation.id, "client", normalizedContent);

  // 2. Load full context
  const ctx = await sophiaContext.loadContext(conversation.id, phone);

  let resolvedClientName = ctx.clientName;
  if (!resolvedClientName) {
    const dbClient = await clientService.findByPhone(phone);
    if (dbClient) {
      resolvedClientName = dbClient.fullName;
      if (!ctx.clientId) {
        await sophiaContext.linkClient(conversation.id, dbClient.id);
        ctx.clientId = dbClient.id;
      }
    }
  }

  const collectedData = ctx.collectedData;
  const awaitingName = collectedData.awaitingName === true;
  const storedChatName =
    typeof collectedData.chatFirstName === "string" ? collectedData.chatFirstName : undefined;
  const dbFirstName = resolvedClientName ? extractFirstName(resolvedClientName) : undefined;
  const normalizedPushName = normalizePushName(options.pushName);
  const payloadFirstName = normalizedPushName ? extractFirstName(normalizedPushName) : undefined;
  const displayFirstName = dbFirstName ?? storedChatName ?? payloadFirstName;

  if (!dbFirstName && payloadFirstName && storedChatName !== payloadFirstName) {
    await sophiaContext.updateCollectedData(conversation.id, {
      chatFirstName: payloadFirstName,
      chatNameSource: "payload",
    });
    ctx.collectedData = {
      ...ctx.collectedData,
      chatFirstName: payloadFirstName,
      chatNameSource: "payload",
    };
  }

  if (!dbFirstName && !payloadFirstName && !storedChatName) {
    if (awaitingName) {
      const candidateName = extractNameFromReply(normalizedContent);

      if (!candidateName) {
        await notificationService.sendSophiaMessage(
          phone,
          "Perfeito ✨\nPode me dizer seu nome para eu te atender direitinho?",
          conversation.id
        );
        return;
      }

      const firstName = extractFirstName(candidateName);
      await sophiaContext.updateCollectedData(conversation.id, {
        awaitingName: false,
        chatFirstName: firstName,
        chatNameSource: "user",
      });
      ctx.collectedData = {
        ...ctx.collectedData,
        awaitingName: false,
        chatFirstName: firstName,
        chatNameSource: "user",
      };

      await notificationService.sendSophiaMessage(
        phone,
        `Prazer, ${firstName}! ✨\nComo posso te ajudar hoje?`,
        conversation.id
      );
      return;
    }

    await sophiaContext.updateCollectedData(conversation.id, { awaitingName: true });
    ctx.collectedData = { ...ctx.collectedData, awaitingName: true };

    await notificationService.sendSophiaMessage(
      phone,
      "Oi, tudo bem? ✨\nQual seu nome, por gentileza, para eu te atender melhor?",
      conversation.id
    );
    return;
  }

  if (requiresImmediateHandoff(normalizedContent)) {
    const reason = "Solicitação de noiva/serviço externo";
    await sophiaContext.setHandoff(conversation.id, reason);
    await notificationService.notifyMaquiadora(
      "Transferência de Conversa",
      `Telefone: ${phone}\nMotivo: ${reason}\n\nA cliente precisa falar com você diretamente.`
    );

    const handoffMessage = displayFirstName
      ? `Perfeito, ${displayFirstName}! ✨\nVou te conectar com a Beatriz agora para esse atendimento.`
      : "Perfeito! ✨\nVou te conectar com a Beatriz agora para esse atendimento.";

    await notificationService.sendSophiaMessage(phone, handoffMessage, conversation.id);
    return;
  }

  const userMessagesCount = ctx.messageHistory.filter((message) => message.role === "user").length;
  if (userMessagesCount <= 1 && !hasClearIntent(normalizedContent)) {
    const triageMessage = displayFirstName
      ? `Oi, ${displayFirstName}! ✨\nComo posso te ajudar hoje?`
      : "Oi! ✨\nComo posso te ajudar hoje?";

    await notificationService.sendSophiaMessage(phone, triageMessage, conversation.id);
    return;
  }

  // 3. Build system prompt
  const systemPrompt = buildSystemPrompt({
    services: ctx.services,
    serviceReferenceSummary: buildServiceReferenceSummary(),
    collectedData: ctx.collectedData,
    conversationStatus: ctx.conversationStatus,
    clientName: displayFirstName,
    hasPendingBooking: ctx.hasPendingBooking,
  });

  // 4. Build message history with the new user message
  const llmMessages: LlmMessage[] = [
    ...ctx.messageHistory,
  ];

  // 5. Agentic loop
  let iterations = 0;
  let currentMessages = llmMessages;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await sendMessage(systemPrompt, currentMessages, sophiaTools);

    // If there are tool calls, execute them and resubmit
    if (response.toolCalls.length > 0) {
      logger.debug("Sophia tool calls", {
        iteration: iterations,
        tools: response.toolCalls.map((tc) => tc.name),
      });

      // Add assistant message with tool calls to history
      const assistantMsg: LlmMessage = {
        role: "assistant",
        content: response.content ?? "",
        tool_calls: response.toolCalls,
      };
      currentMessages = [...currentMessages, assistantMsg];

      // Execute each tool and add results
      const toolContext = {
        conversationId: conversation.id,
        phone,
        clientId: ctx.clientId,
        collectedData: ctx.collectedData,
      };

      for (const toolCall of response.toolCalls) {
        const result = await executeTool(toolCall, toolContext);

        // Update context if client was linked
        if (toolContext.clientId !== ctx.clientId) {
          ctx.clientId = toolContext.clientId;
        }

        const toolMsg: LlmMessage = {
          role: "tool",
          content: result,
          tool_call_id: toolCall.id,
        };
        currentMessages = [...currentMessages, toolMsg];
      }

      continue;
    }

    // No tool calls — we have a text response
    if (response.content) {
      // Save Sophia's response
      await notificationService.sendSophiaMessage(
        phone,
        response.content,
        conversation.id
      );

      logger.info("Sophia responded", {
        conversationId: conversation.id,
        phone,
        iterations,
      });
    } else {
      logger.warn("Sophia returned empty response", {
        conversationId: conversation.id,
        iterations,
      });
    }

    return;
  }

  // Max iterations reached — send fallback
  const fallbackMessage =
    "Desculpe, estou com uma dificuldade técnica no momento. Vou chamar a Beatriz para te ajudar! ✨";

  await notificationService.sendSophiaMessage(phone, fallbackMessage, conversation.id);
  await sophiaContext.setHandoff(conversation.id, "Max tool iterations reached");

  logger.warn("Sophia max iterations reached, handoff triggered", {
    conversationId: conversation.id,
    phone,
  });
}
