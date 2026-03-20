import { sendMessage } from "../../lib/llm.js";
import type { LlmMessage } from "../../lib/llm.js";
import { buildSystemPrompt } from "./sophia.prompt.js";
import * as sophiaContext from "./sophia.context.js";
import { sophiaTools, executeTool } from "./sophia.tools.js";
import * as notificationService from "../notification/notification.service.js";
import { logger } from "../../lib/logger.js";

const MAX_TOOL_ITERATIONS = 5;

/**
 * Processes an incoming WhatsApp message through Sophia's agentic loop.
 *
 * Flow:
 * 1. Load conversation context and message history
 * 2. Build system prompt with dynamic context
 * 3. Send to LLM with tools
 * 4. If tool_calls → execute → resubmit (up to MAX_TOOL_ITERATIONS)
 * 5. When text response → save + send via WhatsApp
 */
export async function processMessage(
  phone: string,
  content: string
): Promise<void> {
  // 1. Get or create conversation
  const conversation = await sophiaContext.getOrCreateConversation(phone);

  // Check handoff — don't process if waiting for human
  if (conversation.isHandoff) {
    logger.info("Message received on handoff conversation, skipping Sophia", {
      conversationId: conversation.id,
      phone,
    });
    return;
  }

  // Save incoming message
  await sophiaContext.saveMessage(conversation.id, "client", content);

  // 2. Load full context
  const ctx = await sophiaContext.loadContext(conversation.id, phone);

  // 3. Build system prompt
  const systemPrompt = buildSystemPrompt({
    services: ctx.services,
    collectedData: ctx.collectedData,
    conversationStatus: ctx.conversationStatus,
    clientName: ctx.clientName,
    hasPendingBooking: ctx.hasPendingBooking,
  });

  // 4. Build message history with the new user message
  const llmMessages: LlmMessage[] = [
    ...ctx.messageHistory,
  ];

  // 5. Agentic loop
  let iterations = 0;
  let currentMessages = llmMessages;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const response = await sendMessage(systemPrompt, currentMessages, sophiaTools);

    // If there are tool calls, execute them and resubmit
    if (response.toolCalls.length > 0) {
      logger.debug("Sophia tool calls", {
        iteration: iterations,
        tools: response.toolCalls.map((tc) => tc.name),
      });

      // Add assistant message with tool calls to history
      const assistantMsg: LlmMessage = {
        role: "assistant",
        content: response.content ?? "",
        tool_calls: response.toolCalls,
      };
      currentMessages = [...currentMessages, assistantMsg];

      // Execute each tool and add results
      const toolContext = {
        conversationId: conversation.id,
        phone,
        clientId: ctx.clientId,
        collectedData: ctx.collectedData,
      };

      for (const toolCall of response.toolCalls) {
        const result = await executeTool(toolCall, toolContext);

        // Update context if client was linked
        if (toolContext.clientId !== ctx.clientId) {
          ctx.clientId = toolContext.clientId;
        }

        const toolMsg: LlmMessage = {
          role: "tool",
          content: result,
          tool_call_id: toolCall.id,
        };
        currentMessages = [...currentMessages, toolMsg];
      }

      continue;
    }

    // No tool calls — we have a text response
    if (response.content) {
      // Save Sophia's response
      await sophiaContext.saveMessage(conversation.id, "sophia", response.content);

      // Send via WhatsApp
      await notificationService.sendWhatsAppMessage(
        phone,
        response.content,
        conversation.id
      );

      logger.info("Sophia responded", {
        conversationId: conversation.id,
        phone,
        iterations,
      });
    } else {
      logger.warn("Sophia returned empty response", {
        conversationId: conversation.id,
        iterations,
      });
    }

    return;
  }

  // Max iterations reached — send fallback
  const fallbackMessage =
    "Desculpe, estou com uma dificuldade técnica no momento. Vou chamar a Beatriz para te ajudar! ✨";

  await sophiaContext.saveMessage(conversation.id, "sophia", fallbackMessage);
  await notificationService.sendWhatsAppMessage(phone, fallbackMessage, conversation.id);
  await sophiaContext.setHandoff(conversation.id, "Max tool iterations reached");

  logger.warn("Sophia max iterations reached, handoff triggered", {
    conversationId: conversation.id,
    phone,
  });
}
