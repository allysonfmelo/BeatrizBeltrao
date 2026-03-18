import { z } from "zod";

export const cpfSchema = z
  .string()
  .transform((val) => val.replace(/\D/g, ""))
  .pipe(z.string().length(11, "CPF deve ter 11 dígitos"));

export const createClientSchema = z.object({
  fullName: z.string().min(3, "Nome deve ter pelo menos 3 caracteres").max(255),
  phone: z.string().min(10).max(20),
  cpf: cpfSchema,
  email: z.string().email("E-mail inválido").max(255),
  notes: z.string().optional(),
});

export type CreateClientDTO = z.infer<typeof createClientSchema>;
