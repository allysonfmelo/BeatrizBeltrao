import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";

vi.mock("../client.service.js", () => ({
  list: vi.fn(),
  findById: vi.fn(),
  listBookingsByClient: vi.fn(),
}));

import * as clientService from "../client.service.js";
import { getClientBookings, listClients } from "../client.controller.js";

interface MockContextOptions {
  params?: Record<string, string>;
  query?: Record<string, string | undefined>;
}

function createMockContext(options: MockContextOptions = {}) {
  const params = options.params ?? {};
  const query = options.query ?? {};
  const json = vi.fn();

  const c = {
    req: {
      param: (key: string) => params[key],
      query: (key: string) => query[key],
    },
    json,
  } as unknown as Context;

  return { c, json };
}

describe("client.controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listClients", () => {
    it("encaminha busca e paginação para service.list e retorna o payload", async () => {
      const payload = {
        data: [
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
        ],
        meta: { page: 2, limit: 5, total: 11 },
      };
      vi.mocked(clientService.list).mockResolvedValue(payload);

      const { c, json } = createMockContext({
        query: { search: "ana", page: "2", limit: "5" },
      });

      await listClients(c);

      expect(clientService.list).toHaveBeenCalledWith({
        search: "ana",
        page: 2,
        limit: 5,
      });
      expect(json).toHaveBeenCalledWith(payload);
    });
  });

  describe("getClientBookings", () => {
    it("retorna 404 quando cliente não existe", async () => {
      vi.mocked(clientService.findById).mockResolvedValue(null);

      const { c, json } = createMockContext({
        params: { id: "client-inexistente" },
      });

      await getClientBookings(c);

      expect(clientService.findById).toHaveBeenCalledWith("client-inexistente");
      expect(clientService.listBookingsByClient).not.toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(
        { data: null, error: "Cliente não encontrada" },
        404
      );
    });

    it("retorna histórico com filtros, paginação e contrato padrão", async () => {
      vi.mocked(clientService.findById).mockResolvedValue({
        id: "client-1",
        fullName: "Ana Clara",
        phone: "5511999990000",
        cpf: "12345678901",
        email: "ana@email.com",
        notes: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });

      const payload = {
        data: [
          {
            id: "booking-1",
            clientId: "client-1",
            serviceId: "service-1",
            scheduledDate: "2026-06-20",
            scheduledTime: "09:00",
            endTime: "10:00",
            status: "confirmado" as const,
            totalPrice: "350.00",
            depositAmount: "105.00",
            googleCalendarEventId: null,
            paymentDeadline: new Date("2026-06-19T09:00:00.000Z"),
            cancellationReason: null,
            createdAt: new Date("2026-06-01T09:00:00.000Z"),
            updatedAt: new Date("2026-06-01T09:00:00.000Z"),
            service: {
              name: "Maquiagem Social",
              type: "maquiagem" as const,
              category: "estudio" as const,
              price: "350.00",
              durationMinutes: 60,
            },
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
        },
      };
      vi.mocked(clientService.listBookingsByClient).mockResolvedValue(payload);

      const { c, json } = createMockContext({
        params: { id: "client-1" },
        query: {
          status: "confirmado",
          date_from: "2026-06-01",
          date_to: "2026-06-30",
          page: "1",
          limit: "10",
        },
      });

      await getClientBookings(c);

      expect(clientService.listBookingsByClient).toHaveBeenCalledWith("client-1", {
        status: "confirmado",
        dateFrom: "2026-06-01",
        dateTo: "2026-06-30",
        page: 1,
        limit: 10,
      });
      expect(json).toHaveBeenCalledWith(payload);
    });
  });
});
