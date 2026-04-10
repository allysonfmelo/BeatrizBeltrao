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
/**
 * Matches any token that signals a clear commercial intent from the client.
 * If a first message does NOT match, the service sends a hardcoded triage
 * ("Oi, {nome}! ✨ Como posso te ajudar hoje?") instead of calling the LLM,
 * which means the new prompt rules (including the SITE offer flow) never
 * get a chance to run. Plural forms (`serviços`, `informações`, `preços`,
 * `dúvidas`, `horários`) are matched via an optional `s?` OR an explicit
 * alternation — they are EXTREMELY common in real-world first messages
 * and their absence was caught in the first post-fix validation run.
 */
const CLEAR_INTENT_PATTERN =
  /\b(servi[cç]os?|maquiagens?|penteados?|ambos|express|sequencial|combo|noivas?|extern[oa]s?|domic[ií]lio|agendar|agenda|disponibilidade|dispon[ií]ve(?:l|is)|hor[aá]rios?|datas?|valores?|pre[cç]os?|quanto|or[cç]amentos?|pdf|cat[aá]logos?|d[úu]vidas?|informa[cç][aãoõ]e?s?|mais info|saber|sobre\s+(?:os\s+)?servi[cç]os?)\b/i;

/**
 * Test phone → OpenRouter model override. Phones starting with
 * "55000991" use the default env model; the other prefixes each map
 * to a specific model so the test harness can run the same scenario
 * against multiple models in parallel and compare behavior. The
 * notification service has a parallel `TEST_PHONE_PREFIX` guard that
 * short-circuits the Evolution API send for these phones.
 *
 * Model IDs validated against https://openrouter.ai/api/v1/models
 * on 2026-04-10.
 */
const TEST_PHONE_MODEL_MAP: Record<string, string> = {
  "55000991": "", // default model from env.OPENROUTER_MODEL
  "55000992": "google/gemma-4-26b-a4b-it:free",
  "55000993": "google/gemma-4-31b-it:free",
  "55000994": "minimax/minimax-m2.5:free",
  "55000995": "google/gemini-2.0-flash-lite-001",
};

function resolveModelOverride(phone: string): string | undefined {
  for (const [prefix, model] of Object.entries(TEST_PHONE_MODEL_MAP)) {
    if (phone.startsWith(prefix)) {
      return model || undefined;
    }
  }
  return undefined;
}

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
    phone: ctx.phone,
    firstClientMessage: ctx.firstClientMessage,
    firstMessageCategory: ctx.firstMessageCategory,
    websiteLinkAlreadySent: ctx.websiteLinkAlreadySent,
  });

  // 4. Build message history with the new user message
  const llmMessages: LlmMessage[] = [
    ...ctx.messageHistory,
  ];

  // 5. Agentic loop
  let iterations = 0;
  let currentMessages = llmMessages;
  const modelOverride = resolveModelOverride(phone);
  if (modelOverride) {
    logger.info("Using test-phone model override", { phone, model: modelOverride });
  }

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await sendMessage(systemPrompt, currentMessages, sophiaTools, {
      modelOverride,
    });

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
      const toolContext: {
        conversationId: string;
        phone: string;
        clientId: string | null;
        collectedData: Record<string, unknown>;
        firstMessageCategory: typeof ctx.firstMessageCategory;
        websiteLinkAlreadySent: boolean;
        handoffJustHappened?: boolean;
      } = {
        conversationId: conversation.id,
        phone,
        clientId: ctx.clientId,
        collectedData: ctx.collectedData,
        firstMessageCategory: ctx.firstMessageCategory,
        websiteLinkAlreadySent: ctx.websiteLinkAlreadySent,
      };

      for (const toolCall of response.toolCalls) {
        const result = await executeTool(toolCall, toolContext);

        // Update context if client was linked
        if (toolContext.clientId !== ctx.clientId) {
          ctx.clientId = toolContext.clientId;
        }
        ctx.websiteLinkAlreadySent = toolContext.websiteLinkAlreadySent;

        const toolMsg: LlmMessage = {
          role: "tool",
          content: result,
          tool_call_id: toolCall.id,
        };
        currentMessages = [...currentMessages, toolMsg];
      }

      // If handoff_to_human just fired, the client has already received the
      // confirmation message via executeHandoff. Bail out of the loop now —
      // do NOT call the LLM again, otherwise it might emit a duplicate
      // message ignoring the prompt rule.
      if (toolContext.handoffJustHappened) {
        logger.info("Handoff completed inside tool — skipping further LLM iterations", {
          conversationId: conversation.id,
          iterations,
        });
        return;
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

  // Max iterations reached — do NOT set handoff. Send a friendly retry
  // message and log the issue so we can debug. The next client message
  // will re-enter processMessage normally, giving the LLM another chance.
  //
  // Historical note: we used to dispatch a fallback message containing
  // "Vou chamar a Beatriz" AND call setHandoff(reason="Max tool iterations
  // reached") here. That was wrong on two levels:
  //   (1) It gave up on the conversation on any transient LLM hiccup,
  //       causing `status` to flip to "aguardando_humano", which in turn
  //       made `getOrCreateConversation` create a fresh conversation on
  //       the next message (empty history → triage reset loop).
  //   (2) The literal phrase "Vou chamar a Beatriz" was being memorized
  //       by the LLM and re-emitted as a hallucinated text response in
  //       unrelated situations, bypassing the real `handoff_to_human`
  //       tool call and creating ghost handoffs.
  // Now we keep the conversation alive and wait for the next turn.
  const fallbackMessage =
    "Um segundinho, deixa eu conferir aqui pra você e já te respondo direitinho ✨";

  await notificationService.sendSophiaMessage(phone, fallbackMessage, conversation.id);

  logger.warn("Sophia max tool iterations reached — sent retry message, NOT triggering handoff", {
    conversationId: conversation.id,
    phone,
    iterations,
  });
}
