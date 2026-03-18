import { z } from "zod";

export const asaasWebhookSchema = z.object({
  event: z.enum(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED"]),
  payment: z.object({
    id: z.string(),
    status: z.string(),
    value: z.number(),
    billingType: z.string().optional(),
  }),
});

export type AsaasWebhookDTO = z.infer<typeof asaasWebhookSchema>;
