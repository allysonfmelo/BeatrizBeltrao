import { Suspense } from "react";
import { getDashboardMetrics } from "@/services/dashboard";
import { KpiCard } from "@/components/kpi-card";
import { MonthPicker } from "@/components/month-picker";
import { DashboardCharts } from "@/components/dashboard-charts";

export const dynamic = "force-dynamic";

interface AnalyticsPageProps {
  searchParams?: {
    month?: string | string[];
  };
}

function parseMonth(param: string | string[] | undefined): string {
  const raw = Array.isArray(param) ? param[0] : param;
  if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const month = parseMonth(searchParams?.month);
  const { data: metrics, error } = await getDashboardMetrics(month);

  return (
    <main className="page-shell stack-24">
      <header className="grid-top">
        <div className="stack-16">
          <span className="eyebrow">Dashboard</span>
          <h1
            className="headline"
            style={{ fontFamily: "var(--font-heading), serif" }}
          >
            Analytics
          </h1>
          <p className="subhead">
            Visao geral do desempenho do estudio: contatos, bookings, receita e
            conversao.
          </p>
        </div>
        <div className="stack-16" style={{ textAlign: "right" }}>
          <a href="/dashboard/clientes" className="btn btn-secondary">
            Clientes
          </a>
        </div>
      </header>

      <Suspense fallback={<div className="pill">Carregando...</div>}>
        <MonthPicker currentMonth={month} />
      </Suspense>

      {error && <p className="alert">{error}</p>}

      {metrics && (
        <>
          <div className="kpi-grid">
            <KpiCard
              label="Contatos"
              value={String(metrics.kpis.totalContacts)}
              currentValue={metrics.kpis.totalContacts}
              previousValue={metrics.previousMonth.totalContacts}
            />
            <KpiCard
              label="Mensagens Sophia"
              value={String(metrics.kpis.messagesSent)}
              currentValue={metrics.kpis.messagesSent}
              previousValue={metrics.previousMonth.messagesSent}
            />
            <KpiCard
              label="Bookings"
              value={String(metrics.kpis.totalBookings)}
              currentValue={metrics.kpis.totalBookings}
              previousValue={metrics.previousMonth.totalBookings}
            />
            <KpiCard
              label="Conversao"
              value={`${metrics.kpis.conversionRate}%`}
              currentValue={metrics.kpis.conversionRate}
              previousValue={metrics.previousMonth.conversionRate}
            />
            <KpiCard
              label="Receita"
              value={formatCurrency(metrics.kpis.totalRevenue)}
              currentValue={metrics.kpis.totalRevenue}
              previousValue={metrics.previousMonth.totalRevenue}
            />
            <KpiCard
              label="Handoff Humano"
              value={`${metrics.kpis.handoffRate}%`}
              currentValue={metrics.kpis.handoffRate}
              previousValue={metrics.previousMonth.handoffRate}
            />
          </div>

          <DashboardCharts metrics={metrics} />
        </>
      )}

      {!metrics && !error && (
        <p className="muted">Nenhum dado disponivel para este periodo.</p>
      )}
    </main>
  );
}
