import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
//
// env.js is mocked with a factory so its Zod validation never runs in test
// environments — the real module would throw if env vars are absent.
// supabase.js depends on env.js, so env.js must be mocked first.
// All paths are relative to this __tests__/ directory.
// ---------------------------------------------------------------------------

vi.mock("../../../config/env.js", () => ({
  env: {
    PORT: 3001,
    NODE_ENV: "test",
    CORS_ORIGIN: "http://localhost:3000",
    DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    OPENROUTER_API_KEY: "test-openrouter-key",
    OPENROUTER_MODEL: "anthropic/claude-sonnet-4",
    EVOLUTION_API_URL: "http://localhost:8080",
    EVOLUTION_API_KEY: "test-evolution-key",
    EVOLUTION_INSTANCE_NAME: "test-instance",
    ASAAS_API_KEY: "test-asaas-key",
    ASAAS_WEBHOOK_TOKEN: "test-webhook-token",
    ASAAS_ENVIRONMENT: "sandbox",
    DEPOSIT_PERCENTAGE: 30,
    PAYMENT_TIMEOUT_HOURS: 24,
    RESEND_FROM_EMAIL: "contato@studiobeatrizbeltrao.com.br",
  },
}));

vi.mock("../../../config/supabase.js");
vi.mock("../../calendar/calendar.service.js");
vi.mock("../../notification/notification.service.js");
vi.mock("../../../lib/logger.js");

// ---------------------------------------------------------------------------
// Imports — after mocks so the service receives mocked dependencies
// ---------------------------------------------------------------------------

import * as supabase from "../../../config/supabase.js";
import * as calendarService from "../../calendar/calendar.service.js";
import * as notificationService from "../../notification/notification.service.js";

import {
  createPreBooking,
  confirmBooking,
  cancelBooking,
  expireOverdueBookings,
  listBookings,
  findById,
  findPendingByClientId,
} from "../booking.service.js";

// ---------------------------------------------------------------------------
// Chain helpers — simulate Drizzle ORM fluent API
// ---------------------------------------------------------------------------

function mockInsertChain(returnValue: unknown) {
  return {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([returnValue]),
    }),
  };
}

function mockUpdateChain(returnValue: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([returnValue]),
      }),
    }),
  };
}

/** Update chain without .returning() — used in expireOverdueBookings loop */
function mockUpdateChainNoReturn() {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

/**
 * Chain for queries that end at .offset() — used by listBookings.
 * Shape: select().from().leftJoin().leftJoin().where().orderBy().limit().offset()
 */
function mockSelectChainWithPagination(returnValue: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockResolvedValue(returnValue),
  };
}

/**
 * Chain for queries that end at .where() — used by expireOverdueBookings and findById.
 * Shape: select().from().leftJoin().leftJoin().where()  (awaited at .where())
 */
function mockSelectChainEndingAtWhere(returnValue: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(returnValue),
  };
}

// ---------------------------------------------------------------------------
// Shared mock db object
// ---------------------------------------------------------------------------

const mockDb = {
  query: {
    services: { findFirst: vi.fn() },
    clients: { findFirst: vi.fn() },
    bookings: { findFirst: vi.fn() },
  },
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockService = {
  id: "service-1",
  name: "Maquiagem Noiva",
  type: "maquiagem",
  price: "500.00",
  durationMinutes: 120,
};

const mockClient = {
  id: "client-1",
  fullName: "Ana Clara",
  phone: "5511999990000",
  email: "ana@email.com",
};

const mockBookingPendente = {
  id: "booking-1",
  clientId: "client-1",
  serviceId: "service-1",
  scheduledDate: "2026-06-10",
  scheduledTime: "09:00",
  endTime: "11:00",
  status: "pendente",
  totalPrice: "500.00",
  depositAmount: "150.00",
  googleCalendarEventId: null,
  paymentDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
  cancellationReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockBookingConfirmado = {
  ...mockBookingPendente,
  status: "confirmado",
  googleCalendarEventId: "cal-event-1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("booking.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-wire db reference — clearAllMocks resets mock implementations but the
    // module property itself still points to the mockDb object we assign here.
    vi.mocked(supabase).db = mockDb as unknown as typeof supabase.db;

    vi.mocked(calendarService.createBookingEvent).mockResolvedValue("cal-event-1");
    vi.mocked(calendarService.deleteBookingEvent).mockResolvedValue(undefined);
    vi.mocked(notificationService.sendBookingConfirmationEmail).mockResolvedValue(undefined);
    vi.mocked(notificationService.notifyMaquiadora).mockResolvedValue(undefined);
    vi.mocked(notificationService.sendWhatsAppMessage).mockResolvedValue("msg-id");
  });

  // -------------------------------------------------------------------------
  // createPreBooking
  // -------------------------------------------------------------------------

  describe("createPreBooking", () => {
    it("cria pré-agendamento com status pendente e depositAmount de 30%", async () => {
      mockDb.query.services.findFirst.mockResolvedValue(mockService);
      mockDb.insert.mockReturnValue(mockInsertChain(mockBookingPendente));

      const result = await createPreBooking({
        clientId: "client-1",
        serviceId: "service-1",
        scheduledDate: "2026-06-10",
        scheduledTime: "09:00",
      });

      expect(result.status).toBe("pendente");

      const valuesCall = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
      // 30% of 500.00 = 150
      expect(valuesCall.depositAmount).toBe("150");
      expect(valuesCall.status).toBe("pendente");
      expect(valuesCall.totalPrice).toBe("500");
    });

    it("define deadline de pagamento aproximadamente 24h no futuro", async () => {
      mockDb.query.services.findFirst.mockResolvedValue(mockService);
      mockDb.insert.mockReturnValue(mockInsertChain(mockBookingPendente));

      const before = Date.now();
      await createPreBooking({
        clientId: "client-1",
        serviceId: "service-1",
        scheduledDate: "2026-06-10",
        scheduledTime: "09:00",
      });
      const after = Date.now();

      const valuesCall = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
      const deadline: Date = valuesCall.paymentDeadline;
      const expectedMin = before + 24 * 60 * 60 * 1000 - 1000;
      const expectedMax = after + 24 * 60 * 60 * 1000 + 1000;
      expect(deadline.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(deadline.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it("calcula endTime corretamente somando a duração do serviço ao horário inicial", async () => {
      mockDb.query.services.findFirst.mockResolvedValue({ ...mockService, durationMinutes: 90 });
      mockDb.insert.mockReturnValue(mockInsertChain(mockBookingPendente));

      await createPreBooking({
        clientId: "client-1",
        serviceId: "service-1",
        scheduledDate: "2026-06-10",
        scheduledTime: "10:30",
      });

      const valuesCall = mockDb.insert.mock.results[0].value.values.mock.calls[0][0];
      // 10:30 + 90 min = 12:00
      expect(valuesCall.endTime).toBe("12:00");
    });

    it("lança erro quando serviço não existe", async () => {
      mockDb.query.services.findFirst.mockResolvedValue(undefined);

      await expect(
        createPreBooking({
          clientId: "client-1",
          serviceId: "service-inexistente",
          scheduledDate: "2026-06-10",
          scheduledTime: "09:00",
        })
      ).rejects.toThrow("Serviço não encontrado");
    });
  });

  // -------------------------------------------------------------------------
  // confirmBooking
  // -------------------------------------------------------------------------

  describe("confirmBooking", () => {
    it("atualiza status para confirmado, cria evento no calendar e envia notificações", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(mockBookingPendente);
      mockDb.query.clients.findFirst.mockResolvedValue(mockClient);
      mockDb.query.services.findFirst.mockResolvedValue(mockService);
      mockDb.update.mockReturnValue(mockUpdateChain(mockBookingConfirmado));

      const result = await confirmBooking("booking-1", "pix");

      expect(result.status).toBe("confirmado");
      expect(result.googleCalendarEventId).toBe("cal-event-1");

      expect(calendarService.createBookingEvent).toHaveBeenCalledOnce();
      expect(calendarService.createBookingEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "booking-1",
          clientName: "Ana Clara",
          serviceName: "Maquiagem Noiva",
        })
      );

      expect(notificationService.sendWhatsAppMessage).toHaveBeenCalledOnce();
      expect(notificationService.sendWhatsAppMessage).toHaveBeenCalledWith(
        "5511999990000",
        expect.stringContaining("Agendamento confirmado")
      );

      expect(notificationService.sendBookingConfirmationEmail).toHaveBeenCalledOnce();
      expect(notificationService.sendBookingConfirmationEmail).toHaveBeenCalledWith(
        "ana@email.com",
        expect.objectContaining({ clientName: "Ana Clara", serviceName: "Maquiagem Noiva" })
      );

      expect(notificationService.notifyMaquiadora).toHaveBeenCalledOnce();
      expect(notificationService.notifyMaquiadora).toHaveBeenCalledWith(
        "Novo Agendamento Confirmado",
        expect.stringContaining("Ana Clara")
      );
    });

    it("lança erro quando booking não encontrado", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(undefined);

      await expect(confirmBooking("booking-inexistente")).rejects.toThrow(
        "Booking não encontrado"
      );
    });

    it("lança erro quando booking não está com status pendente", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue({
        ...mockBookingPendente,
        status: "confirmado",
      });

      await expect(confirmBooking("booking-1")).rejects.toThrow("Booking não está pendente");
    });

    it("confirma booking mesmo quando a criação do evento no calendar falha", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(mockBookingPendente);
      mockDb.query.clients.findFirst.mockResolvedValue(mockClient);
      mockDb.query.services.findFirst.mockResolvedValue(mockService);
      mockDb.update.mockReturnValue(
        mockUpdateChain({ ...mockBookingConfirmado, googleCalendarEventId: null })
      );
      vi.mocked(calendarService.createBookingEvent).mockRejectedValue(
        new Error("Google Calendar indisponível")
      );

      const result = await confirmBooking("booking-1");

      // Booking confirmed even without a calendar event
      expect(result.status).toBe("confirmado");
      expect(mockDb.update).toHaveBeenCalledOnce();
    });
  });

  // -------------------------------------------------------------------------
  // cancelBooking
  // -------------------------------------------------------------------------

  describe("cancelBooking", () => {
    it("atualiza status para cancelado e remove evento do calendar quando presente", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(mockBookingConfirmado);
      mockDb.update.mockReturnValue(
        mockUpdateChain({ ...mockBookingConfirmado, status: "cancelado" })
      );

      const result = await cancelBooking("booking-1", "Cliente desistiu");

      expect(result.status).toBe("cancelado");
      expect(calendarService.deleteBookingEvent).toHaveBeenCalledOnce();
      expect(calendarService.deleteBookingEvent).toHaveBeenCalledWith("cal-event-1");

      const setCall = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
      expect(setCall.status).toBe("cancelado");
      expect(setCall.cancellationReason).toBe("Cliente desistiu");
    });

    it("cancela booking sem tentar remover evento quando não há googleCalendarEventId", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(mockBookingPendente); // no calendar event
      mockDb.update.mockReturnValue(
        mockUpdateChain({ ...mockBookingPendente, status: "cancelado" })
      );

      const result = await cancelBooking("booking-1");

      expect(result.status).toBe("cancelado");
      expect(calendarService.deleteBookingEvent).not.toHaveBeenCalled();
    });

    it("lança erro quando booking não encontrado", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(undefined);

      await expect(cancelBooking("booking-inexistente")).rejects.toThrow(
        "Booking não encontrado"
      );
    });
  });

  // -------------------------------------------------------------------------
  // expireOverdueBookings
  // -------------------------------------------------------------------------

  describe("expireOverdueBookings", () => {
    it("expira bookings pendentes com prazo vencido e notifica clientes via WhatsApp", async () => {
      const overdueBooking = {
        ...mockBookingPendente,
        id: "booking-overdue",
        paymentDeadline: new Date(Date.now() - 1000),
      };

      mockDb.select.mockReturnValue(mockSelectChainEndingAtWhere([overdueBooking]));
      mockDb.update.mockReturnValue(mockUpdateChainNoReturn());
      mockDb.query.clients.findFirst.mockResolvedValue(mockClient);

      const count = await expireOverdueBookings();

      expect(count).toBe(1);

      const setCall = mockDb.update.mock.results[0].value.set.mock.calls[0][0];
      expect(setCall.status).toBe("expirado");
      expect(setCall.cancellationReason).toBe("Prazo de pagamento expirado");

      expect(notificationService.sendWhatsAppMessage).toHaveBeenCalledOnce();
      expect(notificationService.sendWhatsAppMessage).toHaveBeenCalledWith(
        mockClient.phone,
        expect.stringContaining("24 horas")
      );
    });

    it("retorna 0 quando não há bookings com prazo vencido", async () => {
      mockDb.select.mockReturnValue(mockSelectChainEndingAtWhere([]));

      const count = await expireOverdueBookings();

      expect(count).toBe(0);
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("expira múltiplos bookings e retorna a contagem correta", async () => {
      const overdue1 = { ...mockBookingPendente, id: "booking-overdue-1", clientId: "client-1" };
      const overdue2 = { ...mockBookingPendente, id: "booking-overdue-2", clientId: "client-1" };

      mockDb.select.mockReturnValue(mockSelectChainEndingAtWhere([overdue1, overdue2]));
      mockDb.update
        .mockReturnValueOnce(mockUpdateChainNoReturn())
        .mockReturnValueOnce(mockUpdateChainNoReturn());
      mockDb.query.clients.findFirst.mockResolvedValue(mockClient);

      const count = await expireOverdueBookings();

      expect(count).toBe(2);
      expect(notificationService.sendWhatsAppMessage).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // listBookings
  // -------------------------------------------------------------------------

  describe("listBookings", () => {
    it("retorna lista de bookings com dados enriquecidos e metadados de paginação", async () => {
      const enrichedRow = {
        ...mockBookingPendente,
        clientFullName: "Ana Clara",
        clientPhone: "5511999990000",
        clientEmail: "ana@email.com",
        serviceName: "Maquiagem Noiva",
        serviceType: "maquiagem",
        servicePrice: "500.00",
      };

      mockDb.select.mockReturnValue(mockSelectChainWithPagination([enrichedRow]));

      const result = await listBookings({ page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].client).toEqual({
        fullName: "Ana Clara",
        phone: "5511999990000",
        email: "ana@email.com",
      });
      expect(result.data[0].service).toEqual({
        name: "Maquiagem Noiva",
        type: "maquiagem",
        price: "500.00",
      });
      expect(result.meta).toEqual({ page: 1, limit: 10, total: 1 });
    });

    it("usa valores padrão de paginação quando não fornecidos", async () => {
      mockDb.select.mockReturnValue(mockSelectChainWithPagination([]));

      const result = await listBookings({});

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
    });

    it("retorna lista vazia quando não há bookings no período filtrado", async () => {
      mockDb.select.mockReturnValue(mockSelectChainWithPagination([]));

      const result = await listBookings({ dateFrom: "2026-01-01", dateTo: "2026-01-02" });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------

  describe("findById", () => {
    it("retorna booking enriquecido com dados do cliente e serviço quando encontrado", async () => {
      const enrichedRow = {
        ...mockBookingPendente,
        clientFullName: "Ana Clara",
        clientPhone: "5511999990000",
        clientEmail: "ana@email.com",
        serviceName: "Maquiagem Noiva",
        serviceType: "maquiagem",
        servicePrice: "500.00",
      };

      mockDb.select.mockReturnValue(mockSelectChainEndingAtWhere([enrichedRow]));

      const result = await findById("booking-1");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("booking-1");
      expect(result?.client.fullName).toBe("Ana Clara");
      expect(result?.service.name).toBe("Maquiagem Noiva");
    });

    it("retorna null quando booking não encontrado", async () => {
      mockDb.select.mockReturnValue(mockSelectChainEndingAtWhere([]));

      const result = await findById("booking-inexistente");

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findPendingByClientId
  // -------------------------------------------------------------------------

  describe("findPendingByClientId", () => {
    it("retorna booking pendente quando cliente possui agendamento pendente", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(mockBookingPendente);

      const result = await findPendingByClientId("client-1");

      expect(result).not.toBeNull();
      expect(result?.status).toBe("pendente");
      expect(result?.clientId).toBe("client-1");
    });

    it("retorna null quando cliente não possui agendamento pendente", async () => {
      mockDb.query.bookings.findFirst.mockResolvedValue(undefined);

      const result = await findPendingByClientId("client-sem-pendente");

      expect(result).toBeNull();
    });
  });
});
