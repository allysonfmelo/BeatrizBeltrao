import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/evolution.js");
vi.mock("../../../lib/resend.js");
vi.mock("../../../config/supabase.js");
vi.mock("../../../lib/logger.js");
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));
vi.mock("../../service/service-reference.service.js", () => ({
  getPdfCatalogPath: vi.fn(),
}));
vi.mock("../../../config/env.js", () => ({
  env: {
    MAQUIADORA_PHONE: "5511888880000",
    MAQUIADORA_EMAIL: "beatriz@test.com",
    RESEND_FROM_EMAIL: "test@studio.com",
  },
}));

import * as evolutionLib from "../../../lib/evolution.js";
import * as resendLib from "../../../lib/resend.js";
import * as supabaseModule from "../../../config/supabase.js";
import { readFile } from "node:fs/promises";
import { getPdfCatalogPath } from "../../service/service-reference.service.js";
import {
  sendWhatsAppMessage,
  sendSophiaMessage,
  splitSophiaMessage,
  sendWhatsAppServicePdf,
  sendBookingConfirmationEmail,
  notifyBookingCancelled,
  notifyMaquiadora,
} from "../notification.service.js";

// ---------------------------------------------------------------------------
// DB insert chain helper
// ---------------------------------------------------------------------------

function mockInsertChain() {
  return { values: vi.fn().mockResolvedValue(undefined) };
}

// ---------------------------------------------------------------------------
// Mock db object
// ---------------------------------------------------------------------------

const mockDb = {
  insert: vi.fn(),
};

vi.mocked(supabaseModule).db = mockDb as unknown as typeof supabaseModule.db;

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

describe("notification.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(evolutionLib.sendTextMessage).mockResolvedValue("evo-msg-id");
    vi.mocked(evolutionLib.sendDocument).mockResolvedValue("evo-doc-id");
    vi.mocked(resendLib.sendEmail).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue(Buffer.from("fake-pdf"));
    vi.mocked(getPdfCatalogPath).mockReturnValue("/tmp/catalog.pdf");

    const insertChain = mockInsertChain();
    mockDb.insert.mockReturnValue(insertChain);
  });

  // -------------------------------------------------------------------------
  // sendWhatsAppMessage
  // -------------------------------------------------------------------------

  describe("sendWhatsAppMessage", () => {
    it("envia via Evolution e persiste a mensagem no banco quando conversationId é fornecido", async () => {
      const result = await sendWhatsAppMessage(
        "5511999990000",
        "Olá, tudo bem?",
        "conv-uuid-1"
      );

      expect(evolutionLib.sendTextMessage).toHaveBeenCalledOnce();
      expect(evolutionLib.sendTextMessage).toHaveBeenCalledWith(
        "5511999990000",
        "Olá, tudo bem?"
      );

      expect(mockDb.insert).toHaveBeenCalledOnce();
      const insertChain = mockDb.insert.mock.results[0].value;
      expect(insertChain.values).toHaveBeenCalledOnce();

      const insertValues = insertChain.values.mock.calls[0][0];
      expect(insertValues.conversationId).toBe("conv-uuid-1");
      expect(insertValues.role).toBe("sophia");
      expect(insertValues.content).toBe("Olá, tudo bem?");
      expect(insertValues.messageType).toBe("text");
      expect(insertValues.evolutionMessageId).toBe("evo-msg-id");

      expect(result).toBe("evo-msg-id");
    });

    it("envia via Evolution sem persistir no banco quando conversationId não é fornecido", async () => {
      const result = await sendWhatsAppMessage("5511999990000", "Mensagem sem contexto");

      expect(evolutionLib.sendTextMessage).toHaveBeenCalledOnce();
      expect(mockDb.insert).not.toHaveBeenCalled();
      expect(result).toBe("evo-msg-id");
    });
  });

  // -------------------------------------------------------------------------
  // sendSophiaMessage + chunking
  // -------------------------------------------------------------------------

  describe("sendSophiaMessage", () => {
    it("quebra respostas longas em blocos de no máximo 2 linhas", async () => {
      const content =
        "Linha 1.\nLinha 2.\nLinha 3.\nLinha 4.";

      const chunks = splitSophiaMessage(content);
      expect(chunks).toEqual([
        "Linha 1.\nLinha 2.",
        "Linha 3.\nLinha 4.",
      ]);
    });

    it("envia todos os chunks e persiste cada envio no histórico", async () => {
      const ids = await sendSophiaMessage(
        "5511999990000",
        "Mensagem 1.\nMensagem 2.\nMensagem 3.",
        "conv-uuid-1"
      );

      expect(ids).toEqual(["evo-msg-id", "evo-msg-id"]);
      expect(evolutionLib.sendTextMessage).toHaveBeenCalledTimes(2);
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // sendWhatsAppServicePdf
  // -------------------------------------------------------------------------

  describe("sendWhatsAppServicePdf", () => {
    it("envia PDF por tema e persiste como documento", async () => {
      const id = await sendWhatsAppServicePdf(
        "5511999990000",
        "maquiagem",
        "conv-uuid-1",
        "Segue o catálogo ✨"
      );

      expect(getPdfCatalogPath).toHaveBeenCalledWith("maquiagem");
      expect(readFile).toHaveBeenCalledWith("/tmp/catalog.pdf");
      expect(evolutionLib.sendDocument).toHaveBeenCalledOnce();
      expect(id).toBe("evo-doc-id");

      const insertChain = mockDb.insert.mock.results[0].value;
      const insertValues = insertChain.values.mock.calls[0][0];
      expect(insertValues.messageType).toBe("document");
    });
  });

  // -------------------------------------------------------------------------
  // sendBookingConfirmationEmail
  // -------------------------------------------------------------------------

  describe("sendBookingConfirmationEmail", () => {
    it("envia email de confirmação formatado com os dados do agendamento", async () => {
      const emailData = {
        clientName: "Ana Clara Souza",
        serviceName: "Maquiagem de Noiva",
        scheduledDate: "2099-12-31",
        scheduledTime: "10:00",
        totalPrice: 500,
        depositAmount: 150,
      };

      await sendBookingConfirmationEmail("ana@example.com", emailData);

      expect(resendLib.sendEmail).toHaveBeenCalledOnce();

      const [to, subject, html] = vi.mocked(resendLib.sendEmail).mock.calls[0];
      expect(to).toBe("ana@example.com");
      expect(subject).toContain("Agendamento Confirmado");
      expect(html).toContain("Ana Clara Souza");
      expect(html).toContain("Maquiagem de Noiva");
      expect(html).toContain("2099-12-31");
      expect(html).toContain("10:00");
    });
  });

  // -------------------------------------------------------------------------
  // notifyBookingCancelled
  // -------------------------------------------------------------------------

  describe("notifyBookingCancelled", () => {
    it("envia mensagem WhatsApp de cancelamento com nome do serviço e data", async () => {
      await notifyBookingCancelled("5511999990000", "conv-uuid-1", {
        serviceName: "Maquiagem Social",
        scheduledDate: "2099-12-01",
      });

      expect(evolutionLib.sendTextMessage).toHaveBeenCalledOnce();

      const [phone, message] = vi.mocked(evolutionLib.sendTextMessage).mock.calls[0];
      expect(phone).toBe("5511999990000");
      expect(message).toContain("Maquiagem Social");
      expect(message).toContain("2099-12-01");
      expect(message).toContain("cancelado");
    });

    it("inclui motivo na mensagem de cancelamento quando fornecido", async () => {
      await notifyBookingCancelled("5511999990000", undefined, {
        serviceName: "Penteado",
        scheduledDate: "2099-11-15",
        reason: "Indisponibilidade da maquiadora",
      });

      const [, message] = vi.mocked(evolutionLib.sendTextMessage).mock.calls[0];
      expect(message).toContain("Indisponibilidade da maquiadora");
    });
  });

  // -------------------------------------------------------------------------
  // notifyMaquiadora
  // -------------------------------------------------------------------------

  describe("notifyMaquiadora", () => {
    it("envia WhatsApp e email para Beatriz com subject e detalhes", async () => {
      await notifyMaquiadora(
        "Novo Agendamento Confirmado",
        "Cliente: Ana Clara\nData: 2099-12-31\nHorário: 10:00"
      );

      expect(evolutionLib.sendTextMessage).toHaveBeenCalledOnce();
      const [phone, message] = vi.mocked(evolutionLib.sendTextMessage).mock.calls[0];
      expect(phone).toBe("5511888880000");
      expect(message).toContain("Novo Agendamento Confirmado");
      expect(message).toContain("Ana Clara");

      expect(resendLib.sendEmail).toHaveBeenCalledOnce();
      const [to, subject] = vi.mocked(resendLib.sendEmail).mock.calls[0];
      expect(to).toBe("beatriz@test.com");
      expect(subject).toBe("Novo Agendamento Confirmado");
    });
  });
});
