import { describe, expect, it, vi } from "vitest";

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

vi.mock("../../../config/supabase.js", () => ({ db: {} }));
vi.mock("../../service/service.service.js", () => ({ listActive: vi.fn() }));
vi.mock("../../../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { classifyFirstClientMessage } from "../sophia.context.js";

describe("sophia.context — classifyFirstClientMessage", () => {
  it("classifies bridal CTA messages", () => {
    expect(
      classifyFirstClientMessage("Olá! Gostaria de agendar uma consultoria para noivas ✨")
    ).toBe("cta_bridal");
  });

  it("classifies question-style CTA messages", () => {
    expect(classifyFirstClientMessage("Oi, me explica melhor como funciona")).toBe(
      "cta_question"
    );
  });

  it("classifies generic CTA messages from the site", () => {
    expect(classifyFirstClientMessage("Oi, quero saber mais sobre os serviços")).toBe(
      "cta_generic"
    );
    expect(classifyFirstClientMessage("Quanto custa maquiagem e penteado?")).toBe(
      "cta_generic"
    );
  });

  it("classifies interest CTAs for social services", () => {
    expect(classifyFirstClientMessage("Tenho interesse na Maquiagem Social ✨")).toBe(
      "cta_interest"
    );
    expect(
      classifyFirstClientMessage("Tenho interesse em Penteado Social - Lisos & Ondulados ✨")
    ).toBe("cta_interest");
  });

  it("falls back to direct when the message is not a CTA", () => {
    expect(classifyFirstClientMessage("Boa tarde")).toBe("direct");
  });
});
