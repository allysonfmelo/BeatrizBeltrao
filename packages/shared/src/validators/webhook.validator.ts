import { z } from "zod";

/** Zod schema for Evolution API v2 webhook payload */
export const evolutionWebhookSchema = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.object({
    pushName: z.string().optional(),
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
    }),
    message: z
      .object({
        conversation: z.string().optional(),
        extendedTextMessage: z
          .object({
            text: z.string(),
          })
          .optional(),
      })
      .optional(),
    messageType: z.string().optional(),
    messageTimestamp: z.union([z.string(), z.number()]).optional(),
  }),
});

export type EvolutionWebhookDTO = z.infer<typeof evolutionWebhookSchema>;

/**
 * Extracts the text content from an Evolution webhook message.
 */
export function extractTextFromWebhook(data: EvolutionWebhookDTO["data"]): string | null {
  return (
    data.message?.conversation ??
    data.message?.extendedTextMessage?.text ??
    null
  );
}

/**
 * Extracts the contact display name from Evolution webhook payload.
 */
export function extractPushNameFromWebhook(data: EvolutionWebhookDTO["data"]): string | null {
  return data.pushName?.trim() || null;
}

/**
 * Extracts the phone number from a remoteJid (strips @s.whatsapp.net).
 */
export function extractPhoneFromJid(remoteJid: string): string {
  return remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
}
