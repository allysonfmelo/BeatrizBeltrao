import type { ApiEnvelope, ApiMeta } from "@/types/client";

type QueryValue = string | number | undefined;

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

interface ApiRequestResult<TData> {
  data: TData | null;
  meta: ApiMeta | undefined;
  error: string | null;
  status: number;
}

function buildUrl(
  path: string,
  query?: Record<string, QueryValue>
): string {
  const url = new URL(path, API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * Performs a GET request against the backend API and parses `{ data, meta?, error? }`.
 */
export async function fetchApi<TData>(
  path: string,
  query?: Record<string, QueryValue>
): Promise<ApiRequestResult<TData>> {
  try {
    const response = await fetch(buildUrl(path, query), {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    const payload = (await response.json()) as ApiEnvelope<TData>;
    return {
      data: payload.data ?? null,
      meta: payload.meta,
      error: payload.error ?? (!response.ok ? "Falha ao consultar API." : null),
      status: response.status,
    };
  } catch {
    return {
      data: null,
      meta: undefined,
      error: "Nao foi possivel conectar com a API.",
      status: 0,
    };
  }
}

