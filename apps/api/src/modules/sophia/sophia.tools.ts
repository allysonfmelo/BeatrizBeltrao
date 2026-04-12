import type { LlmTool, LlmToolCall } from "../../lib/llm.js";
import * as serviceService from "../service/service.service.js";
import * as calendarService from "../calendar/calendar.service.js";
import * as bookingService from "../booking/booking.service.js";
import * as paymentService from "../payment/payment.service.js";
import * as clientService from "../client/client.service.js";
import { env } from "../../config/env.js";
import * as sophiaContext from "./sophia.context.js";
import type { FirstMessageCategory } from "./sophia.context.js";
import * as notificationService from "../notification/notification.service.js";
import {
  getReferenceServices,
  getServiceReference,
} from "../service/service-reference.service.js";
import { logger } from "../../lib/logger.js";

/**
 * Tool definitions for Sophia's function calling.
 */
export const sophiaTools: LlmTool[] = [
  {
    type: "function",
    function: {
      name: "list_services",
      description: "Lista serviços, inclusões, cuidados, políticas, preços individuais e FAQ usando a referência operacional como fonte prioritária.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Verifica horários disponíveis para uma data e serviço específicos.",
      parameters: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description: "Data no formato YYYY-MM-DD (ex: 2026-04-15). Use o ano correto baseado na data atual.",
          },
          service_id: {
            type: "string",
            description: "UUID do serviço (ex: '550e8400-e29b-41d4-a716-446655440000'). Consulte a lista de IDs no contexto do sistema. NUNCA passe o nome do serviço.",
          },
        },
        required: ["date", "service_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_client_data",
      description: "Salva dados da cliente (nome, CPF, email). Chame SEM parâmetros para verificar se já existe cadastro pelo telefone. Chame COM parâmetros para salvar dados novos.",
      parameters: {
        type: "object",
        properties: {
          full_name: { type: "string", description: "Nome completo da cliente" },
          cpf: { type: "string", description: "CPF da cliente (apenas números)" },
          email: { type: "string", description: "E-mail da cliente" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_booking",
      description: "Cria um pré-agendamento e gera o link de pagamento do sinal (30%). Use apenas após coletar todos os dados e receber confirmação da cliente.",
      parameters: {
        type: "object",
        properties: {
          service_id: { type: "string", description: "UUID do serviço (consulte a lista de IDs no contexto). NUNCA passe o nome do serviço." },
          scheduled_date: { type: "string", description: "Data no formato YYYY-MM-DD (ex: 2026-04-15). Use o ano correto." },
          scheduled_time: { type: "string", description: "Horário no formato HH:mm (ex: 14:00)" },
        },
        required: ["service_id", "scheduled_date", "scheduled_time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_booking",
      description: "Cancela um agendamento existente da cliente.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Motivo do cancelamento" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "handoff_to_human",
      description: "Transfere a conversa para a Beatriz (maquiadora). Use SOMENTE para: noivas, serviços externos/a domicílio, reclamações, ou quando a cliente pedir EXPLICITAMENTE para falar com a Beatriz. NUNCA use para verificar disponibilidade ou dúvidas sobre agendamento — use check_availability para isso.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Motivo da transferência" },
        },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_website_link",
      description: "Envia no WhatsApp o link do site como material complementar. Use apenas quando a cliente quiser explorar mais detalhes e o link ainda não tiver sido enviado nesta conversa.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
];

/** Context needed to execute tools */
interface ToolExecutionContext {
  conversationId: string;
  phone: string;
  clientId: string | null;
  collectedData: Record<string, unknown>;
  firstMessageCategory: FirstMessageCategory;
  websiteLinkAlreadySent: boolean;
  latestClientMessage?: string;
  /**
   * Set to true by `executeHandoff` after it (a) flips the conversation
   * to handoff state and (b) sends the transfer-confirmation message to
   * the client. The agent loop in `sophia.service.ts` reads this flag
   * after each tool call and breaks out of the loop immediately, so the
   * LLM doesn't get another turn to write a duplicate message.
   */
  handoffJustHappened?: boolean;
  websiteLinkJustSent?: boolean;
  bookingConfirmationJustRequested?: boolean;
}

interface BookingDraft {
  serviceId: string;
  serviceName: string;
  scheduledDate: string;
  scheduledTime: string;
  clientName: string;
  clientCpf: string;
  clientEmail: string;
  clientPhone: string;
}

function hasConfirmedFullName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 5) return false;
  const parts = normalized.split(" ").filter(Boolean);
  return parts.length >= 2;
}

function formatCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const match = digits.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  if (!match) return phone;
  const [, country, area, prefix, suffix] = match;
  return `+${country} (${area}) ${prefix}-${suffix}`;
}

function isBookingDraft(value: unknown): value is BookingDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return [
    "serviceId",
    "serviceName",
    "scheduledDate",
    "scheduledTime",
    "clientName",
    "clientCpf",
    "clientEmail",
    "clientPhone",
  ].every((key) => typeof draft[key] === "string" && draft[key]);
}

function getBookingDraft(collectedData: Record<string, unknown>): BookingDraft | null {
  return isBookingDraft(collectedData.bookingDraft) ? collectedData.bookingDraft : null;
}

function bookingDraftEquals(current: BookingDraft | null, next: BookingDraft): boolean {
  if (!current) return false;
  return JSON.stringify(current) === JSON.stringify(next);
}

/**
 * Canonical draft identifier. Two drafts produce the same key iff they
 * represent the same booking request (same service UUID, same calendar
 * date, same normalized start time, same CPF). This is the ONLY state
 * we use to decide whether a confirmation was already asked or already
 * approved for this exact draft — independent of which tool gets called
 * (save_client_data, create_booking, etc.) and independent of text the
 * LLM may paraphrase.
 *
 * Why a key instead of the whole draft object: the LLM passes slightly
 * different strings for the same time ("14h" vs "14:00" vs "14h-15h")
 * and we don't want those surface differences to invalidate a
 * confirmation the client already gave. The key normalizes time + cpf
 * digits before hashing.
 */
function normalizeTimeForKey(time: string): string {
  // Extract first HH:MM or HH from the string and pad to HH:MM.
  const hhmm = time.match(/(\d{1,2}):(\d{2})/);
  if (hhmm) {
    return `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;
  }
  const hOnly = time.match(/(\d{1,2})\s*h/i);
  if (hOnly) {
    return `${hOnly[1].padStart(2, "0")}:00`;
  }
  // Fallback: strip non-digits, take first 4 → pad to HH:MM
  const digits = time.replace(/\D/g, "");
  if (digits.length >= 3) {
    const hh = digits.slice(0, 2).padStart(2, "0");
    const mm = digits.length >= 4 ? digits.slice(2, 4) : "00";
    return `${hh}:${mm}`;
  }
  return time.trim();
}

function computeDraftKey(draft: BookingDraft): string {
  const parts = [
    draft.serviceId.trim(),
    draft.scheduledDate.trim(),
    normalizeTimeForKey(draft.scheduledTime),
    draft.clientCpf.replace(/\D/g, ""),
  ];
  return parts.join("|");
}

/**
 * Reads the per-draft confirmation flags. Each flag stores the draftKey
 * it was set for, or `null` when cleared. A flag "matches" the current
 * draft iff its stored value equals the current draftKey.
 */
function getConfirmationFlags(collectedData: Record<string, unknown>): {
  askedForKey: string | null;
  approvedForKey: string | null;
} {
  const raw = collectedData as Record<string, unknown>;
  const ask = raw.bookingConfirmationAskedForDraftKey;
  const app = raw.bookingConfirmationApprovedForDraftKey;
  return {
    askedForKey: typeof ask === "string" && ask ? ask : null,
    approvedForKey: typeof app === "string" && app ? app : null,
  };
}

function buildBookingConfirmationMessage(draft: BookingDraft): string {
  const firstName = draft.clientName.trim().split(/\s+/)[0] ?? draft.clientName;
  return [
    `Vou confirmar seus dados para dar continuidade ao agendamento, ${firstName} 💕`,
    "",
    `Nome completo: ${draft.clientName}`,
    `CPF: ${formatCpf(draft.clientCpf)}`,
    `E-mail: ${draft.clientEmail}`,
    `Telefone: ${formatPhone(draft.clientPhone)}`,
    `Serviço: ${draft.serviceName}`,
    `Data e horário: ${draft.scheduledDate} às ${draft.scheduledTime}`,
    "",
    "Posso seguir com o pré-agendamento? ✨",
  ].join("\n");
}

async function persistCollectedData(
  ctx: ToolExecutionContext,
  updates: Record<string, unknown>
): Promise<void> {
  await sophiaContext.updateCollectedData(ctx.conversationId, updates);
  ctx.collectedData = { ...ctx.collectedData, ...updates };
}

/**
 * Executes a tool call and returns the result as a string.
 */
export async function executeTool(
  toolCall: LlmToolCall,
  ctx: ToolExecutionContext
): Promise<string> {
  const args = toolCall.arguments;

  try {
    switch (toolCall.name) {
      case "list_services":
        return await executeListServices();

      case "check_availability":
        return await executeCheckAvailability(
          args.date as string,
          args.service_id as string
        );

      case "save_client_data":
        return await executeSaveClientData(ctx, {
          fullName: args.full_name as string | undefined,
          cpf: args.cpf as string | undefined,
          email: args.email as string | undefined,
        });

      case "create_booking":
        return await executeCreateBooking(ctx, {
          serviceId: args.service_id as string,
          scheduledDate: args.scheduled_date as string,
          scheduledTime: args.scheduled_time as string,
        });

      case "cancel_booking":
        return await executeCancelBooking(ctx, args.reason as string | undefined);

      case "handoff_to_human":
        return await executeHandoff(ctx, args.reason as string);

      case "send_website_link":
        return await executeSendWebsiteLink(ctx);

      default:
        return JSON.stringify({ error: `Ferramenta desconhecida: ${toolCall.name}` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    logger.error("Tool execution failed", { tool: toolCall.name, error: message });
    return JSON.stringify({ error: message });
  }
}

async function executeListServices(): Promise<string> {
  const reference = getServiceReference();
  const referenceServices = getReferenceServices();
  const dbServices = await serviceService.listActive();

  const formattedReference = referenceServices.map((item) => {
    const price =
      item.pricing.policy === "fixed" && typeof item.pricing.amount_brl === "number"
        ? `R$ ${item.pricing.amount_brl.toFixed(2)}`
        : "sob consulta";

    return {
      key: item.key,
      name: item.name,
      type: item.type,
      category: item.category,
      mode: item.mode,
      bookable: item.bookable,
      handoffRequired: item.handoff_required ?? false,
      pdfTopic: item.pdf_topic,
      price,
      deposit:
        item.pricing.policy === "fixed" && typeof item.pricing.amount_brl === "number"
          ? `R$ ${((item.pricing.amount_brl * reference.policies.deposit_percentage) / 100).toFixed(2)}`
          : "sob consulta",
      pricingPolicy: item.pricing.policy,
      amountBrl: item.pricing.amount_brl ?? null,
      duration:
        typeof item.duration_minutes === "number"
          ? `${item.duration_minutes} min`
          : "sob consulta",
      includes: item.includes ?? [],
      notes: item.notes ?? [],
      careNotes: item.care_notes ?? [],
    };
  });

  const formattedDb = dbServices.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    category: s.category,
    price: `R$ ${parseFloat(s.price).toFixed(2)}`,
    duration: `${s.durationMinutes} min`,
    isActive: s.isActive,
  }));

  return JSON.stringify({
    sourcePriority: reference.policies.source_priority,
    policies: {
      depositPercentage: reference.policies.deposit_percentage,
      paymentTimeoutHours: reference.policies.payment_timeout_hours,
      handoffImmediateTopics: reference.policies.handoff_immediate_topics,
    },
    services: formattedReference,
    databaseServices: formattedDb,
    faq: reference.faq,
  });
}

async function executeCheckAvailability(
  date: string,
  serviceId: string
): Promise<string> {
  const service = await serviceService.findById(serviceId);
  if (!service) {
    const allServices = await serviceService.listActive();
    return JSON.stringify({
      error: `Serviço com ID '${serviceId}' não encontrado. Você deve passar o UUID do serviço, não o nome.`,
      servicos_disponiveis: allServices.map((s) => ({ nome: s.name, id: s.id })),
    });
  }

  // Check if it's a Sunday (day 0)
  const dayOfWeek = new Date(`${date}T12:00:00`).getDay();
  if (dayOfWeek === 0) {
    return JSON.stringify({
      available: false,
      message: "Não atendemos aos domingos",
      slots: [],
    });
  }

  const slots = await calendarService.getAvailableSlots(date, service.durationMinutes);
  return JSON.stringify({
    available: slots.length > 0,
    date,
    service: service.name,
    duration: service.durationMinutes,
    slots: slots.map((s) => `${s.start} - ${s.end}`),
  });
}

async function executeSaveClientData(
  ctx: ToolExecutionContext,
  data: { fullName?: string; cpf?: string; email?: string }
): Promise<string> {
  // If no data provided, do a lookup by phone to check existing client
  if (!data.fullName && !data.cpf && !data.email) {
    const existingClient = await clientService.findByPhone(ctx.phone);
    if (existingClient) {
      await sophiaContext.linkClient(ctx.conversationId, existingClient.id);
      ctx.clientId = existingClient.id;
      await persistCollectedData(ctx, {
        clientName: existingClient.fullName,
        clientCpf: existingClient.cpf,
        clientEmail: existingClient.email,
      });

      const cpfMasked = existingClient.cpf
        ? `${existingClient.cpf.slice(0, 3)}.***.***.${existingClient.cpf.slice(-2)}`
        : "não informado";

      return JSON.stringify({
        success: true,
        message: "Cliente já cadastrada! Confirme os dados com ela antes de prosseguir.",
        existingClient: {
          id: existingClient.id,
          fullName: existingClient.fullName,
          cpf: cpfMasked,
          email: existingClient.email,
          phone: existingClient.phone,
        },
      });
    }

    return JSON.stringify({
      success: true,
      message: "Nenhum cadastro encontrado para este telefone. Solicite os dados da cliente: nome completo, CPF e email.",
      existingClient: null,
    });
  }

  const updates: Record<string, unknown> = {};

  if (data.fullName) updates.clientName = data.fullName;
  if (data.cpf) updates.clientCpf = data.cpf.replace(/\D/g, "");
  if (data.email) updates.clientEmail = data.email;

  // Merge with existing collected data. The booking-confirmation flags
  // are NOT touched here — this was the source of the confirmation loop
  // observed in production: every time save_client_data ran (even with
  // the same data), it reset the approval and re-sent the block, so
  // after the client said "sim" the next LLM iteration could trigger
  // save_client_data again and wipe the approval. The draftKey-based
  // flags (set by create_booking) are the single source of truth for
  // confirmation state now. Approval is only invalidated when the
  // draftKey itself changes, which create_booking detects on its own.
  const merged = { ...ctx.collectedData, ...updates };
  const bookingDraftFromMerged = getBookingDraft(merged);
  const persistedUpdates: Record<string, unknown> = bookingDraftFromMerged
    ? {
        ...updates,
        bookingDraft: {
          ...bookingDraftFromMerged,
          clientName: (merged.clientName as string | undefined) ?? bookingDraftFromMerged.clientName,
          clientCpf: (merged.clientCpf as string | undefined) ?? bookingDraftFromMerged.clientCpf,
          clientEmail: (merged.clientEmail as string | undefined) ?? bookingDraftFromMerged.clientEmail,
          clientPhone: ctx.phone,
        },
      }
    : updates;

  await persistCollectedData(ctx, persistedUpdates);
  const nextCollectedData = { ...merged, ...persistedUpdates };
  ctx.collectedData = nextCollectedData;

  // If we have enough data to find or create a client, link them
  if (nextCollectedData.clientName && nextCollectedData.clientCpf && nextCollectedData.clientEmail) {
    try {
      const phone = ctx.phone;
      let client = await clientService.findByPhone(phone);

      if (!client) {
        client = await clientService.findByCpfOrEmail(
          nextCollectedData.clientCpf as string,
          nextCollectedData.clientEmail as string
        );
        if (client && client.phone !== phone) {
          client = await clientService.update(client.id, {
            phone,
            fullName: nextCollectedData.clientName as string,
            cpf: nextCollectedData.clientCpf as string,
            email: nextCollectedData.clientEmail as string,
          });
        }
      }

      if (!client) {
        if (!hasConfirmedFullName(nextCollectedData.clientName)) {
          return JSON.stringify({
            success: true,
            message:
              "Nome ainda não confirmado para cadastro. Confirme o nome completo da cliente antes de criar o perfil.",
          });
        }

        client = await clientService.create({
          fullName: nextCollectedData.clientName as string,
          phone,
          cpf: nextCollectedData.clientCpf as string,
          email: nextCollectedData.clientEmail as string,
        });
      }

      await sophiaContext.linkClient(ctx.conversationId, client.id);
      ctx.clientId = client.id;

      return JSON.stringify({
        success: true,
        message: "Dados salvos e cliente vinculada à conversa",
        clientId: client.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro ao criar cliente";
      logger.error("Failed to create/link client", { error: message });
      return JSON.stringify({
        success: true,
        message: "Dados salvos, mas houve erro ao vincular cliente: " + message,
      });
    }
  }

  return JSON.stringify({
    success: true,
    message: "Dados salvos",
    collected: Object.keys(nextCollectedData).filter(
      (k) => nextCollectedData[k] !== undefined && nextCollectedData[k] !== null
    ),
  });
}

async function executeCreateBooking(
  ctx: ToolExecutionContext,
  data: { serviceId: string; scheduledDate: string; scheduledTime: string }
): Promise<string> {
  if (!ctx.clientId) {
    return JSON.stringify({
      error: "Cliente não vinculada. Colete nome, CPF e email antes de criar o agendamento.",
    });
  }

  // Check availability first
  const service = await serviceService.findById(data.serviceId);
  if (!service) {
    const allServices = await serviceService.listActive();
    return JSON.stringify({
      error: `Serviço com ID '${data.serviceId}' não encontrado. Passe o UUID do serviço, não o nome.`,
      servicos_disponiveis: allServices.map((s) => ({ nome: s.name, id: s.id })),
    });
  }

  const client = await clientService.findById(ctx.clientId);
  if (!client) {
    return JSON.stringify({ error: "Erro interno: cliente não encontrada" });
  }

  const bookingDraft: BookingDraft = {
    serviceId: data.serviceId,
    serviceName: service.name,
    scheduledDate: data.scheduledDate,
    scheduledTime: data.scheduledTime,
    clientName: client.fullName,
    clientCpf: client.cpf,
    clientEmail: client.email,
    clientPhone: client.phone,
  };
  const draftKey = computeDraftKey(bookingDraft);
  const flags = getConfirmationFlags(ctx.collectedData);
  const alreadyApprovedForThisDraft = flags.approvedForKey === draftKey;
  const alreadyAskedForThisDraft = flags.askedForKey === draftKey;

  // Case A — approved for this exact draftKey → proceed to booking. The
  // persisted draft is the source of truth; any paraphrased time/service
  // variations from the model pointing at the same key are treated as
  // the same request.
  if (alreadyApprovedForThisDraft) {
    await persistCollectedData(ctx, {
      bookingDraft,
      bookingDraftKey: draftKey,
      // Keep flags as they are — approval stays approved.
    });
  } else if (alreadyAskedForThisDraft) {
    // Case B — we already sent the confirmation block for this exact
    // draft and the client hasn't approved yet. DO NOT re-send it —
    // this was the "loop de confirmação" bug. Return a neutral result
    // so the LLM can just stop emitting text (the prompt tells it to).
    await persistCollectedData(ctx, {
      bookingDraft,
      bookingDraftKey: draftKey,
    });
    return JSON.stringify({
      success: false,
      confirmationStillPending: true,
      draftKey,
      message:
        "A confirmação deste agendamento já foi enviada à cliente anteriormente. Aguarde uma resposta afirmativa explícita (sim, pode, confirmo, já confirmei, etc.) antes de chamar create_booking novamente. NÃO escreva o bloco de confirmação como texto; ele já foi enviado pelo sistema.",
    });
  } else {
    // Case C — first time we see this draftKey (or it's different from a
    // previously approved one). Send the confirmation block ONCE, mark
    // this key as asked, and clear any stale approval for a different
    // key. The client's next affirmative response approves THIS key.
    await persistCollectedData(ctx, {
      bookingDraft,
      bookingDraftKey: draftKey,
      bookingConfirmationAskedForDraftKey: draftKey,
      // Clear any stale approval for a previous draftKey.
      bookingConfirmationApprovedForDraftKey: null,
      // Legacy flags (kept for backward-compat with any surviving
      // consumers, but the draftKey flags above are authoritative).
      bookingConfirmationPending: true,
      bookingConfirmationApproved: false,
    });

    const confirmationMessage = buildBookingConfirmationMessage(bookingDraft);
    await notificationService.sendSophiaMessage(
      ctx.phone,
      confirmationMessage,
      ctx.conversationId
    );
    ctx.bookingConfirmationJustRequested = true;

    return JSON.stringify({
      success: false,
      confirmationRequired: true,
      draftKey,
      message:
        "A confirmação final foi solicitada à cliente AGORA. Aguarde a resposta afirmativa explícita antes de chamar create_booking novamente. NÃO escreva o bloco de confirmação como texto; o sistema já enviou.",
    });
  }

  const available = await calendarService.isSlotAvailable(
    data.scheduledDate,
    data.scheduledTime,
    service.durationMinutes
  );

  if (!available) {
    const alternativeSlots = await calendarService.getAvailableSlots(
      data.scheduledDate,
      service.durationMinutes
    );

    return JSON.stringify({
      error: `O horário ${data.scheduledTime} não está disponível no dia ${data.scheduledDate}.`,
      suggestion: "Apresente os horários disponíveis abaixo à cliente e pergunte qual prefere.",
      available_slots: alternativeSlots.map((s) => s.start),
      no_slots_message:
        alternativeSlots.length === 0
          ? "Nenhum horário disponível neste dia. Sugira outra data à cliente."
          : null,
    });
  }

  // Create pre-booking (also validates conflicts in database)
  let booking;
  try {
    booking = await bookingService.createPreBooking({
      clientId: ctx.clientId,
      serviceId: data.serviceId,
      scheduledDate: data.scheduledDate,
      scheduledTime: data.scheduledTime,
    });
  } catch (bookingError) {
    const errorMsg = bookingError instanceof Error ? bookingError.message : "Erro ao criar agendamento";
    logger.warn("Booking creation failed, fetching alternatives", { error: errorMsg });

    const alternativeSlots = await calendarService.getAvailableSlots(
      data.scheduledDate,
      service.durationMinutes
    );

    return JSON.stringify({
      error: errorMsg,
      suggestion: "Apresente os horários disponíveis abaixo à cliente e pergunte qual prefere.",
      available_slots: alternativeSlots.map((s) => s.start),
      no_slots_message:
        alternativeSlots.length === 0
          ? "Nenhum horário disponível neste dia. Sugira outra data à cliente."
          : null,
    });
  }

  // Create payment charge
  let invoiceUrl = "";
  try {
    invoiceUrl = await paymentService.createPaymentForBooking(
      {
        id: booking.id,
        depositAmount: booking.depositAmount,
        scheduledDate: booking.scheduledDate,
        serviceName: service.name,
      },
      {
        fullName: client.fullName,
        cpf: client.cpf,
        email: client.email,
        phone: client.phone,
      }
    );
  } catch (error) {
    logger.error("Failed to create payment, booking still created", {
      bookingId: booking.id,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }

  await sophiaContext.setIntent(ctx.conversationId, "agendamento");
  await persistCollectedData(ctx, {
    bookingDraft,
    bookingConfirmationPending: false,
    bookingConfirmationApproved: false,
  });

  const depositValue = parseFloat(booking.depositAmount);
  const pixKey = env.PIX_KEY?.trim() || "A definir";
  const pixHolder = env.PIX_HOLDER_NAME?.trim() || "A definir";
  const clientName = client.fullName;

  // For "Ambos" services (type = combo), present the components (Maquiagem/Penteado)
  // individually — never a summed total — per the business rule. Per-day payment
  // is also shown per-component for the same reason.
  const isAmbosService = service.type === "combo";
  const componentLines = isAmbosService
    ? [
        "",
        "SERVIÇOS INCLUSOS",
        "💄 Maquiagem Social — R$ 240,00",
        "💇‍♀️ Penteado Social — R$ 190,00",
      ]
    : [];
  const dayPaymentBlock = isAmbosService
    ? [
        "💰 A pagar no dia do serviço:",
        "   • Maquiagem: R$ 168,00",
        "   • Penteado: R$ 133,00",
      ]
    : [
        `💰 Pagamento no dia: R$ ${(parseFloat(booking.totalPrice) - depositValue).toFixed(2)}`,
      ];

  // Payment block: prefer the ASAAS invoice URL (Pix/cartão/boleto in one
  // link). If ASAAS errored above (catch on line ~491 swallowed it and left
  // invoiceUrl empty), fall back to raw PIX instructions + a note that the
  // link will be retried — keeps the booking alive even on transient ASAAS
  // sandbox failures instead of silently dropping the payment step, which
  // was the root cause of the real-test blockage.
  const paymentLinkBlock = invoiceUrl
    ? [
        "",
        "💳 LINK DE PAGAMENTO (SINAL 30%)",
        `🔗 ${invoiceUrl}`,
        "",
        "Clique no link acima para pagar via Pix, cartão ou boleto de forma rápida e segura.",
      ]
    : [
        "",
        "⚠️ Tivemos uma instabilidade temporária gerando o link de pagamento.",
        "Você pode pagar via Pix usando a chave abaixo, ou me avisar que eu gero o link de novo:",
        `Chave PIX: ${pixKey}`,
        `Titular: ${pixHolder}`,
      ];

  const preBookingMessage = [
    "✨ PRÉ-AGENDAMENTO",
    "",
    "DADOS DA CLIENTE",
    `NOME: ${clientName}`,
    `DATA: ${data.scheduledDate}`,
    `HORÁRIO: ${data.scheduledTime}`,
    ...componentLines,
    "",
    "PAGAMENTO",
    `💳 Sinal (30%): R$ ${depositValue.toFixed(2)}`,
    ...dayPaymentBlock,
    ...paymentLinkBlock,
    "",
    "⏳ O pagamento deve ser realizado em até 24h para reserva da data.",
    "Após a confirmação do pagamento, você recebe as informações completas de local e cuidados prévios. 🤍",
  ].join("\n");

  return JSON.stringify({
    success: true,
    bookingId: booking.id,
    service: service.name,
    date: data.scheduledDate,
    time: data.scheduledTime,
    totalPrice: `R$ ${parseFloat(booking.totalPrice).toFixed(2)}`,
    deposit: `R$ ${depositValue.toFixed(2)}`,
    invoiceUrl,
    deadline: "24 horas",
    preBookingMessage,
    pix: {
      key: pixKey,
      holderName: pixHolder,
    },
  });
}

async function executeCancelBooking(
  ctx: ToolExecutionContext,
  reason?: string
): Promise<string> {
  if (!ctx.clientId) {
    return JSON.stringify({ error: "Cliente não identificada" });
  }

  const pendingBooking = await bookingService.findPendingByClientId(ctx.clientId);
  if (!pendingBooking) {
    return JSON.stringify({ error: "Nenhum agendamento pendente encontrado" });
  }

  // Cancel ASAAS payment
  await paymentService.cancelPaymentForBooking(pendingBooking.id);

  // Cancel booking
  await bookingService.cancelBooking(pendingBooking.id, reason);

  await sophiaContext.setIntent(ctx.conversationId, "cancelamento");

  return JSON.stringify({
    success: true,
    message: "Agendamento cancelado",
    bookingId: pendingBooking.id,
  });
}

async function executeHandoff(
  ctx: ToolExecutionContext,
  reason: string
): Promise<string> {
  await sophiaContext.setHandoff(ctx.conversationId, reason);

  // Send the transfer-confirmation message to the client. This MUST happen
  // here (not be left for the LLM to produce as text), because the prompt
  // explicitly forbids the LLM from writing "A Beatriz vai te atender" /
  // "Vou chamar a Beatriz" as free text — that rule was added to stop the
  // LLM from hallucinating ghost handoffs without invoking the tool. With
  // the LLM blocked from writing the message and the previous code path
  // not sending anything either, the client was getting silence after a
  // legitimate handoff_to_human call. Sending it from inside the tool
  // closes that gap.
  const clientHandoffMessage =
    "Pronto! 💕 Já passei seu atendimento para a Beatriz e ela vai te responder por aqui em breve com todos os detalhes ✨";
  await notificationService.sendSophiaMessage(
    ctx.phone,
    clientHandoffMessage,
    ctx.conversationId
  );

  // Notify Beatriz separately
  await notificationService.notifyMaquiadora(
    "Transferência de Conversa",
    `Telefone: ${ctx.phone}\nMotivo: ${reason}\n\nA cliente precisa falar com você diretamente.`
  );

  // Signal to the agent loop that the handoff is complete and it should
  // stop iterating (no more LLM calls). Without this, the LLM gets another
  // turn after the tool result and may emit a duplicate message.
  ctx.handoffJustHappened = true;

  return JSON.stringify({
    success: true,
    message: "Conversa transferida para a Beatriz. A mensagem de confirmação JÁ foi enviada à cliente pelo sistema — você NÃO precisa enviar nada adicional.",
    reason,
  });
}

const WEBSITE_URL = "https://biabeltrao.com.br";

function shouldBlockWebsiteLink(ctx: ToolExecutionContext): string | null {
  if (ctx.websiteLinkAlreadySent) {
    return "O link do site já foi enviado nesta conversa. Não reenvie; continue o atendimento por aqui.";
  }

  if (ctx.firstMessageCategory === "cta_interest" || ctx.firstMessageCategory === "cta_bridal") {
    return "A cliente iniciou a conversa por um CTA do site. Não envie o link novamente nesta conversa.";
  }

  return null;
}

async function executeSendWebsiteLink(
  ctx: ToolExecutionContext
): Promise<string> {
  const blockedReason = shouldBlockWebsiteLink(ctx);
  if (blockedReason) {
    return JSON.stringify({
      success: false,
      skipped: true,
      message: blockedReason,
    });
  }

  const message = [
    "✨ Confira nosso site com todas as informações sobre nossos serviços:",
    "",
    `🌐 ${WEBSITE_URL}`,
    "",
    "Lá você encontra detalhes completos sobre maquiagem, com fotos dos trabalhos e todas as informações! 💄",
    "",
    "Depois de dar uma olhadinha, se quiser agendar ou tiver alguma dúvida específica, é só me chamar aqui! 💕",
  ].join("\n");

  await notificationService.sendWhatsAppMessage(
    ctx.phone,
    message,
    ctx.conversationId
  );
  ctx.websiteLinkAlreadySent = true;
  ctx.websiteLinkJustSent = true;

  return JSON.stringify({
    success: true,
    url: WEBSITE_URL,
    message: "Link do site enviado com sucesso no WhatsApp.",
  });
}
