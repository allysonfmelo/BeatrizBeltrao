import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks — declared before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock("../../../config/env.js", () => ({
  env: {
    DEPOSIT_PERCENTAGE: 30,
    PAYMENT_TIMEOUT_HOURS: 24,
    ASAAS_API_KEY: "test-key",
    ASAAS_WEBHOOK_TOKEN: "test-token",
    ASAAS_ENVIRONMENT: "sandbox",
  },
}));
vi.mock("../../../config/supabase.js");
vi.mock("../../../lib/asaas.js");
vi.mock("../../booking/booking.service.js");
vi.mock("../../../lib/logger.js");

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

import * as supabase from "../../../config/supabase.js";
import * as asaas from "../../../lib/asaas.js";
import * as bookingService from "../../booking/booking.service.js";

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

function mockInsertChain() {
  return { values: vi.fn().mockResolvedValue(undefined) };
}

function mockUpdateChain() {
  const whereMock = vi.fn().mockResolvedValue(undefined);
  const setMock = vi.fn().mockReturnValue({ where: whereMock });
  return { set: setMock, _where: whereMock };
}

// ---------------------------------------------------------------------------
// Shared mock db object
// ---------------------------------------------------------------------------

const mockDb = {
  query: {
    payments: { findFirst: vi.fn() },
  },
  insert: vi.fn(),
  update: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockBooking = {
  id: "booking-uuid-1",
  depositAmount: "250.00",
  scheduledDate: "2099-12-31",
  serviceName: "Maquiagem de Noiva",
};

const mockClient = {
  fullName: "Ana Clara Souza",
  cpf: "12345678901",
  email: "ana@example.com",
  phone: "11999990000",
};

const mockAsaasCustomer = {
  id: "cus_123",
  name: "Ana Clara Souza",
  cpfCnpj: "12345678901",
};

const mockAsaasCharge = {
  id: "pay_123",
  invoiceUrl: "https://asaas.com/invoice/123",
  status: "PENDING",
  value: 250,
};

const mockPaymentRecord = {
  id: "payment-uuid-1",
  bookingId: "booking-uuid-1",
  asaasPaymentId: "pay_123",
  status: "pendente",
  method: null,
};

// ---------------------------------------------------------------------------
// Wire mocks before importing the service
// ---------------------------------------------------------------------------

vi.mocked(supabase).db = mockDb as unknown as typeof supabase.db;

vi.mocked(asaas.createCustomer).mockResolvedValue(mockAsaasCustomer);
vi.mocked(asaas.createCharge).mockResolvedValue(mockAsaasCharge);
vi.mocked(asaas.cancelPayment).mockResolvedValue(undefined);
vi.mocked(bookingService.findById).mockResolvedValue({
  id: mockPaymentRecord.bookingId,
  status: "pendente",
} as never);
vi.mocked(bookingService.confirmBooking).mockResolvedValue(undefined as never);

// ---------------------------------------------------------------------------
// Import the service under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  createPaymentForBooking,
  processPaymentConfirmation,
  cancelPaymentForBooking,
} from "../payment.service.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("payment.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-assign db reference after clearAllMocks
    vi.mocked(supabase).db = mockDb as unknown as typeof supabase.db;

    // Reset default ASAAS mocks
    vi.mocked(asaas.createCustomer).mockResolvedValue(mockAsaasCustomer);
    vi.mocked(asaas.createCharge).mockResolvedValue(mockAsaasCharge);
    vi.mocked(asaas.cancelPayment).mockResolvedValue(undefined);
    vi.mocked(bookingService.findById).mockResolvedValue({
      id: mockPaymentRecord.bookingId,
      status: "pendente",
    } as never);
    vi.mocked(bookingService.confirmBooking).mockResolvedValue(undefined as never);

    // Reset db defaults
    mockDb.query.payments.findFirst.mockResolvedValue(undefined);
    mockDb.insert.mockReturnValue(mockInsertChain());
    mockDb.update.mockReturnValue(mockUpdateChain());
  });

  // -------------------------------------------------------------------------
  // createPaymentForBooking
  // -------------------------------------------------------------------------

  describe("createPaymentForBooking", () => {
    it("cria customer no ASAAS com os dados do cliente", async () => {
      await createPaymentForBooking(mockBooking, mockClient);

      expect(asaas.createCustomer).toHaveBeenCalledOnce();
      expect(asaas.createCustomer).toHaveBeenCalledWith({
        name: mockClient.fullName,
        cpfCnpj: mockClient.cpf,
        email: mockClient.email,
        phone: mockClient.phone,
      });
    });

    it("cria cobrança no ASAAS com o valor do depósito, billingType UNDEFINED e referência do booking", async () => {
      await createPaymentForBooking(mockBooking, mockClient);

      expect(asaas.createCharge).toHaveBeenCalledOnce();
      const chargeArg = vi.mocked(asaas.createCharge).mock.calls[0][0];
      expect(chargeArg.customer).toBe(mockAsaasCustomer.id);
      expect(chargeArg.value).toBe(250);
      expect(chargeArg.billingType).toBe("UNDEFINED");
      expect(chargeArg.externalReference).toBe(mockBooking.id);
      expect(chargeArg.description).toContain(mockBooking.serviceName);
    });

    it("grava o pagamento no banco com status pendente e asaasPaymentId correto", async () => {
      const insertChain = mockInsertChain();
      mockDb.insert.mockReturnValue(insertChain);

      await createPaymentForBooking(mockBooking, mockClient);

      expect(mockDb.insert).toHaveBeenCalledOnce();
      expect(insertChain.values).toHaveBeenCalledOnce();

      const insertValues = insertChain.values.mock.calls[0][0];
      expect(insertValues.bookingId).toBe(mockBooking.id);
      expect(insertValues.asaasPaymentId).toBe(mockAsaasCharge.id);
      expect(insertValues.asaasInvoiceUrl).toBe(mockAsaasCharge.invoiceUrl);
      expect(insertValues.status).toBe("pendente");
      expect(insertValues.amount).toBe("250");
    });

    it("retorna a invoice URL gerada pelo ASAAS", async () => {
      const invoiceUrl = await createPaymentForBooking(mockBooking, mockClient);

      expect(invoiceUrl).toBe(mockAsaasCharge.invoiceUrl);
    });

    it("usa tomorrow como dueDate quando a data do agendamento já passou", async () => {
      const pastBooking = { ...mockBooking, scheduledDate: "2000-01-01" };

      await createPaymentForBooking(pastBooking, mockClient);

      const chargeArg = vi.mocked(asaas.createCharge).mock.calls[0][0];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const expectedDueDate = tomorrow.toISOString().split("T")[0];
      expect(chargeArg.dueDate).toBe(expectedDueDate);
    });
  });

  // -------------------------------------------------------------------------
  // processPaymentConfirmation
  // -------------------------------------------------------------------------

  describe("processPaymentConfirmation", () => {
    it("atualiza o status para confirmado e chama confirmBooking com bookingId correto", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(mockPaymentRecord);
      const updateChain = mockUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await processPaymentConfirmation("pay_123");

      expect(mockDb.update).toHaveBeenCalledOnce();
      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.status).toBe("confirmado");
      expect(setArg.paidAt).toBeInstanceOf(Date);

      expect(bookingService.confirmBooking).toHaveBeenCalledOnce();
      expect(bookingService.confirmBooking).toHaveBeenCalledWith(
        mockPaymentRecord.bookingId,
        undefined
      );
    });

    it("ignora processamento quando pagamento e booking já estão confirmados", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue({
        ...mockPaymentRecord,
        status: "confirmado",
      });
      vi.mocked(bookingService.findById).mockResolvedValue({
        id: mockPaymentRecord.bookingId,
        status: "confirmado",
      } as never);

      await processPaymentConfirmation("pay_123");

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(bookingService.confirmBooking).not.toHaveBeenCalled();
    });

    it("retenta confirmBooking quando o pagamento já está confirmado mas o booking ainda está pendente", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue({
        ...mockPaymentRecord,
        status: "confirmado",
      });
      vi.mocked(bookingService.findById).mockResolvedValue({
        id: mockPaymentRecord.bookingId,
        status: "pendente",
      } as never);

      await processPaymentConfirmation("pay_123", "PIX");

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(bookingService.confirmBooking).toHaveBeenCalledWith(
        mockPaymentRecord.bookingId,
        "pix"
      );
    });

    it("ignora processamento e não lança erro quando o pagamento não é encontrado", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(undefined);

      await expect(processPaymentConfirmation("pay_unknown")).resolves.toBeUndefined();

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(bookingService.confirmBooking).not.toHaveBeenCalled();
    });

    it("mapeia billing type PIX para método pix e passa para confirmBooking", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(mockPaymentRecord);
      const updateChain = mockUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await processPaymentConfirmation("pay_123", "PIX");

      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.method).toBe("pix");
      expect(bookingService.confirmBooking).toHaveBeenCalledWith(
        mockPaymentRecord.bookingId,
        "pix"
      );
    });

    it("mapeia billing type CREDIT_CARD para método credito", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(mockPaymentRecord);
      const updateChain = mockUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await processPaymentConfirmation("pay_123", "CREDIT_CARD");

      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.method).toBe("credito");
    });

    it("define method como null quando billingType não é reconhecido", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(mockPaymentRecord);
      const updateChain = mockUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await processPaymentConfirmation("pay_123", "BOLETO");

      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.method).toBeNull();
    });

    it("não chama confirmBooking de novo quando o booking já está confirmado no processamento atual", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(mockPaymentRecord);
      const updateChain = mockUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
      vi.mocked(bookingService.findById).mockResolvedValue({
        id: mockPaymentRecord.bookingId,
        status: "confirmado",
      } as never);

      await processPaymentConfirmation("pay_123");

      expect(mockDb.update).toHaveBeenCalledOnce();
      expect(bookingService.confirmBooking).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // cancelPaymentForBooking
  // -------------------------------------------------------------------------

  describe("cancelPaymentForBooking", () => {
    it("cancela a cobrança no ASAAS e atualiza o status para cancelado no banco", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(mockPaymentRecord);
      const updateChain = mockUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await cancelPaymentForBooking("booking-uuid-1");

      expect(asaas.cancelPayment).toHaveBeenCalledOnce();
      expect(asaas.cancelPayment).toHaveBeenCalledWith(mockPaymentRecord.asaasPaymentId);

      expect(mockDb.update).toHaveBeenCalledOnce();
      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.status).toBe("cancelado");
      expect(setArg.updatedAt).toBeInstanceOf(Date);
    });

    it("não faz nada quando nenhum pagamento é encontrado para o booking", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(undefined);

      await cancelPaymentForBooking("booking-uuid-missing");

      expect(asaas.cancelPayment).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("não cancela nem atualiza o banco quando o pagamento não está pendente", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue({
        ...mockPaymentRecord,
        status: "confirmado",
      });

      await cancelPaymentForBooking("booking-uuid-1");

      expect(asaas.cancelPayment).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("ainda atualiza o banco para cancelado quando o cancelamento no ASAAS falha", async () => {
      mockDb.query.payments.findFirst.mockResolvedValue(mockPaymentRecord);
      vi.mocked(asaas.cancelPayment).mockRejectedValue(new Error("ASAAS timeout"));
      const updateChain = mockUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await cancelPaymentForBooking("booking-uuid-1");

      expect(mockDb.update).toHaveBeenCalledOnce();
      const setArg = updateChain.set.mock.calls[0][0];
      expect(setArg.status).toBe("cancelado");
    });
  });
});
