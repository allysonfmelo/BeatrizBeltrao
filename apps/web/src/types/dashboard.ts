export interface DashboardKPIs {
  totalContacts: number;
  messagesSent: number;
  totalBookings: number;
  conversionRate: number;
  totalRevenue: number;
  handoffRate: number;
}

export interface DashboardMetrics {
  period: {
    month: string;
    startDate: string;
    endDate: string;
  };
  kpis: DashboardKPIs;
  previousMonth: DashboardKPIs;
  bookingsByType: Array<{ type: string; count: number }>;
  bookingsByStatus: Array<{ status: string; count: number }>;
  intentDistribution: Array<{ intent: string; count: number }>;
  topServices: Array<{
    serviceId: string;
    name: string;
    count: number;
    revenue: number;
  }>;
  paymentMethods: Array<{
    method: string;
    count: number;
    total: number;
  }>;
  dailyTrend: Array<{
    date: string;
    bookings: number;
    revenue: number;
    contacts: number;
  }>;
}
