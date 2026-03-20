import { eq } from "drizzle-orm";
import { db } from "../../config/supabase.js";
import { services } from "@studio/db";
import type { ServiceType } from "@studio/shared/types";

/**
 * Lists all active services.
 */
export async function listActive() {
  return db.query.services.findMany({
    where: eq(services.isActive, true),
  });
}

/**
 * Finds a service by ID.
 */
export async function findById(id: string) {
  const result = await db.query.services.findFirst({
    where: eq(services.id, id),
  });
  return result ?? null;
}

/**
 * Finds services by type.
 */
export async function findByType(type: ServiceType) {
  return db.query.services.findMany({
    where: eq(services.type, type),
  });
}
