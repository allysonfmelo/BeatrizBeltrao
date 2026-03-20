import { z } from "zod";

export const createBookingSchema = z.object({
  clientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  scheduledDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato: YYYY-MM-DD")
    .refine((val) => {
      const date = new Date(`${val}T12:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return date >= today;
    }, "Data não pode ser no passado"),
  scheduledTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Formato: HH:mm")
    .refine((val) => {
      const [h, m] = val.split(":").map(Number);
      const minutes = h * 60 + m;
      return minutes >= 300 && minutes <= 1320; // 05:00 - 22:00
    }, "Horário deve ser entre 05:00 e 22:00"),
});

export type CreateBookingDTO = z.infer<typeof createBookingSchema>;
