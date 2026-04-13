import { sendMessage } from "../../lib/llm.js";
import type { LlmMessage } from "../../lib/llm.js";
import { buildSystemPrompt } from "./sophia.prompt.js";
import * as sophiaContext from "./sophia.context.js";
import { sophiaTools, executeTool, type ToolExecutionContext } from "./sophia.tools.js";
import * as notificationService from "../notification/notification.service.js";
import * as clientService from "../client/client.service.js";
import * as serviceService from "../service/service.service.js";
import * as calendarService from "../calendar/calendar.service.js";
import { buildServiceReferenceSummary } from "../service/service-reference.service.js";
import { logger } from "../../lib/logger.js";
import { extractFirstName } from "@studio/shared/utils";

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
  /\b(servi[cç]os?|maquiagens?|penteados?|ambos|express|sequencial|combo|noivas?|extern[oa]s?|domic[ií]lio|agendar|agenda|disponibilidade|dispon[ií]ve(?:l|is)|hor[aá]rios?|datas?|valores?|pre[cç]os?|quanto|or[cç]amentos?|pdf|cat[aá]logos?|d[úu]vidas?|informa[cç][aãoõ]e?s?|mais info|quero saber mais|me explica|explica melhor|saber|sobre\s+(?:os\s+)?servi[cç]os?)\b/i;

/**
 * Previously this file had a TEST_PHONE_MODEL_MAP that routed different
 * test-phone prefixes (55000992, 55000993, 55000994, 55000995) to free
 * OpenRouter models (gemma-4-26b-it:free, gemma-4-31b-it:free,
 * minimax-m2.5:free, gemini-2.0-flash-lite-001) for a one-off multi-
 * model comparison test. It is REMOVED now because it caused persistent
 * test failures: every time a test scenario happened to use a phone
 * starting with one of those prefixes, the LLM call would fail with
 * a 429 rate limit from the free provider tier, masking the real bug.
 * Any future multi-model testing should be done via an explicit env
 * var override instead of silent phone-based routing.
 *
 * All Sophia runs now always use `env.OPENROUTER_MODEL` (currently set
 * to `openai/gpt-4o-mini` in production).
 */

interface ProcessMessageOptions {
  pushName?: string;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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

const PSEUDO_PROGRESS_PHRASES_RE =
  /\b(vou verificar|vou checar|um instante|s[oó]\s+um\s+instante|deixa eu verificar|deixa eu checar)\b/;
const PSEUDO_PROGRESS_BRACKET_RE = /\[\s*verificando(?:\.\.\.)?\s*\]/i;

function isPseudoProgressMessage(content: string): boolean {
  const normalized = normalizeWhitespace(content).toLowerCase();
  return PSEUDO_PROGRESS_PHRASES_RE.test(normalized) || PSEUDO_PROGRESS_BRACKET_RE.test(content);
}

interface DraftAvailabilityInput {
  serviceId: string;
  scheduledDate: string;
  scheduledTime: string;
}

/** Reads service+date+time from collectedData, falling back from bookingDraft to flat fields. */
function getDraftAvailabilityInput(collectedData: Record<string, unknown>): DraftAvailabilityInput | null {
  const draft = collectedData.bookingDraft;
  if (draft && typeof draft === "object") {
    const d = draft as Record<string, unknown>;
    if (typeof d.serviceId === "string" && typeof d.scheduledDate === "string" && typeof d.scheduledTime === "string") {
      return { serviceId: d.serviceId, scheduledDate: d.scheduledDate, scheduledTime: d.scheduledTime };
    }
  }
  if (typeof collectedData.serviceId === "string" && typeof collectedData.scheduledDate === "string" && typeof collectedData.scheduledTime === "string") {
    return {
      serviceId: collectedData.serviceId,
      scheduledDate: collectedData.scheduledDate,
      scheduledTime: collectedData.scheduledTime,
    };
  }
  return null;
}

const AMBOS_TOTAL_RE = /R\$\s*430(?:[.,]00)?/i;

/** Rewrites disallowed consolidated "Ambos R$ 430" amounts produced by the LLM into individual values. */
function sanitizeAmbosPricing(content: string): string {
  const normalized = normalizeWhitespace(content).toLowerCase();
  const hasAmbosContext =
    /\b(express|sequencial|ambos|maquiagem\s+e\s+penteado|os dois serviços)\b/.test(normalized) &&
    !/pré-agendamento/i.test(content);
  if (!hasAmbosContext || !AMBOS_TOTAL_RE.test(content)) return content;
  return content.replace(/R\$\s*430(?:[.,]00)?/gi, "Maquiagem: R$ 240,00 e Penteado: R$ 190,00");
}

/** Renders the canonical confirmation block when the LLM tries to write its own. Anti-loop safeguard. */
function getCanonicalConfirmationFromCollectedData(collectedData: Record<string, unknown>): string | null {
  const draft = collectedData.bookingDraft;
  if (!draft || typeof draft !== "object") return null;
  const d = draft as Record<string, unknown>;
  const required = ["clientName", "clientCpf", "clientEmail", "clientPhone", "serviceName", "scheduledDate", "scheduledTime"] as const;
  for (const key of required) {
    if (typeof d[key] !== "string" || !d[key]) return null;
  }
  const firstName = extractFirstName(d.clientName as string);
  return [
    `Vou confirmar seus dados para dar continuidade ao agendamento, ${firstName} 💕`,
    "",
    `Nome completo: ${d.clientName as string}`,
    `CPF: ${d.clientCpf as string}`,
    `E-mail: ${d.clientEmail as string}`,
    `Telefone: ${d.clientPhone as string}`,
    `Serviço: ${d.serviceName as string}`,
    `Data e horário: ${d.scheduledDate as string} às ${d.scheduledTime as string}`,
    "",
    "Posso seguir com o pré-agendamento? ✨",
  ].join("\n");
}

interface DirectBookingSeed {
  serviceId: string;
  serviceName: string;
  scheduledDate: string;
  scheduledTime: string;
  fullName: string;
  cpf: string;
  email: string;
}

function extractDirectBookingSeed(
  content: string,
  services: Array<{ id: string; name: string; type: string }>,
  fallbackFullName?: string
): DirectBookingSeed | null {
  const normalized = normalizeWhitespace(content);
  if (!/\bagend(ar|amento)?\b/i.test(normalized)) return null;

  const cpfMatch = normalized.match(/cpf\s*:\s*([\d.\-]+)/i) ?? normalized.match(/\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/);
  const emailMatch = normalized.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (!cpfMatch || !emailMatch) return null;
  const cpf = cpfMatch[1].replace(/\D/g, "");
  if (cpf.length !== 11) return null;

  const explicitName = normalized
    .match(
      /nome(?:\s+completo)?\s*:\s*([^\n]+?)(?=(?:[,.;-]?\s*(?:cpf|e-?mail|email|telefone)\b)|$)/i
    )?.[1]
    ?.trim()
    .replace(/[.,;:-]+$/, "")
    .trim();
  const fullName = explicitName ?? fallbackFullName ?? "";
  if (!fullName || fullName.trim().split(/\s+/).length < 2) return null;

  let scheduledDate: string | null = null;
  const isoDate = normalized.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) {
    scheduledDate = isoDate;
  } else if (/\bamanh[ãa]\b/i.test(normalized)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    scheduledDate = tomorrow.toISOString().split("T")[0];
  } else {
    const brDate = normalized.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
    if (brDate) {
      const year = new Date().getFullYear();
      const day = brDate[1].padStart(2, "0");
      const month = brDate[2].padStart(2, "0");
      scheduledDate = `${year}-${month}-${day}`;
    }
  }
  if (!scheduledDate) return null;

  const timeMatch = normalized.match(/\b(?:às|as)?\s*(\d{1,2})(?::(\d{2}))?\s*h?\b/i);
  if (!timeMatch) return null;
  const hh = String(Number(timeMatch[1])).padStart(2, "0");
  const mm = timeMatch[2] ?? "00";
  const scheduledTime = `${hh}:${mm}`;

  const asksMaquiagem = /\bmaquiagem\b/i.test(normalized);
  const asksPenteado = /\bpenteado\b/i.test(normalized);
  if (asksMaquiagem && asksPenteado) return null;

  const targetService = asksMaquiagem
    ? services.find((service) => service.type === "maquiagem")
    : asksPenteado
      ? services.find((service) => service.type === "penteado")
      : null;
  if (!targetService) return null;

  return {
    serviceId: targetService.id,
    serviceName: targetService.name,
    scheduledDate,
    scheduledTime,
    fullName,
    cpf,
    email: emailMatch[0].toLowerCase(),
  };
}

/**
 * Returns the draftKey the tool asked confirmation for, or null if it has
 * already been approved or never asked. Authoritative source: the per-draft
 * scoped flags (`bookingConfirmationAskedForDraftKey` /
 * `bookingConfirmationApprovedForDraftKey`).
 */
function getPendingConfirmationDraftKey(
  collectedData: Record<string, unknown>
): string | null {
  const asked = collectedData.bookingConfirmationAskedForDraftKey;
  const approved = collectedData.bookingConfirmationApprovedForDraftKey;
  if (typeof asked !== "string" || !asked) return null;
  if (typeof approved === "string" && approved === asked) return null;
  return asked;
}

/**
 * Detects Portuguese affirmative replies that should approve a pending
 * booking confirmation. The earlier version used `^...$` anchors which
 * failed on compound replies with punctuation — "Sim, pode confirmar"
 * did not match because the comma broke the anchor, so the approval
 * flag stayed false and the confirmation loop kept going.
 *
 * New approach:
 *   1. Reject messages longer than 80 chars (they're probably not pure
 *      affirmatives — real users write short confirmations).
 *   2. Reject messages containing a negation cue ("não", "espera",
 *      "aguarda", "cancela", "mudei", etc.) — even if they also
 *      contain a "sim" elsewhere, the intent is not pure approval.
 *   3. Otherwise match any affirmative keyword that appears as a
 *      complete word (`\b` anchors). This catches "Sim, pode confirmar",
 *      "Pode confirmar por favor", "Já confirmei!!", "Tudo certo então",
 *      "Beleza, pode seguir", "Ok, confirmo", etc.
 */
function isAffirmativeConfirmation(content: string): boolean {
  const normalized = normalizeWhitespace(content).toLowerCase();

  if (normalized.length === 0 || normalized.length > 80) return false;

  // Questions are almost always requests, not approvals. Reject anything
  // ending with a question mark or with interrogative words.
  if (/[?]/.test(normalized)) return false;
  if (/^(qual|quando|como|onde|por que|por q|pq|quanto|quantos?|quem|ser[áa]|posso|poderia)\b/.test(normalized)) {
    return false;
  }

  if (/\b(n[aã]o|jamais|nunca|espera|aguarda|pera|um momento|s[oó]\s+um|cancela|mudei|mudei de ideia|troca|trocar|altera|alterar|outro|outra)\b/.test(normalized)) {
    return false;
  }

  return /\b(sim|pode|pode seguir|pode prosseguir|pode confirmar|pode finalizar|pode marcar|confirma|confirmo|confirmei|confirmado|j[aá] confirmei|correto|certo|certinho|exato|isso|isso mesmo|com certeza|tudo certo|t[aá] certo|t[aá] certinho|t[aá] bom|beleza|perfeito|manda|finaliza|confere|conferido)\b/.test(
    normalized
  );
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

  const directBookingSeed = extractDirectBookingSeed(
    normalizedContent,
    ctx.services.map((service) => ({ id: service.id, name: service.name, type: service.type })),
    resolvedClientName
  );
  if (directBookingSeed && !getPendingConfirmationDraftKey(ctx.collectedData)) {
    logger.info("Deterministic direct booking seed detected", {
      conversationId: conversation.id,
      phone,
      serviceId: directBookingSeed.serviceId,
      scheduledDate: directBookingSeed.scheduledDate,
      scheduledTime: directBookingSeed.scheduledTime,
    });

    const toolContext: ToolExecutionContext = {
      conversationId: conversation.id,
      phone,
      clientId: ctx.clientId,
      collectedData: ctx.collectedData,
      firstMessageCategory: ctx.firstMessageCategory,
      websiteLinkAlreadySent: ctx.websiteLinkAlreadySent,
      latestClientMessage: normalizedContent,
    };

    await executeTool(
      {
        id: `deterministic_save_client_${conversation.id}`,
        name: "save_client_data",
        arguments: {
          full_name: directBookingSeed.fullName,
          cpf: directBookingSeed.cpf,
          email: directBookingSeed.email,
        },
      },
      toolContext
    );

    await sophiaContext.updateCollectedData(conversation.id, {
      serviceId: directBookingSeed.serviceId,
      serviceName: directBookingSeed.serviceName,
      scheduledDate: directBookingSeed.scheduledDate,
      scheduledTime: directBookingSeed.scheduledTime,
    });
    toolContext.collectedData = {
      ...toolContext.collectedData,
      serviceId: directBookingSeed.serviceId,
      serviceName: directBookingSeed.serviceName,
      scheduledDate: directBookingSeed.scheduledDate,
      scheduledTime: directBookingSeed.scheduledTime,
    };

    await executeTool(
      {
        id: `deterministic_create_booking_${conversation.id}`,
        name: "create_booking",
        arguments: {
          service_id: directBookingSeed.serviceId,
          scheduled_date: directBookingSeed.scheduledDate,
          scheduled_time: directBookingSeed.scheduledTime,
        },
      },
      toolContext
    );

    ctx.clientId = toolContext.clientId;
    ctx.collectedData = toolContext.collectedData;
    ctx.websiteLinkAlreadySent = toolContext.websiteLinkAlreadySent;
    return;
  }

  if (userMessagesCount <= 1 && !hasClearIntent(normalizedContent)) {
    const triageMessage = displayFirstName
      ? `Oi, ${displayFirstName}! ✨\nComo posso te ajudar hoje?`
      : "Oi! ✨\nComo posso te ajudar hoje?";

    await notificationService.sendSophiaMessage(phone, triageMessage, conversation.id);
    return;
  }

  // If there's a pending confirmation for a specific draftKey and the
  // client just said "sim"/"pode"/"já confirmei"/etc., approve that
  // exact draftKey. create_booking's next invocation will see the
  // approval matches the current draft and proceed to the real booking.
  const pendingDraftKey = getPendingConfirmationDraftKey(ctx.collectedData);
  if (pendingDraftKey && isAffirmativeConfirmation(normalizedContent)) {
    const confirmationUpdates = {
      bookingConfirmationApprovedForDraftKey: pendingDraftKey,
    };
    await sophiaContext.updateCollectedData(conversation.id, confirmationUpdates);
    ctx.collectedData = {
      ...ctx.collectedData,
      ...confirmationUpdates,
    };
    logger.info("Affirmative confirmation detected — draftKey approved", {
      conversationId: conversation.id,
      draftKey: pendingDraftKey,
    });

    const draft = ctx.collectedData.bookingDraft as Record<string, unknown> | undefined;
    if (
      draft &&
      typeof draft.serviceId === "string" &&
      typeof draft.scheduledDate === "string" &&
      typeof draft.scheduledTime === "string"
    ) {
      const toolContext: {
        conversationId: string;
        phone: string;
        clientId: string | null;
        collectedData: Record<string, unknown>;
        firstMessageCategory: typeof ctx.firstMessageCategory;
        websiteLinkAlreadySent: boolean;
        latestClientMessage: string;
        preBookingMessageJustSent?: boolean;
        bookingConfirmationStillPending?: boolean;
        bookingConfirmationJustRequested?: boolean;
      } = {
        conversationId: conversation.id,
        phone,
        clientId: ctx.clientId,
        collectedData: ctx.collectedData,
        firstMessageCategory: ctx.firstMessageCategory,
        websiteLinkAlreadySent: ctx.websiteLinkAlreadySent,
        latestClientMessage: normalizedContent,
      };
      const directCreateResult = await executeTool(
        {
          id: `deterministic_create_${conversation.id}`,
          name: "create_booking",
          arguments: {
            service_id: draft.serviceId,
            scheduled_date: draft.scheduledDate,
            scheduled_time: draft.scheduledTime,
          },
        },
        toolContext
      );
      ctx.clientId = toolContext.clientId;
      ctx.collectedData = toolContext.collectedData;
      ctx.websiteLinkAlreadySent = toolContext.websiteLinkAlreadySent;

      const parsedResult = JSON.parse(directCreateResult) as Record<string, unknown>;
      if (
        toolContext.preBookingMessageJustSent === true ||
        toolContext.bookingConfirmationStillPending === true ||
        toolContext.bookingConfirmationJustRequested === true
      ) {
        return;
      }

      if (typeof parsedResult.error === "string") {
        await notificationService.sendSophiaMessage(phone, parsedResult.error, conversation.id);
        return;
      }
    }
  }

  const serviceReferenceSummary = buildServiceReferenceSummary();
  const buildCurrentSystemPrompt = () =>
    buildSystemPrompt({
      services: ctx.services,
      serviceReferenceSummary,
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

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const systemPrompt = buildCurrentSystemPrompt();
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
      const toolContext: ToolExecutionContext = {
        conversationId: conversation.id,
        phone,
        clientId: ctx.clientId,
        collectedData: ctx.collectedData,
        firstMessageCategory: ctx.firstMessageCategory,
        websiteLinkAlreadySent: ctx.websiteLinkAlreadySent,
        latestClientMessage: normalizedContent,
      };

      for (const toolCall of response.toolCalls) {
        const result = await executeTool(toolCall, toolContext);

        // Update context if client was linked
        if (toolContext.clientId !== ctx.clientId) {
          ctx.clientId = toolContext.clientId;
        }
        ctx.collectedData = toolContext.collectedData;
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
      if (
        toolContext.handoffJustHappened ||
        toolContext.websiteLinkJustSent ||
        toolContext.bookingConfirmationJustRequested ||
        toolContext.bookingConfirmationStillPending ||
        toolContext.preBookingMessageJustSent
      ) {
        logger.info("Tool handled client-facing response — skipping further LLM iterations", {
          conversationId: conversation.id,
          iterations,
          handoffJustHappened: toolContext.handoffJustHappened ?? false,
          websiteLinkJustSent: toolContext.websiteLinkJustSent ?? false,
          bookingConfirmationJustRequested:
            toolContext.bookingConfirmationJustRequested ?? false,
          bookingConfirmationStillPending:
            toolContext.bookingConfirmationStillPending ?? false,
          preBookingMessageJustSent:
            toolContext.preBookingMessageJustSent ?? false,
        });
        return;
      }

      continue;
    }

    // No tool calls — we have a text response
    if (response.content) {
      const content = response.content.trim();

      if (isPseudoProgressMessage(content)) {
        const draftInput = getDraftAvailabilityInput(ctx.collectedData);
        if (!draftInput) {
          await notificationService.sendSophiaMessage(
            phone,
            "Para eu consultar certinho, me confirma o serviço, a data e o horário desejados? ✨",
            conversation.id
          );
          logger.warn("Blocked pseudo-progress response without enough draft data", {
            conversationId: conversation.id,
            iterations,
          });
          return;
        }

        const service = await serviceService.findById(draftInput.serviceId);
        if (!service) {
          await notificationService.sendSophiaMessage(
            phone,
            "Consegue me confirmar qual serviço você quer agendar? ✨",
            conversation.id
          );
          logger.warn("Blocked pseudo-progress response — service not found for forced availability", {
            conversationId: conversation.id,
            serviceId: draftInput.serviceId,
          });
          return;
        }

        const slots = await calendarService.getAvailableSlots(
          draftInput.scheduledDate,
          service.durationMinutes
        );
        const limitedSlots = slots.slice(0, 4).map((slot) => `${slot.start} - ${slot.end}`);
        const normalizedRequestedTime = draftInput.scheduledTime
          .trim()
          .replace(/^(\d{1,2})h$/i, (_m, h) => `${String(Number(h)).padStart(2, "0")}:00`);
        const isExactAvailable = slots.some((slot) => slot.start === normalizedRequestedTime);

        const forcedToolCallId = `forced_check_availability_${conversation.id}_${iterations}`;
        const forcedAssistantMsg: LlmMessage = {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: forcedToolCallId,
              name: "check_availability",
              arguments: {
                date: draftInput.scheduledDate,
                service_id: draftInput.serviceId,
              },
            },
          ],
        };
        const forcedToolResult = JSON.stringify({
          available: slots.length > 0,
          date: draftInput.scheduledDate,
          service: service.name,
          duration: service.durationMinutes,
          slots: limitedSlots,
          totalSlots: slots.length,
          slotsLimited: slots.length > limitedSlots.length,
          requestedTime: normalizedRequestedTime,
          requestedTimeAvailable: isExactAvailable,
        });

        currentMessages = [
          ...currentMessages,
          forcedAssistantMsg,
          {
            role: "tool",
            content: forcedToolResult,
            tool_call_id: forcedToolCallId,
          },
        ];

        logger.warn("Blocked pseudo-progress response and injected real availability result", {
          conversationId: conversation.id,
          iterations,
          serviceId: draftInput.serviceId,
          date: draftInput.scheduledDate,
          requestedTime: normalizedRequestedTime,
          totalSlots: slots.length,
        });
        continue;
      }

      let sanitizedContent = sanitizeAmbosPricing(content);
      if (sanitizedContent !== content) {
        logger.warn("Sanitized disallowed consolidated ambos price in Sophia response", {
          conversationId: conversation.id,
          iterations,
        });
      }

      if (/vou confirmar seus dados/i.test(sanitizedContent)) {
        const canonicalConfirmation = getCanonicalConfirmationFromCollectedData(ctx.collectedData);
        if (canonicalConfirmation) {
          sanitizedContent = canonicalConfirmation;
          logger.warn("Normalized confirmation block to canonical field order", {
            conversationId: conversation.id,
            iterations,
          });
        }
      }

      // Save Sophia's response
      await notificationService.sendSophiaMessage(
        phone,
        sanitizedContent,
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
