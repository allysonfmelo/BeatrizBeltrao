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
vi.mock("../../payment/payment.service.js");
vi.mock("../../notification/notification.service.js");
vi.mock("../../../lib/logger.js");
vi.mock("@trigger.dev/sdk/v3", () => ({
  runs: {
    cancel: vi.fn(),
  },
}));
vi.mock("../../../trigger/buffer-whatsapp-message.js", () => ({
  bufferWhatsappMessage: {
    trigger: vi.fn(),
  },
}));
vi.mock("../../../config/redis.js", () => ({
  BUFFER_PREFIX: "buffer:",
  BUFFER_TTL: 300,
  redis: {
    rpush: vi.fn(),
    expire: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import { runs } from "@trigger.dev/sdk/v3";
import * as paymentService from "../../payment/payment.service.js";
import * as notificationService from "../../notification/notification.service.js";
import { bufferWhatsappMessage } from "../../../trigger/buffer-whatsapp-message.js";
import { redis } from "../../../config/redis.js";
import {
  handleEvolutionWebhook,
  handleAsaasWebhook,
} from "../webhook.service.js";

const validEvolutionPayload = {
  event: "messages.upsert",
  instance: "test",
  data: {
    pushName: "Allyson Melo",
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

vi.mocked(await import("../../../lib/logger.js")).logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("webhook.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(redis.rpush).mockResolvedValue(1);
    vi.mocked(redis.expire).mockResolvedValue(1);
    vi.mocked(redis.get).mockResolvedValue(null);
    vi.mocked(redis.set).mockResolvedValue("OK");
    vi.mocked(runs.cancel).mockResolvedValue(undefined as never);

    vi.mocked(bufferWhatsappMessage.trigger).mockResolvedValue({
      id: "run-1",
    } as never);

    vi.mocked(paymentService.processPaymentConfirmation).mockResolvedValue(undefined as never);
    vi.mocked(notificationService.sendWhatsAppMessage).mockResolvedValue("evo-msg-id");
  });

  describe("handleEvolutionWebhook", () => {
    it("bufferiza mensagem de texto e agenda trigger com 15s", async () => {
      await handleEvolutionWebhook(validEvolutionPayload);

      expect(redis.rpush).toHaveBeenCalledWith("buffer:5511999990000", "Olá");
      expect(redis.expire).toHaveBeenCalledWith("buffer:5511999990000", 300);
      expect(redis.get).toHaveBeenCalledWith("buffer-run:5511999990000");

      expect(bufferWhatsappMessage.trigger).toHaveBeenCalledOnce();
      expect(bufferWhatsappMessage.trigger).toHaveBeenCalledWith(
        { phone: "5511999990000", pushName: "Allyson Melo" },
        { delay: "15s" }
      );

      expect(redis.set).toHaveBeenCalledWith(
        "buffer-run:5511999990000",
        "run-1",
        "EX",
        300
      );
    });

    it("cancela run anterior quando existir para aplicar debounce", async () => {
      vi.mocked(redis.get).mockResolvedValue("run-prev");

      await handleEvolutionWebhook(validEvolutionPayload);

      expect(runs.cancel).toHaveBeenCalledOnce();
      expect(runs.cancel).toHaveBeenCalledWith("run-prev");
      expect(bufferWhatsappMessage.trigger).toHaveBeenCalledOnce();
    });

    it("ignora mensagem enviada por nós (fromMe: true)", async () => {
      const payload = {
        ...validEvolutionPayload,
        data: {
          ...validEvolutionPayload.data,
          key: { ...validEvolutionPayload.data.key, fromMe: true },
        },
      };

      await handleEvolutionWebhook(payload);

      expect(redis.rpush).not.toHaveBeenCalled();
      expect(bufferWhatsappMessage.trigger).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("ignora mensagem de grupo (@g.us)", async () => {
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

      expect(redis.rpush).not.toHaveBeenCalled();
      expect(bufferWhatsappMessage.trigger).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("envia fallback quando mensagem não é texto", async () => {
      const payload = {
        ...validEvolutionPayload,
        data: {
          ...validEvolutionPayload.data,
          message: {},
          messageType: "imageMessage",
        },
      };

      await handleEvolutionWebhook(payload);

      expect(notificationService.sendWhatsAppMessage).toHaveBeenCalledOnce();
      expect(bufferWhatsappMessage.trigger).not.toHaveBeenCalled();
      expect(redis.rpush).not.toHaveBeenCalled();
    });

    it("ignora payload inválido", async () => {
      await handleEvolutionWebhook({ foo: "bar" });
      await handleEvolutionWebhook(null);
      await handleEvolutionWebhook(undefined);
      await handleEvolutionWebhook("string-inválida");

      expect(bufferWhatsappMessage.trigger).not.toHaveBeenCalled();
      expect(notificationService.sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it("ignora evento diferente de messages.upsert", async () => {
      const payload = {
        ...validEvolutionPayload,
        event: "connection.update",
      };

      await handleEvolutionWebhook(payload);

      expect(bufferWhatsappMessage.trigger).not.toHaveBeenCalled();
      expect(redis.rpush).not.toHaveBeenCalled();
    });

    it("extrai texto de extendedTextMessage", async () => {
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

      expect(redis.rpush).toHaveBeenCalledWith(
        "buffer:5511999990000",
        "Mensagem longa aqui"
      );
      expect(bufferWhatsappMessage.trigger).toHaveBeenCalledOnce();
    });
  });

  describe("handleAsaasWebhook", () => {
    it("processa PAYMENT_CONFIRMED e chama paymentService com id e billingType", async () => {
      await handleAsaasWebhook(validAsaasPayload, "test-token");

      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledOnce();
      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledWith(
        "pay_123",
        "PIX"
      );
    });

    it("lança erro quando token é inválido", async () => {
      await expect(
        handleAsaasWebhook(validAsaasPayload, "token-errado")
      ).rejects.toThrow("Invalid webhook token");

      expect(paymentService.processPaymentConfirmation).not.toHaveBeenCalled();
    });

    it("lança erro quando token não é enviado", async () => {
      await expect(
        handleAsaasWebhook(validAsaasPayload)
      ).rejects.toThrow("Invalid webhook token");

      expect(paymentService.processPaymentConfirmation).not.toHaveBeenCalled();
    });

    it("ignora payload inválido", async () => {
      await handleAsaasWebhook({ event: "EVENTO_DESCONHECIDO", payment: {} }, "test-token");
      await handleAsaasWebhook({ foo: "bar" }, "test-token");

      expect(paymentService.processPaymentConfirmation).not.toHaveBeenCalled();
    });

    it("processa PAYMENT_RECEIVED", async () => {
      const payload = { ...validAsaasPayload, event: "PAYMENT_RECEIVED" };

      await handleAsaasWebhook(payload, "test-token");

      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledOnce();
      expect(paymentService.processPaymentConfirmation).toHaveBeenCalledWith(
        "pay_123",
        "PIX"
      );
    });

    it("não lança erro para PAYMENT_OVERDUE e PAYMENT_DELETED", async () => {
      const overduePayload = { ...validAsaasPayload, event: "PAYMENT_OVERDUE" };
      const deletedPayload = { ...validAsaasPayload, event: "PAYMENT_DELETED" };

      await expect(handleAsaasWebhook(overduePayload, "test-token")).resolves.toBeUndefined();
      await expect(handleAsaasWebhook(deletedPayload, "test-token")).resolves.toBeUndefined();

      expect(paymentService.processPaymentConfirmation).not.toHaveBeenCalled();
    });
  });
});
