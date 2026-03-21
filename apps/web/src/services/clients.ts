import { fetchApi } from "@/services/api";
import type {
  ApiMeta,
  BookingStatus,
  ClientBookingHistoryItem,
  ClientBookingHistoryViewData,
  ClientListItem,
  ClientListViewData,
} from "@/types/client";

const DEFAULT_LIMIT = 20;

function createMeta(page: number, limit: number): ApiMeta {
  return { page, limit, total: 0 };
}

/**
 * Retrieves clients with optional search and pagination.
 */
export async function getClients(params: {
  search?: string;
  page?: number;
  limit?: number;
}): Promise<ClientListViewData> {
  const page = params.page ?? 1;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const result = await fetchApi<ClientListItem[]>("/clients", {
    search: params.search,
    page,
    limit,
  });

  return {
    data: Array.isArray(result.data) ? result.data : [],
    meta: result.meta ?? createMeta(page, limit),
    error: result.error,
  };
}

/**
 * Retrieves booking history for a specific client.
 */
export async function getClientBookingHistory(params: {
  clientId: string;
  status?: BookingStatus;
  page?: number;
  limit?: number;
}): Promise<ClientBookingHistoryViewData> {
  const page = params.page ?? 1;
  const limit = params.limit ?? DEFAULT_LIMIT;
  const result = await fetchApi<ClientBookingHistoryItem[]>(
    `/clients/${params.clientId}/bookings`,
    {
      status: params.status,
      page,
      limit,
    }
  );

  return {
    data: Array.isArray(result.data) ? result.data : [],
    meta: result.meta ?? createMeta(page, limit),
    error: result.error,
  };
}

