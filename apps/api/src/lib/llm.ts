import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageFunctionToolCall,
} from "openai/resources/chat/completions";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

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

/**
 * Sends a message to the LLM via OpenRouter and returns the response.
 * Supports tool/function calling for structured Sophia actions.
 */
export async function sendMessage(
  systemPrompt: string,
  messages: LlmMessage[],
  tools?: LlmTool[]
): Promise<LlmResponse> {
  try {
    const allMessages = toOpenAiMessages(systemPrompt, messages);

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: env.OPENROUTER_MODEL,
      messages: allMessages,
      max_tokens: 1024,
      temperature: 0.7,
    };

    if (tools && tools.length > 0) {
      params.tools = tools as ChatCompletionTool[];
      params.tool_choice = "auto";
    }

    const response = await client.chat.completions.create(params);
    const choice = response.choices[0];

    if (!choice?.message) {
      logger.error("LLM returned empty response");
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

    return {
      content: choice.message.content,
      toolCalls,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown LLM error";
    logger.error("LLM request failed", { error: message });
    throw new Error(`LLM request failed: ${message}`);
  }
}
