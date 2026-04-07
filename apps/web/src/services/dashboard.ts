import { fetchApi } from "@/services/api";
import type { DashboardMetrics } from "@/types/dashboard";

export async function getDashboardMetrics(month?: string) {
  const result = await fetchApi<DashboardMetrics>("/dashboard/metrics", {
    month,
  });

  return {
    data: result.data,
    error: result.error,
  };
}
