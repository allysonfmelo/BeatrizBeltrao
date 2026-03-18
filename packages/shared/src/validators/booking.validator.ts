import { z } from "zod";

export const createBookingSchema = z.object({
  clientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato: YYYY-MM-DD"),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/, "Formato: HH:mm"),
});

export type CreateBookingDTO = z.infer<typeof createBookingSchema>;
