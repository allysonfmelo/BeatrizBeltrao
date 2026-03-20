import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Stub env before any module that calls loadEnv() is imported.
// ---------------------------------------------------------------------------
vi.mock("../../../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 3001,
    DATABASE_URL: "postgresql://test",
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "anthropic/claude-sonnet-4",
    EVOLUTION_API_URL: "http://evolution.test",
    EVOLUTION_API_KEY: "test-key",
    EVOLUTION_INSTANCE_NAME: "test",
    ASAAS_API_KEY: "test-key",
    ASAAS_WEBHOOK_TOKEN: "test-token",
    ASAAS_ENVIRONMENT: "sandbox",
    DEPOSIT_PERCENTAGE: 30,
    PAYMENT_TIMEOUT_HOURS: 24,
    CORS_ORIGIN: "http://localhost:3000",
    RESEND_FROM_EMAIL: "test@test.com",
  },
}));

// Stub Supabase so no real DB connection is attempted.
vi.mock("../../../config/supabase.js", () => ({ db: {} }));

vi.mock("../../service/service.service.js");
vi.mock("../../calendar/calendar.service.js");
vi.mock("../../booking/booking.service.js");
vi.mock("../../payment/payment.service.js");
vi.mock("../../client/client.service.js");
vi.mock("../sophia.context.js");
vi.mock("../../notification/notification.service.js");
vi.mock("../../../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { sophiaTools, executeTool } from "../sophia.tools.js";
import * as serviceService from "../../service/service.service.js";
import * as calendarService from "../../calendar/calendar.service.js";
import * as bookingService from "../../booking/booking.service.js";
import * as paymentService from "../../payment/payment.service.js";
import * as clientService from "../../client/client.service.js";
import * as sophiaContext from "../sophia.context.js";
import * as notificationService from "../../notification/notification.service.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MOCK_SERVICE = {
  id: "svc-1",
  name: "Maquiagem Social",
  type: "maquiagem" as const,
  category: "estudio",
  price: "250.00",
  durationMinutes: 60,
  isActive: true,
};

const MOCK_CLIENT = {
  id: "cli-1",
  fullName: "Maria",
  phone: "5511999990000",
  cpf: "12345678901",
  email: "maria@test.com",
};

const MOCK_BOOKING = {
  id: "bk-1",
  totalPrice: "250.00",
  depositAmount: "75.00",
  scheduledDate: "2026-04-01",
  scheduledTime: "09:00",
};

const BASE_CTX = {
  conversationId: "conv-1",
  phone: "5511999990000",
  clientId: null as string | null,
  collectedData: {} as Record<string, unknown>,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<typeof BASE_CTX> = {}) {
  return { ...BASE_CTX, collectedData: {}, ...overrides };
}

function makeToolCall(name: string, args: Record<string, unknown> = {}) {
  return { id: "tc-1", name, arguments: args };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(serviceService.listActive).mockResolvedValue([MOCK_SERVICE] as any);
  vi.mocked(serviceService.findById).mockImplementation(async (id) =>
    id === "svc-1" ? (MOCK_SERVICE as any) : null
  );

  vi.mocked(calendarService.getAvailableSlots).mockResolvedValue([
    { start: "09:00", end: "10:00" },
  ] as any);
  vi.mocked(calendarService.isSlotAvailable).mockResolvedValue(true);

  vi.mocked(clientService.findByPhone).mockResolvedValue(null);
  vi.mocked(clientService.create).mockResolvedValue(MOCK_CLIENT as any);
  vi.mocked(clientService.findById).mockImplementation(async (id) =>
    id === "cli-1" ? (MOCK_CLIENT as any) : null
  );

  vi.mocked(bookingService.createPreBooking).mockResolvedValue(MOCK_BOOKING as any);
  vi.mocked(bookingService.findPendingByClientId).mockResolvedValue(MOCK_BOOKING as any);
  vi.mocked(bookingService.cancelBooking).mockResolvedValue(undefined as any);

  vi.mocked(paymentService.createPaymentForBooking).mockResolvedValue(
    "https://asaas.com/invoice/123"
  );
  vi.mocked(paymentService.cancelPaymentForBooking).mockResolvedValue(undefined);

  vi.mocked(sophiaContext.updateCollectedData).mockResolvedValue(undefined);
  vi.mocked(sophiaContext.linkClient).mockResolvedValue(undefined);
  vi.mocked(sophiaContext.setIntent).mockResolvedValue(undefined);
  vi.mocked(sophiaContext.setHandoff).mockResolvedValue(undefined);

  vi.mocked(notificationService.notifyMaquiadora).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// sophiaTools — shape validation
// ---------------------------------------------------------------------------

describe("sophiaTools", () => {
  it("exports an array of 6 tool definitions", () => {
    expect(sophiaTools).toHaveLength(6);
  });

  it("contains every expected tool name", () => {
    const names = sophiaTools.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_services",
        "check_availability",
        "save_client_data",
        "create_booking",
        "cancel_booking",
        "handoff_to_human",
      ])
    );
  });

  it("every tool has type function", () => {
    sophiaTools.forEach((t) => expect(t.type).toBe("function"));
  });
});

// ---------------------------------------------------------------------------
// list_services
// ---------------------------------------------------------------------------

describe("executeTool — list_services", () => {
  it("retorna lista formatada de servicos ativos", async () => {
    const result = await executeTool(makeToolCall("list_services"), makeCtx());
    const parsed = JSON.parse(result);

    expect(serviceService.listActive).toHaveBeenCalledOnce();
    expect(parsed.services).toHaveLength(1);

    const svc = parsed.services[0];
    expect(svc.id).toBe("svc-1");
    expect(svc.name).toBe("Maquiagem Social");
    expect(svc.price).toBe("R$ 250.00");
    expect(svc.deposit).toBe("R$ 75.00");
    expect(svc.duration).toBe("60 min");
  });

  it("calcula o sinal como 30% do preco", async () => {
    const result = await executeTool(makeToolCall("list_services"), makeCtx());
    const { services } = JSON.parse(result);
    const depositNumeric = parseFloat(services[0].deposit.replace("R$ ", ""));
    const priceNumeric = parseFloat(services[0].price.replace("R$ ", ""));
    expect(depositNumeric).toBeCloseTo(priceNumeric * 0.3, 2);
  });
});

// ---------------------------------------------------------------------------
// check_availability
// ---------------------------------------------------------------------------

describe("executeTool — check_availability", () => {
  it("retorna horarios disponiveis para uma data valida", async () => {
    const result = await executeTool(
      makeToolCall("check_availability", { date: "2026-04-01", service_id: "svc-1" }),
      makeCtx()
    );
    const parsed = JSON.parse(result);

    expect(parsed.available).toBe(true);
    expect(parsed.date).toBe("2026-04-01");
    expect(parsed.service).toBe("Maquiagem Social");
    expect(parsed.slots).toEqual(["09:00 - 10:00"]);
    expect(calendarService.getAvailableSlots).toHaveBeenCalledWith("2026-04-01", 60);
  });

  it("retorna unavailable com mensagem para domingos", async () => {
    // 2026-03-22 is a Sunday
    const result = await executeTool(
      makeToolCall("check_availability", { date: "2026-03-22", service_id: "svc-1" }),
      makeCtx()
    );
    const parsed = JSON.parse(result);

    expect(parsed.available).toBe(false);
    expect(parsed.message).toMatch(/domingo/i);
    expect(parsed.slots).toEqual([]);
    expect(calendarService.getAvailableSlots).not.toHaveBeenCalled();
  });

  it("retorna erro quando servico nao encontrado", async () => {
    vi.mocked(serviceService.findById).mockResolvedValue(null);
    const result = await executeTool(
      makeToolCall("check_availability", { date: "2026-04-01", service_id: "invalid" }),
      makeCtx()
    );
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/servi/i);
  });
});

// ---------------------------------------------------------------------------
// save_client_data
// ---------------------------------------------------------------------------

describe("executeTool — save_client_data", () => {
  it("salva dados incrementalmente sem criar cliente quando dados incompletos", async () => {
    const result = await executeTool(
      makeToolCall("save_client_data", { full_name: "Maria" }),
      makeCtx()
    );
    const parsed = JSON.parse(result);

    expect(sophiaContext.updateCollectedData).toHaveBeenCalledWith(
      "conv-1",
      { clientName: "Maria" }
    );
    expect(clientService.create).not.toHaveBeenCalled();
    expect(parsed.success).toBe(true);
    expect(parsed.collected).toContain("clientName");
  });

  it("remove caracteres nao numericos do CPF antes de salvar", async () => {
    await executeTool(
      makeToolCall("save_client_data", { cpf: "123.456.789-01" }),
      makeCtx()
    );

    expect(sophiaContext.updateCollectedData).toHaveBeenCalledWith(
      "conv-1",
      { clientCpf: "12345678901" }
    );
  });

  it("cria cliente e vincula conversa quando todos os dados sao coletados", async () => {
    const ctx = makeCtx({
      collectedData: { clientName: "Maria", clientCpf: "12345678901" },
    });

    const result = await executeTool(
      makeToolCall("save_client_data", { email: "maria@test.com" }),
      ctx
    );
    const parsed = JSON.parse(result);

    expect(clientService.findByPhone).toHaveBeenCalledWith("5511999990000");
    expect(clientService.create).toHaveBeenCalledWith({
      fullName: "Maria",
      phone: "5511999990000",
      cpf: "12345678901",
      email: "maria@test.com",
    });
    expect(sophiaContext.linkClient).toHaveBeenCalledWith("conv-1", "cli-1");
    expect(parsed.success).toBe(true);
    expect(parsed.clientId).toBe("cli-1");
  });

  it("reutiliza cliente existente em vez de criar um novo", async () => {
    vi.mocked(clientService.findByPhone).mockResolvedValue(MOCK_CLIENT as any);

    const ctx = makeCtx({
      collectedData: { clientName: "Maria", clientCpf: "12345678901" },
    });

    await executeTool(
      makeToolCall("save_client_data", { email: "maria@test.com" }),
      ctx
    );

    expect(clientService.findByPhone).toHaveBeenCalled();
    expect(clientService.create).not.toHaveBeenCalled();
    expect(sophiaContext.linkClient).toHaveBeenCalledWith("conv-1", "cli-1");
  });
});

// ---------------------------------------------------------------------------
// create_booking
// ---------------------------------------------------------------------------

describe("executeTool — create_booking", () => {
  it("cria pre-agendamento e retorna link de pagamento", async () => {
    const ctx = makeCtx({ clientId: "cli-1" });

    const result = await executeTool(
      makeToolCall("create_booking", {
        service_id: "svc-1",
        scheduled_date: "2026-04-01",
        scheduled_time: "09:00",
      }),
      ctx
    );
    const parsed = JSON.parse(result);

    expect(bookingService.createPreBooking).toHaveBeenCalledWith({
      clientId: "cli-1",
      serviceId: "svc-1",
      scheduledDate: "2026-04-01",
      scheduledTime: "09:00",
    });
    expect(paymentService.createPaymentForBooking).toHaveBeenCalled();
    expect(sophiaContext.setIntent).toHaveBeenCalledWith("conv-1", "agendamento");

    expect(parsed.success).toBe(true);
    expect(parsed.bookingId).toBe("bk-1");
    expect(parsed.invoiceUrl).toBe("https://asaas.com/invoice/123");
    expect(parsed.totalPrice).toBe("R$ 250.00");
    expect(parsed.deposit).toBe("R$ 75.00");
    expect(parsed.deadline).toBe("24 horas");
  });

  it("retorna erro quando cliente nao esta vinculada", async () => {
    const result = await executeTool(
      makeToolCall("create_booking", {
        service_id: "svc-1",
        scheduled_date: "2026-04-01",
        scheduled_time: "09:00",
      }),
      makeCtx({ clientId: null })
    );
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(bookingService.createPreBooking).not.toHaveBeenCalled();
  });

  it("retorna erro quando horario nao esta disponivel", async () => {
    vi.mocked(calendarService.isSlotAvailable).mockResolvedValue(false);

    const ctx = makeCtx({ clientId: "cli-1" });
    const result = await executeTool(
      makeToolCall("create_booking", {
        service_id: "svc-1",
        scheduled_date: "2026-04-01",
        scheduled_time: "09:00",
      }),
      ctx
    );
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/hor[aá]rio/i);
    expect(bookingService.createPreBooking).not.toHaveBeenCalled();
  });

  it("continua mesmo quando a criacao de pagamento falha", async () => {
    vi.mocked(paymentService.createPaymentForBooking).mockRejectedValue(
      new Error("ASAAS indisponivel")
    );

    const ctx = makeCtx({ clientId: "cli-1" });
    const result = await executeTool(
      makeToolCall("create_booking", {
        service_id: "svc-1",
        scheduled_date: "2026-04-01",
        scheduled_time: "09:00",
      }),
      ctx
    );
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.bookingId).toBe("bk-1");
    expect(parsed.invoiceUrl).toBe("");
  });
});

// ---------------------------------------------------------------------------
// cancel_booking
// ---------------------------------------------------------------------------

describe("executeTool — cancel_booking", () => {
  it("cancela agendamento pendente da cliente", async () => {
    const ctx = makeCtx({ clientId: "cli-1" });

    const result = await executeTool(
      makeToolCall("cancel_booking", { reason: "Não poderei comparecer" }),
      ctx
    );
    const parsed = JSON.parse(result);

    expect(bookingService.findPendingByClientId).toHaveBeenCalledWith("cli-1");
    expect(paymentService.cancelPaymentForBooking).toHaveBeenCalledWith("bk-1");
    expect(bookingService.cancelBooking).toHaveBeenCalledWith(
      "bk-1",
      "Não poderei comparecer"
    );
    expect(sophiaContext.setIntent).toHaveBeenCalledWith("conv-1", "cancelamento");

    expect(parsed.success).toBe(true);
    expect(parsed.bookingId).toBe("bk-1");
  });

  it("retorna erro quando nenhum agendamento pendente encontrado", async () => {
    vi.mocked(bookingService.findPendingByClientId).mockResolvedValue(null);

    const ctx = makeCtx({ clientId: "cli-1" });
    const result = await executeTool(
      makeToolCall("cancel_booking", {}),
      ctx
    );
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(bookingService.cancelBooking).not.toHaveBeenCalled();
  });

  it("retorna erro quando cliente nao identificada", async () => {
    const result = await executeTool(
      makeToolCall("cancel_booking", {}),
      makeCtx({ clientId: null })
    );
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(bookingService.findPendingByClientId).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handoff_to_human
// ---------------------------------------------------------------------------

describe("executeTool — handoff_to_human", () => {
  it("define handoff e notifica maquiadora", async () => {
    const result = await executeTool(
      makeToolCall("handoff_to_human", { reason: "Noiva — evento externo" }),
      makeCtx()
    );
    const parsed = JSON.parse(result);

    expect(sophiaContext.setHandoff).toHaveBeenCalledWith(
      "conv-1",
      "Noiva — evento externo"
    );
    expect(notificationService.notifyMaquiadora).toHaveBeenCalledWith(
      "Transferência de Conversa",
      expect.stringContaining("5511999990000")
    );
    expect(notificationService.notifyMaquiadora).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("Noiva — evento externo")
    );

    expect(parsed.success).toBe(true);
    expect(parsed.reason).toBe("Noiva — evento externo");
  });
});

// ---------------------------------------------------------------------------
// unknown tool
// ---------------------------------------------------------------------------

describe("executeTool — ferramenta desconhecida", () => {
  it("retorna erro JSON para nome de ferramenta inexistente", async () => {
    const result = await executeTool(
      makeToolCall("ferramenta_inexistente"),
      makeCtx()
    );
    const parsed = JSON.parse(result);

    expect(parsed.error).toMatch(/ferramenta desconhecida/i);
  });
});

// ---------------------------------------------------------------------------
// error boundary
// ---------------------------------------------------------------------------

describe("executeTool — tratamento de excecoes inesperadas", () => {
  it("captura excecao lancada por um servico e retorna erro JSON", async () => {
    vi.mocked(serviceService.listActive).mockRejectedValue(
      new Error("Conexao com banco falhou")
    );

    const result = await executeTool(makeToolCall("list_services"), makeCtx());
    const parsed = JSON.parse(result);

    expect(parsed.error).toBe("Conexao com banco falhou");
  });
});
