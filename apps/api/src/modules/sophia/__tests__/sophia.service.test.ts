import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Module mocks
//
// IMPORTANT: vi.mock paths are resolved relative to the TEST FILE, not the
// module under test. All paths must resolve to the same canonical file as
// those used by sophia.service.ts.
//
// Test file location:  src/modules/sophia/__tests__/sophia.service.test.ts
// Service location:    src/modules/sophia/sophia.service.ts
//
// env.js:                ../../../config/env.js  (src/config/env.ts)
// llm.js:                ../../../lib/llm.js     (src/lib/llm.ts)
// sophia.context.js:     ../sophia.context.js    (src/modules/sophia/sophia.context.ts)
// sophia.prompt.js:      ../sophia.prompt.js     (src/modules/sophia/sophia.prompt.ts)
// sophia.tools.js:       ../sophia.tools.js      (src/modules/sophia/sophia.tools.ts)
// notification service:  ../../notification/notification.service.js
// ---------------------------------------------------------------------------

// env.js is evaluated at load time by several transitive dependencies (llm.ts,
// supabase.ts). Mocking with a factory prevents Zod's validation from running.
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

// supabase.ts is imported transitively by sophia.context.ts. Mocking it
// prevents the postgres client from attempting a real connection.
vi.mock("../../../config/supabase.js", () => ({
  db: {},
}));

// llm.js imports env.js at module evaluation time — explicit factory required.
vi.mock("../../../lib/llm.js", () => ({
  sendMessage: vi.fn(),
}));

// sophia.context.js imports supabase/drizzle at module evaluation time.
vi.mock("../sophia.context.js", () => ({
  getOrCreateConversation: vi.fn(),
  saveMessage: vi.fn(),
  loadContext: vi.fn(),
  setHandoff: vi.fn(),
  updateCollectedData: vi.fn(),
  linkClient: vi.fn(),
  setIntent: vi.fn(),
  loadMessageHistory: vi.fn(),
}));

// sophia.tools.js imports several services that pull in supabase/env.
vi.mock("../sophia.tools.js", () => ({
  sophiaTools: [],
  executeTool: vi.fn(),
}));

// notification.service.js imports external clients at load time.
vi.mock("../../notification/notification.service.js", () => ({
  sendWhatsAppMessage: vi.fn(),
  sendEmail: vi.fn(),
  notifyMaquiadora: vi.fn(),
}));

// sophia.prompt.js has no side-effecting imports.
vi.mock("../sophia.prompt.js", () => ({
  buildSystemPrompt: vi.fn(),
}));

vi.mock("../../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports — must come after vi.mock declarations so hoisting takes effect
// ---------------------------------------------------------------------------

import { processMessage } from "../sophia.service.js";
import * as sophiaContext from "../sophia.context.js";
import * as notificationService from "../../notification/notification.service.js";
import { sendMessage } from "../../../lib/llm.js";
import { buildSystemPrompt } from "../sophia.prompt.js";
import { executeTool, sophiaTools } from "../sophia.tools.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PHONE = "5511999990000";
const CONTENT = "Olá, quero agendar um serviço";
const CONVERSATION_ID = "conv-1";

const baseConversation = {
  id: CONVERSATION_ID,
  isHandoff: false,
  status: "ativa",
};

const baseContext = {
  conversationId: CONVERSATION_ID,
  phone: PHONE,
  conversationStatus: "ativa",
  collectedData: {} as Record<string, unknown>,
  isHandoff: false,
  clientId: null as string | null,
  clientName: undefined as string | undefined,
  hasPendingBooking: false,
  services: [] as never[],
  messageHistory: [] as never[],
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("sophia.service — processMessage", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    // Default happy-path stubs re-applied after reset
    vi.mocked(sophiaContext.getOrCreateConversation).mockResolvedValue(
      baseConversation as never
    );
    vi.mocked(sophiaContext.saveMessage).mockResolvedValue(undefined);
    vi.mocked(sophiaContext.loadContext).mockResolvedValue({ ...baseContext } as never);
    vi.mocked(sophiaContext.setHandoff).mockResolvedValue(undefined);
    vi.mocked(buildSystemPrompt).mockReturnValue("system prompt");
    vi.mocked(notificationService.sendWhatsAppMessage).mockResolvedValue("msg-id" as never);
  });

  // -------------------------------------------------------------------------
  // Test 1 — happy path: LLM returns text on first iteration
  // -------------------------------------------------------------------------
  it("sends text response via WhatsApp when LLM returns text on first call", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({
      content: "Olá! Posso te ajudar a agendar um serviço. ✨",
      toolCalls: [],
    });

    await processMessage(PHONE, CONTENT);

    // Must get/create conversation with the caller's phone
    expect(vi.mocked(sophiaContext.getOrCreateConversation)).toHaveBeenCalledOnce();
    expect(vi.mocked(sophiaContext.getOrCreateConversation)).toHaveBeenCalledWith(PHONE);

    // Must persist the incoming client message
    expect(vi.mocked(sophiaContext.saveMessage)).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "client",
      CONTENT
    );

    // Must call LLM exactly once with the built system prompt
    expect(vi.mocked(sendMessage)).toHaveBeenCalledOnce();
    expect(vi.mocked(sendMessage)).toHaveBeenCalledWith(
      "system prompt",
      expect.any(Array),
      sophiaTools
    );

    // Must persist Sophia's reply before dispatching
    expect(vi.mocked(sophiaContext.saveMessage)).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "sophia",
      "Olá! Posso te ajudar a agendar um serviço. ✨"
    );

    // Must dispatch the reply via WhatsApp
    expect(vi.mocked(notificationService.sendWhatsAppMessage)).toHaveBeenCalledOnce();
    expect(vi.mocked(notificationService.sendWhatsAppMessage)).toHaveBeenCalledWith(
      PHONE,
      "Olá! Posso te ajudar a agendar um serviço. ✨",
      CONVERSATION_ID
    );

    // Must NOT trigger handoff on a clean text response
    expect(vi.mocked(sophiaContext.setHandoff)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 2 — tool calls: LLM requests a tool, result is fed back, then text
  // -------------------------------------------------------------------------
  it("executes tool calls and re-submits to LLM before sending final reply", async () => {
    const toolCall = {
      id: "call-1",
      name: "list_services",
      arguments: {},
    };

    // First call returns a tool call; second call returns plain text
    vi.mocked(sendMessage)
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [toolCall],
      })
      .mockResolvedValueOnce({
        content: "Aqui estão os nossos serviços!",
        toolCalls: [],
      });

    vi.mocked(executeTool).mockResolvedValue(
      JSON.stringify({ services: [{ name: "Maquiagem Social", price: "R$ 200.00" }] })
    );

    await processMessage(PHONE, CONTENT);

    // The tool must have been executed with the correct context
    expect(vi.mocked(executeTool)).toHaveBeenCalledOnce();
    expect(vi.mocked(executeTool)).toHaveBeenCalledWith(
      toolCall,
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        phone: PHONE,
      })
    );

    // LLM must have been called twice: once for tool dispatch, once for final answer
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(2);

    // The second LLM call must include the tool result in the message history
    const secondCallMessages = vi.mocked(sendMessage).mock.calls[1][1] as Array<{
      role: string;
      tool_call_id?: string;
    }>;
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "tool", tool_call_id: "call-1" }),
      ])
    );

    // Final answer must be sent via WhatsApp
    expect(vi.mocked(notificationService.sendWhatsAppMessage)).toHaveBeenCalledOnce();
    expect(vi.mocked(notificationService.sendWhatsAppMessage)).toHaveBeenCalledWith(
      PHONE,
      "Aqui estão os nossos serviços!",
      CONVERSATION_ID
    );
  });

  // -------------------------------------------------------------------------
  // Test 3 — handoff guard: conversation already in handoff → early return
  // -------------------------------------------------------------------------
  it("skips processing and returns early when conversation is in handoff", async () => {
    vi.mocked(sophiaContext.getOrCreateConversation).mockResolvedValueOnce({
      ...baseConversation,
      isHandoff: true,
    } as never);

    await processMessage(PHONE, CONTENT);

    // No downstream operation should run after the handoff guard
    expect(vi.mocked(sophiaContext.saveMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(sophiaContext.loadContext)).not.toHaveBeenCalled();
    expect(vi.mocked(sendMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(notificationService.sendWhatsAppMessage)).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Test 4 — max iterations: tool calls loop 5× → fallback + handoff triggered
  // -------------------------------------------------------------------------
  it("triggers handoff and sends fallback message after reaching max iterations (5)", async () => {
    const toolCall = {
      id: "call-loop",
      name: "check_availability",
      arguments: { date: "2026-04-01", service_id: "svc-1" },
    };

    // Always return a tool call so the loop never escapes to a text response
    vi.mocked(sendMessage).mockResolvedValue({
      content: null,
      toolCalls: [toolCall],
    });

    vi.mocked(executeTool).mockResolvedValue(
      JSON.stringify({ available: true, slots: [] })
    );

    await processMessage(PHONE, CONTENT);

    // The agentic loop must cap at MAX_TOOL_ITERATIONS = 5
    expect(vi.mocked(sendMessage)).toHaveBeenCalledTimes(5);
    expect(vi.mocked(executeTool)).toHaveBeenCalledTimes(5);

    const fallback =
      "Desculpe, estou com uma dificuldade técnica no momento. Vou chamar a Beatriz para te ajudar! ✨";

    // Fallback must be saved to conversation history
    expect(vi.mocked(sophiaContext.saveMessage)).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "sophia",
      fallback
    );

    // Fallback must be dispatched via WhatsApp
    expect(vi.mocked(notificationService.sendWhatsAppMessage)).toHaveBeenCalledWith(
      PHONE,
      fallback,
      CONVERSATION_ID
    );

    // Handoff must be set with the exact reason string from the service
    expect(vi.mocked(sophiaContext.setHandoff)).toHaveBeenCalledOnce();
    expect(vi.mocked(sophiaContext.setHandoff)).toHaveBeenCalledWith(
      CONVERSATION_ID,
      "Max tool iterations reached"
    );
  });

  // -------------------------------------------------------------------------
  // Test 5 — empty LLM response: content is null, no tool calls → graceful exit
  // -------------------------------------------------------------------------
  it("handles empty LLM response gracefully without sending a WhatsApp message", async () => {
    vi.mocked(sendMessage).mockResolvedValueOnce({
      content: null,
      toolCalls: [],
    });

    await processMessage(PHONE, CONTENT);

    // LLM must still have been called once
    expect(vi.mocked(sendMessage)).toHaveBeenCalledOnce();

    // Sophia must NOT persist an empty message
    const sophiaSaveCalls = vi.mocked(sophiaContext.saveMessage).mock.calls.filter(
      ([, role]) => role === "sophia"
    );
    expect(sophiaSaveCalls).toHaveLength(0);

    // WhatsApp must NOT be called when there is no content to send
    expect(vi.mocked(notificationService.sendWhatsAppMessage)).not.toHaveBeenCalled();

    // Handoff must NOT be triggered by an empty response
    expect(vi.mocked(sophiaContext.setHandoff)).not.toHaveBeenCalled();
  });
});
