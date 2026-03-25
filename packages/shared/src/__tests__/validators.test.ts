import { describe, it, expect } from "vitest";
import {
  createBookingSchema,
  createClientSchema,
  cpfSchema,
  asaasWebhookSchema,
  evolutionWebhookSchema,
  extractTextFromWebhook,
  extractPushNameFromWebhook,
  extractPhoneFromJid,
} from "../validators/index.js";

// ---------------------------------------------------------------------------
// createBookingSchema
// ---------------------------------------------------------------------------

describe("createBookingSchema", () => {
  const validBooking = {
    clientId: "550e8400-e29b-41d4-a716-446655440000",
    serviceId: "550e8400-e29b-41d4-a716-446655440001",
    scheduledDate: "2030-01-15",
    scheduledTime: "10:00",
  };

  it("accepts valid booking data", () => {
    const result = createBookingSchema.safeParse(validBooking);
    expect(result.success).toBe(true);
  });

  it("rejects invalid UUID for clientId", () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      clientId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a date in the past", () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      scheduledDate: "2020-01-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Data não pode ser no passado");
    }
  });

  it("rejects scheduledTime before 05:00 (business hours)", () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      scheduledTime: "04:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Horário deve ser entre 05:00 e 22:00");
    }
  });

  it("rejects scheduledTime after 22:00 (business hours)", () => {
    const result = createBookingSchema.safeParse({
      ...validBooking,
      scheduledTime: "23:00",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Horário deve ser entre 05:00 e 22:00");
    }
  });
});

// ---------------------------------------------------------------------------
// createClientSchema
// ---------------------------------------------------------------------------

describe("createClientSchema", () => {
  const validClient = {
    fullName: "Maria Silva Santos",
    phone: "11999998888",
    cpf: "12345678900",
    email: "maria@example.com",
  };

  it("accepts valid client data", () => {
    const result = createClientSchema.safeParse(validClient);
    expect(result.success).toBe(true);
  });

  it("rejects fullName shorter than 3 characters", () => {
    const result = createClientSchema.safeParse({
      ...validClient,
      fullName: "Ai",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Nome deve ter pelo menos 3 caracteres");
    }
  });

  it("rejects invalid email address", () => {
    const result = createClientSchema.safeParse({
      ...validClient,
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("E-mail inválido");
    }
  });
});

// ---------------------------------------------------------------------------
// cpfSchema
// ---------------------------------------------------------------------------

describe("cpfSchema", () => {
  it("normalizes a formatted CPF (dots and dashes) to 11 digits", () => {
    const result = cpfSchema.safeParse("123.456.789-00");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("12345678900");
    }
  });

  it("rejects a CPF string that does not have 11 digits after cleaning", () => {
    const result = cpfSchema.safeParse("123.456");
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("CPF deve ter 11 dígitos");
    }
  });
});

// ---------------------------------------------------------------------------
// asaasWebhookSchema
// ---------------------------------------------------------------------------

describe("asaasWebhookSchema", () => {
  const validWebhook = {
    event: "PAYMENT_CONFIRMED",
    payment: {
      id: "pay_abc123",
      status: "CONFIRMED",
      value: 150.0,
      billingType: "PIX",
    },
  };

  it("accepts a valid ASAAS payment webhook payload", () => {
    const result = asaasWebhookSchema.safeParse(validWebhook);
    expect(result.success).toBe(true);
  });

  it("accepts a webhook payload without the optional billingType", () => {
    const { billingType: _removed, ...paymentWithoutBilling } =
      validWebhook.payment;
    const result = asaasWebhookSchema.safeParse({
      ...validWebhook,
      payment: paymentWithoutBilling,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown event type", () => {
    const result = asaasWebhookSchema.safeParse({
      ...validWebhook,
      event: "PAYMENT_PENDING",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// evolutionWebhookSchema
// ---------------------------------------------------------------------------

describe("evolutionWebhookSchema", () => {
  const validEvolutionPayload = {
    event: "messages.upsert",
    instance: "studio-instance",
    data: {
      key: {
        remoteJid: "5511999998888@s.whatsapp.net",
        fromMe: false,
        id: "ABCDEF123456",
      },
      message: {
        conversation: "Olá, gostaria de agendar",
      },
    },
  };

  it("accepts a valid Evolution API webhook payload", () => {
    const result = evolutionWebhookSchema.safeParse(validEvolutionPayload);
    expect(result.success).toBe(true);
  });

  it("accepts a payload with extendedTextMessage instead of conversation", () => {
    const result = evolutionWebhookSchema.safeParse({
      ...validEvolutionPayload,
      data: {
        ...validEvolutionPayload.data,
        message: {
          extendedTextMessage: { text: "Mensagem longa aqui" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload without a message field (system events)", () => {
    const result = evolutionWebhookSchema.safeParse({
      ...validEvolutionPayload,
      data: {
        key: validEvolutionPayload.data.key,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts pushName in payload data", () => {
    const result = evolutionWebhookSchema.safeParse({
      ...validEvolutionPayload,
      data: {
        ...validEvolutionPayload.data,
        pushName: "Allyson Melo",
      },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractTextFromWebhook
// ---------------------------------------------------------------------------

describe("extractTextFromWebhook", () => {
  const baseKey = {
    remoteJid: "5511999998888@s.whatsapp.net",
    fromMe: false,
    id: "MSG001",
  };

  it("extracts text from the conversation field", () => {
    const data = {
      key: baseKey,
      message: { conversation: "Olá, quero agendar!" },
    };
    expect(extractTextFromWebhook(data)).toBe("Olá, quero agendar!");
  });

  it("extracts text from extendedTextMessage.text when conversation is absent", () => {
    const data = {
      key: baseKey,
      message: { extendedTextMessage: { text: "Texto estendido aqui" } },
    };
    expect(extractTextFromWebhook(data)).toBe("Texto estendido aqui");
  });

  it("returns null when neither conversation nor extendedTextMessage is present", () => {
    const data = { key: baseKey };
    expect(extractTextFromWebhook(data)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractPushNameFromWebhook
// ---------------------------------------------------------------------------

describe("extractPushNameFromWebhook", () => {
  const baseKey = {
    remoteJid: "5511999998888@s.whatsapp.net",
    fromMe: false,
    id: "MSG001",
  };

  it("extracts pushName when present", () => {
    const data = {
      key: baseKey,
      pushName: "Allyson Melo",
      message: { conversation: "Olá!" },
    };
    expect(extractPushNameFromWebhook(data)).toBe("Allyson Melo");
  });

  it("returns null when pushName is missing", () => {
    const data = {
      key: baseKey,
      message: { conversation: "Olá!" },
    };
    expect(extractPushNameFromWebhook(data)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractPhoneFromJid
// ---------------------------------------------------------------------------

describe("extractPhoneFromJid", () => {
  it("strips @s.whatsapp.net suffix from a JID", () => {
    expect(extractPhoneFromJid("5511999998888@s.whatsapp.net")).toBe(
      "5511999998888",
    );
  });

  it("strips @g.us suffix from a group JID", () => {
    expect(extractPhoneFromJid("120363000000000001@g.us")).toBe(
      "120363000000000001",
    );
  });
});
