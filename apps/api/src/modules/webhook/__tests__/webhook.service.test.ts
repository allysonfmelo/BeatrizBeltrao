import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../config/env.js", () => ({
  env: {
    ASAAS_WEBHOOK_TOKEN: "test-token",
    OPENROUTER_API_KEY: "test-key",
    OPENROUTER_MODEL: "test-model",
    EVOLUTION_API_URL: "http://localhost:8080",
    EVOLUTION_API_KEY: "test-key",
    EVOLUTION_INSTANCE_NAME: "test",
    RESEND_FROM_EMAIL: "test@studio.com",
  },
}));
vi.mock("../../../config/supabase.js");
vi.mock("../../../lib/llm.js");
vi.mock("../../../lib/evolution.js");
vi.mock("../../../lib/resend.js");
vi.mock("../../sophia/sophia.service.js");
vi.mock("../../payment/payment.service.js");
vi.mock("../../notification/notification.service.js");
vi.mock("../../../lib/logger.js");

import * as sophiaService from "../../sophia/sophia.service.js";
import * as paymentService from "../../payment/payment.service.js";
import * as notificationService from "../../notification/notification.service.js";
import {
  handleEvolutionWebhook,
  handleAsaasWebhook,
} from "../webhook.service.js";

// ---------------------------------------------------------------------------
// Shared payloads
// ---------------------------------------------------------------------------

const validEvolutionPayload = {
  event: "messages.upsert",
  instance: "test",
  data: {
    key: {
      remoteJid: "5511999990000@s.whatsapp.net",
      fromMe: false,
      id: "msg-1",
    },
    message: { conversation: "Olá" },
    messageType: "conversation",
  },
};

const validAsaasPayload = {
  event: "PAYMENT_CONFIRMED",
  payment: {
    id: "pay_123",
    status: "CONFIRMED",
    value: 75,
    billingType: "PIX",
  },
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

describe("webhook.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(sophiaService.processMessage).mockResolvedValue(undefined as never);
    vi.mocked(paymentService.processPaymentConfirmation).mockResolvedValue(undefined as never);
    vi.mocked(notificationService.sendWhatsAppMessage).mockResolvedValue("evo-msg-id");
  });

  // -------------------------------------------------------------------------
  // handleEvolutionWebhook
  // -------------------------------------------------------------------------

  describe("handleEvolutionWebhook", () => {
    it("processa mensagem de texto válida e chama sophiaService.processMessage com phone e texto", async () => {
      await handleEvolutionWebhook(validEvolutionPayload);

      expect(sophiaService.processMessage).toHaveBeenCalledOnce();
      expect(sophiaService.processMessage).toHaveBeenCalledWith(
        "5511999990000",
        "Olá"
      );
    });

    it("ignora mensagem enviada por nós (fromMe: true) sem chamar sophia", async () => {
      const payload = {
        ...validEvolutionPayload,
        data: {
          ...validEvolutionPayload.data,
          key: { ...validEvolutionPayload.data.key, fromMe: true },
        },
      };

      await handleEvolutionWebhook(payload);

      expect(sophiaService.processMessage).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("ignora mensagem de grupo (@g.us) sem chamar sophia", async () => {
      const payload = {
        ...validEvolutionPayload,
        data: {
          ...validEvolutionPayload.data,
          key: {
            ...validEvolutionPayload.data.key,
            remoteJid: "120363000000000001@g.us",
          },
        },
      };

      await handleEvolutionWebhook(payload);

      expect(sophiaService.processMessage).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("envia resposta educada quando mensagem não é de texto (sem conversation nem extendedTextMessage)", async () => {
      const payload = {
        ...validEvolutionPayload,
        data: {
          ...validEvolutionPayload.data,
          message: {},
          messageType: "imageMessage",
        },
      };

      await handleEvolutionWebhook(payload);

      expect(sophiaService.processMessage).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).toHaveBeenCalledOnce();

      const [phone, message] = vi.mocked(notificationService.sendWhatsAppMessage).mock.calls[0];
      expect(phone).toBe("5511999990000");
      expect(message).toContain("mensagens de texto");
    });

    it("ignora payload inválido/malformado sem lançar erro", async () => {
      await handleEvolutionWebhook({ foo: "bar" });
      await handleEvolutionWebhook(null);
      await handleEvolutionWebhook(undefined);
      await handleEvolutionWebhook("string-inválida");

      expect(sophiaService.processMessage).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("ignora evento que não é messages.upsert sem chamar sophia", async () => {
      const payload = {
        ...validEvolutionPayload,
        event: "connection.update",
      };

      await handleEvolutionWebhook(payload);

      expect(sophiaService.processMessage).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("extrai texto de extendedTextMessage quando conversation não está presente", async () => {
      const payload = {
        ...validEvolutionPayload,
        data: {
          ...validEvolutionPayload.data,
          message: {
            extendedTextMessage: { text: "Mensagem longa aqui" },
          },
          messageType: "extendedTextMessage",
        },
      };

      await handleEvolutionWebhook(payload);

      expect(sophiaService.processMessage).toHaveBeenCalledWith(
        "5511999990000",
        "Mensagem longa aqui"
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleAsaasWebhook
  // -------------------------------------------------------------------------

  describe("handleAsaasWebhook", () => {
    it("processa PAYMENT_CONFIRMED e chama paymentService.processPaymentConfirmation com id e billingType", async () => {
      await handleAsaasWebhook(validAsaasPayload, "test-token");

      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledOnce();
      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledWith(
        "pay_123",
        "PIX"
      );
    });

    it("lança erro quando o webhook token é inválido", async () => {
      await expect(
        handleAsaasWebhook(validAsaasPayload, "token-errado")
      ).rejects.toThrow("Invalid webhook token");

      expect(paymentService.processPaymentConfirmation).not.toHaveBeenCalled();
    });

    it("ignora payload inválido (schema incorreto) sem lançar erro", async () => {
      await handleAsaasWebhook({ event: "EVENTO_DESCONHECIDO", payment: {} }, "test-token");
      await handleAsaasWebhook({ foo: "bar" }, "test-token");

      expect(paymentService.processPaymentConfirmation).not.toHaveBeenCalled();
    });

    it("processa PAYMENT_RECEIVED e chama paymentService.processPaymentConfirmation", async () => {
      const payload = { ...validAsaasPayload, event: "PAYMENT_RECEIVED" };

      await handleAsaasWebhook(payload, "test-token");

      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledOnce();
      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledWith(
        "pay_123",
        "PIX"
      );
    });

    it("aceita webhook sem token quando nenhum token é fornecido", async () => {
      await handleAsaasWebhook(validAsaasPayload);

      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledOnce();
    });

    it("não lança erro para eventos PAYMENT_OVERDUE e PAYMENT_DELETED (apenas loga)", async () => {
      const overduePayload = { ...validAsaasPayload, event: "PAYMENT_OVERDUE" };
      const deletedPayload = { ...validAsaasPayload, event: "PAYMENT_DELETED" };

      await expect(handleAsaasWebhook(overduePayload, "test-token")).resolves.toBeUndefined();
      await expect(handleAsaasWebhook(deletedPayload, "test-token")).resolves.toBeUndefined();

      expect(paymentService.processPaymentConfirmation).not.toHaveBeenCalled();
    });
  });
});
