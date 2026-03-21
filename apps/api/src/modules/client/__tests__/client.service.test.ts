import { beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../../../config/supabase.js", () => ({ db: {} }));
vi.mock("../../../lib/logger.js");

import * as supabase from "../../../config/supabase.js";
import { list, listBookingsByClient } from "../client.service.js";

function mockCountChain(total: number) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ total }]),
    }),
  };
}

function mockListClientsChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          groupBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    }),
  };
}

function mockClientBookingsChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    }),
  };
}

const mockDb = {
  query: {
    clients: { findFirst: vi.fn() },
  },
  insert: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
};

describe("client.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase).db = mockDb as unknown as typeof supabase.db;
  });

  describe("list", () => {
    it("retorna clientes com meta total consistente ao usar busca e paginação", async () => {
      const rows = [
        {
          id: "client-1",
          fullName: "Ana Clara",
          phone: "5511999990000",
          cpf: "12345678901",
          email: "ana@email.com",
          notes: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          totalBookings: 2,
          lastBookingDate: "2026-06-20",
        },
      ];

      mockDb.select
        .mockReturnValueOnce(mockCountChain(3))
        .mockReturnValueOnce(mockListClientsChain(rows));

      const result = await list({ search: "ana", page: 2, limit: 1 });

      expect(result.meta).toEqual({ page: 2, limit: 1, total: 3 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].fullName).toBe("Ana Clara");
      expect(result.data[0].totalBookings).toBe(2);
      expect(typeof result.data[0].totalBookings).toBe("number");
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });

  describe("listBookingsByClient", () => {
    it("retorna histórico enriquecido com dados do serviço e meta de paginação", async () => {
      const rows = [
        {
          id: "booking-1",
          clientId: "client-1",
          serviceId: "service-1",
          scheduledDate: "2026-06-20",
          scheduledTime: "09:00",
          endTime: "10:00",
          status: "confirmado",
          totalPrice: "350.00",
          depositAmount: "105.00",
          googleCalendarEventId: null,
          paymentDeadline: new Date("2026-06-19T09:00:00.000Z"),
          cancellationReason: null,
          createdAt: new Date("2026-06-01T09:00:00.000Z"),
          updatedAt: new Date("2026-06-01T09:00:00.000Z"),
          serviceName: "Maquiagem Social",
          serviceType: "maquiagem",
          serviceCategory: "estudio",
          servicePrice: "350.00",
          serviceDurationMinutes: 60,
        },
      ];

      mockDb.select
        .mockReturnValueOnce(mockCountChain(1))
        .mockReturnValueOnce(mockClientBookingsChain(rows));

      const result = await listBookingsByClient("client-1", {
        status: "confirmado",
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
        page: 1,
        limit: 10,
      });

      expect(result.meta).toEqual({ page: 1, limit: 10, total: 1 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].service.name).toBe("Maquiagem Social");
      expect(result.data[0].service.durationMinutes).toBe(60);
      expect(result.data[0].status).toBe("confirmado");
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });
  });
});
