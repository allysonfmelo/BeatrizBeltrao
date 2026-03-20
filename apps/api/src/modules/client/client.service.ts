import { eq, ilike, or } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import { clients } from "@studio/db";
import { logger } from "../../lib/logger.js";
import type { CreateClientDTO } from "@studio/shared/validators";

/**
 * Finds a client by phone number.
 */
export async function findByPhone(phone: string) {
  const result = await db.query.clients.findFirst({
    where: eq(clients.phone, phone),
  });
  return result ?? null;
}

/**
 * Finds a client by ID.
 */
export async function findById(id: string) {
  const result = await db.query.clients.findFirst({
    where: eq(clients.id, id),
  });
  return result ?? null;
}

/**
 * Creates a new client.
 */
export async function create(data: CreateClientDTO) {
  const [client] = await db
    .insert(clients)
    .values({
      fullName: data.fullName,
      phone: data.phone,
      cpf: data.cpf,
      email: data.email,
      notes: data.notes ?? null,
    })
    .returning();

  logger.info("Client created", { clientId: client.id, phone: data.phone });
  return client;
}

/**
 * Updates an existing client.
 */
export async function update(id: string, data: Partial<CreateClientDTO>) {
  const [client] = await db
    .update(clients)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(clients.id, id))
    .returning();

  logger.info("Client updated", { clientId: id });
  return client;
}

/**
 * Lists clients with optional search and pagination.
 */
export async function list(params: { search?: string; page?: number; limit?: number }) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = db.select().from(clients);

  if (params.search) {
    const term = `%${params.search}%`;
    query = query.where(
      or(
        ilike(clients.fullName, term),
        ilike(clients.phone, term),
        ilike(clients.email, term)
      )
    ) as typeof query;
  }

  const data = await query.limit(limit).offset(offset);

  return { data, meta: { page, limit, total: data.length } };
}
