import { eq, ilike, or, count, max, and, gte, lte, desc } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import { clients, bookings, services } from "@studio/db";
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
 * Includes total_bookings and last_booking_date stats.
 */
export async function list(params: { search?: string; page?: number; limit?: number }) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (params.search) {
    const term = `%${params.search}%`;
    conditions.push(
      or(
        ilike(clients.fullName, term),
        ilike(clients.phone, term),
        ilike(clients.email, term)
      )
    );
  }

  const where = conditions.length > 0 ? conditions[0] : undefined;

  const [countRow] = await db
    .select({ total: count(clients.id) })
    .from(clients)
    .where(where);

  const rows = await db
    .select({
      id: clients.id,
      fullName: clients.fullName,
      phone: clients.phone,
      cpf: clients.cpf,
      email: clients.email,
      notes: clients.notes,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
      totalBookings: count(bookings.id),
      lastBookingDate: max(bookings.scheduledDate),
    })
    .from(clients)
    .leftJoin(bookings, eq(clients.id, bookings.clientId))
    .where(where)
    .groupBy(clients.id)
    .limit(limit)
    .offset(offset);

  const data = rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    cpf: row.cpf,
    email: row.email,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    totalBookings: Number(row.totalBookings),
    lastBookingDate: row.lastBookingDate,
  }));

  return {
    data,
    meta: {
      page,
      limit,
      total: Number(countRow?.total ?? 0),
    },
  };
}

/**
 * Lists booking history for a specific client with optional filters and pagination.
 * Includes enriched service data for each booking.
 */
export async function listBookingsByClient(
  clientId: string,
  params: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }
) {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;
  const offset = (page - 1) * limit;

  const conditions = [eq(bookings.clientId, clientId)];

  if (params.status) {
    conditions.push(
      eq(
        bookings.status,
        params.status as "pendente" | "confirmado" | "cancelado" | "concluido" | "expirado"
      )
    );
  }
  if (params.dateFrom) {
    conditions.push(gte(bookings.scheduledDate, params.dateFrom));
  }
  if (params.dateTo) {
    conditions.push(lte(bookings.scheduledDate, params.dateTo));
  }

  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: count(bookings.id) })
    .from(bookings)
    .where(where);

  const rows = await db
    .select({
      id: bookings.id,
      clientId: bookings.clientId,
      serviceId: bookings.serviceId,
      scheduledDate: bookings.scheduledDate,
      scheduledTime: bookings.scheduledTime,
      endTime: bookings.endTime,
      status: bookings.status,
      totalPrice: bookings.totalPrice,
      depositAmount: bookings.depositAmount,
      googleCalendarEventId: bookings.googleCalendarEventId,
      paymentDeadline: bookings.paymentDeadline,
      cancellationReason: bookings.cancellationReason,
      createdAt: bookings.createdAt,
      updatedAt: bookings.updatedAt,
      serviceName: services.name,
      serviceType: services.type,
      serviceCategory: services.category,
      servicePrice: services.price,
      serviceDurationMinutes: services.durationMinutes,
    })
    .from(bookings)
    .leftJoin(services, eq(bookings.serviceId, services.id))
    .where(where)
    .orderBy(desc(bookings.scheduledDate), desc(bookings.scheduledTime))
    .limit(limit)
    .offset(offset);

  const data = rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    serviceId: row.serviceId,
    scheduledDate: row.scheduledDate,
    scheduledTime: row.scheduledTime,
    endTime: row.endTime,
    status: row.status,
    totalPrice: row.totalPrice,
    depositAmount: row.depositAmount,
    googleCalendarEventId: row.googleCalendarEventId,
    paymentDeadline: row.paymentDeadline,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    service: {
      name: row.serviceName,
      type: row.serviceType,
      category: row.serviceCategory,
      price: row.servicePrice,
      durationMinutes: row.serviceDurationMinutes,
    },
  }));

  return {
    data,
    meta: {
      page,
      limit,
      total: Number(countRow?.total ?? 0),
    },
  };
}
