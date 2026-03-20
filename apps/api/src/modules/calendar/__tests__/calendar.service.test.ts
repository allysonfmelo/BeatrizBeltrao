import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../config/env.js", () => ({
  env: {
    GOOGLE_CALENDAR_ID: "primary",
  },
}));
vi.mock("../../../lib/google-calendar.js");
vi.mock("../../../lib/logger.js");

import * as googleCalendar from "../../../lib/google-calendar.js";
import {
  isSlotAvailable,
  getAvailableSlots,
  createBookingEvent,
  deleteBookingEvent,
} from "../calendar.service.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockSlots: googleCalendar.TimeSlot[] = [
  { start: "09:00", end: "10:00" },
  { start: "14:00", end: "15:00" },
];

const mockBooking = {
  id: "booking-uuid-1",
  clientName: "Ana Clara Souza",
  clientPhone: "5511999990000",
  serviceName: "Maquiagem de Noiva",
  scheduledDate: "2099-12-31",
  scheduledTime: "09:00",
  endTime: "10:00",
};

// ---------------------------------------------------------------------------
// Setup logger mock (silent)
// ---------------------------------------------------------------------------

vi.mocked(await import("../../../lib/logger.js")).logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("calendar.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(googleCalendar.getAvailableSlots).mockResolvedValue(mockSlots);
    vi.mocked(googleCalendar.createEvent).mockResolvedValue("event-123");
    vi.mocked(googleCalendar.deleteEvent).mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  // isSlotAvailable
  // -------------------------------------------------------------------------

  describe("isSlotAvailable", () => {
    it("retorna true quando o slot de início existe na lista de slots disponíveis", async () => {
      const result = await isSlotAvailable("2099-12-31", "09:00", 60);

      expect(result).toBe(true);
      expect(googleCalendar.getAvailableSlots).toHaveBeenCalledWith("2099-12-31", 60);
    });

    it("retorna false quando o slot de início não está disponível", async () => {
      const result = await isSlotAvailable("2099-12-31", "11:00", 60);

      expect(result).toBe(false);
      expect(googleCalendar.getAvailableSlots).toHaveBeenCalledWith("2099-12-31", 60);
    });

    it("retorna false quando não há nenhum slot disponível na data", async () => {
      vi.mocked(googleCalendar.getAvailableSlots).mockResolvedValue([]);

      const result = await isSlotAvailable("2099-12-31", "09:00", 60);

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getAvailableSlots
  // -------------------------------------------------------------------------

  describe("getAvailableSlots", () => {
    it("delega para googleCalendar.getAvailableSlots e retorna os slots sem transformação", async () => {
      const result = await getAvailableSlots("2099-12-31", 90);

      expect(googleCalendar.getAvailableSlots).toHaveBeenCalledOnce();
      expect(googleCalendar.getAvailableSlots).toHaveBeenCalledWith("2099-12-31", 90);
      expect(result).toStrictEqual(mockSlots);
    });

    it("retorna lista vazia quando o google-calendar não encontra slots", async () => {
      vi.mocked(googleCalendar.getAvailableSlots).mockResolvedValue([]);

      const result = await getAvailableSlots("2099-12-31", 120);

      expect(result).toStrictEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // createBookingEvent
  // -------------------------------------------------------------------------

  describe("createBookingEvent", () => {
    it("cria evento com título composto de serviço e nome do cliente", async () => {
      await createBookingEvent(mockBooking);

      expect(googleCalendar.createEvent).toHaveBeenCalledOnce();

      const eventArg = vi.mocked(googleCalendar.createEvent).mock.calls[0][0];
      expect(eventArg.title).toContain("Maquiagem de Noiva");
      expect(eventArg.title).toContain("Ana Clara Souza");
    });

    it("cria evento com data, horário de início e fim corretos", async () => {
      await createBookingEvent(mockBooking);

      const eventArg = vi.mocked(googleCalendar.createEvent).mock.calls[0][0];
      expect(eventArg.date).toBe("2099-12-31");
      expect(eventArg.startTime).toBe("09:00");
      expect(eventArg.endTime).toBe("10:00");
    });

    it("inclui telefone do cliente e booking ID na descrição do evento", async () => {
      await createBookingEvent(mockBooking);

      const eventArg = vi.mocked(googleCalendar.createEvent).mock.calls[0][0];
      expect(eventArg.description).toContain("5511999990000");
      expect(eventArg.description).toContain("booking-uuid-1");
    });

    it("retorna o event ID fornecido pelo google-calendar", async () => {
      const eventId = await createBookingEvent(mockBooking);

      expect(eventId).toBe("event-123");
    });
  });

  // -------------------------------------------------------------------------
  // deleteBookingEvent
  // -------------------------------------------------------------------------

  describe("deleteBookingEvent", () => {
    it("deleta o evento pelo ID correto no google-calendar", async () => {
      await deleteBookingEvent("event-123");

      expect(googleCalendar.deleteEvent).toHaveBeenCalledOnce();
      expect(googleCalendar.deleteEvent).toHaveBeenCalledWith("event-123");
    });

    it("resolve sem retornar valor quando a deleção é bem-sucedida", async () => {
      await expect(deleteBookingEvent("event-123")).resolves.toBeUndefined();
    });
  });
});
