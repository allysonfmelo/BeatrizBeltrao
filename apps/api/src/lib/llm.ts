import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { captureException } from "./sentry.js";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: env.OPENROUTER_API_KEY,
});

/** Message format for LLM conversations */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: LlmToolCall[];
}

/** Tool definition for function calling (OpenAI-compatible) */
export interface LlmTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Parsed tool call from LLM response */
export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** Response from the LLM */
export interface LlmResponse {
  content: string | null;
  toolCalls: LlmToolCall[];
}

/** Converts our LlmMessage to OpenAI SDK message params */
function toOpenAiMessages(
  systemPrompt: string,
  messages: LlmMessage[]
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = [
    { role: "system" as const, content: systemPrompt },
  ];

  for (const m of messages) {
    switch (m.role) {
      case "user":
        result.push({ role: "user" as const, content: m.content });
        break;
      case "assistant":
        if (m.tool_calls && m.tool_calls.length > 0) {
          result.push({
            role: "assistant" as const,
            content: m.content ?? null,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          });
        } else {
          result.push({ role: "assistant" as const, content: m.content });
        }
        break;
      case "tool":
        result.push({
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.tool_call_id ?? "",
        });
        break;
      case "system":
        result.push({ role: "system" as const, content: m.content });
        break;
    }
  }

  return result;
}

/** Optional per-request settings */
export interface SendMessageOptions {
  /**
   * Override the OpenRouter model for this request. Used by the test harness
   * to exercise Sophia against multiple models side by side (see the test
   * phone → model mapping in `sophia.service.ts`). When omitted, falls back
   * to `env.OPENROUTER_MODEL`.
   */
  modelOverride?: string;
}

/** Max number of LLM retries for transient upstream errors (429, 5xx). */
const LLM_MAX_ATTEMPTS = 4;
/** Base delay (ms) for exponential backoff between retries. */
const LLM_RETRY_BASE_MS = 800;

/**
 * Detects transient upstream errors that are worth retrying. Covers the
 * common cases we hit under burst load:
 *   - HTTP 429 Too Many Requests (OpenRouter rate limit / upstream provider
 *     rate limit — observed on Gemini Flash Lite during the real WhatsApp
 *     test when several agent-loop iterations fire in quick succession)
 *   - HTTP 5xx (provider instability)
 *   - Generic "rate limit" phrasing in the error message
 */
function isTransientLlmError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  if (/\b(429|rate[- ]?limit|too many requests)\b/i.test(message)) return true;
  if (/\b(500|502|503|504|server error|upstream|timeout)\b/i.test(message)) return true;
  // OpenAI SDK attaches a `status` property on some errors
  const status = (error as { status?: number }).status;
  if (typeof status === "number" && (status === 429 || (status >= 500 && status <= 599))) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a message to the LLM via OpenRouter and returns the response.
 * Supports tool/function calling for structured Sophia actions.
 * Retries transient upstream errors (429 / 5xx) with exponential backoff.
 */
export async function sendMessage(
  systemPrompt: string,
  messages: LlmMessage[],
  tools?: LlmTool[],
  options: SendMessageOptions = {}
): Promise<LlmResponse> {
  const model = options.modelOverride ?? env.OPENROUTER_MODEL;
  const allMessages = toOpenAiMessages(systemPrompt, messages);

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model,
    messages: allMessages,
    max_tokens: 1024,
    temperature: 0.7,
  };

  if (tools && tools.length > 0) {
    params.tools = tools as ChatCompletionTool[];
    params.tool_choice = "auto";
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.chat.completions.create(params);
      const choice = response.choices[0];

      if (!choice?.message) {
        logger.error("LLM returned empty response", { model, attempt });
        return { content: null, toolCalls: [] };
      }

      const toolCalls: LlmToolCall[] = (choice.message.tool_calls ?? [])
        .filter((tc): tc is ChatCompletionMessageFunctionToolCall =>
          tc.type === "function"
        )
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        }));

      if (attempt > 1) {
        logger.info("LLM request succeeded after retry", { model, attempt });
      }

      return {
        content: choice.message.content,
        toolCalls,
      };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);

      if (attempt < LLM_MAX_ATTEMPTS && isTransientLlmError(error)) {
        const delayMs = LLM_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn("LLM request transient error, retrying", {
          model,
          attempt,
          nextAttempt: attempt + 1,
          delayMs,
          error: message,
        });
        await sleep(delayMs);
        continue;
      }

      // Either not retryable, or we ran out of attempts — fall through.
      break;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown LLM error";
  captureException(lastError, { source: "llm.sendMessage", model });
  logger.error("LLM request failed after retries", { error: message, model, attempts: LLM_MAX_ATTEMPTS });
  throw new Error(`LLM request failed: ${message}`);
}
