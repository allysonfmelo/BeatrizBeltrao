"use client";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  Legend,
} from "recharts";
import type { DashboardMetrics } from "@/types/dashboard";

const COLORS = ["#d57b52", "#1b7f6a", "#e8a87c", "#7b9e87", "#c17b5a", "#b85f37", "#5f4b40"];

const STATUS_COLORS: Record<string, string> = {
  pendente: "#d4a44e",
  confirmado: "#1b7f6a",
  cancelado: "#a33a3a",
  expirado: "#872f2f",
  concluido: "#2d6da0",
};

const INTENT_LABELS: Record<string, string> = {
  agendamento: "Agendamento",
  cancelamento: "Cancelamento",
  remarcacao: "Remarcacao",
  duvida: "Duvida",
  orcamento: "Orcamento",
  outro: "Outro",
};

const TYPE_LABELS: Record<string, string> = {
  maquiagem: "Maquiagem",
  penteado: "Penteado",
  combo: "Combo",
};

const METHOD_LABELS: Record<string, string> = {
  pix: "Pix",
  credito: "Credito",
  debito: "Debito",
  desconhecido: "N/A",
};

function formatCurrency(value: number) {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card chart-card">
      <h3 className="chart-title">{title}</h3>
      {children}
    </div>
  );
}

function SimplePie({
  data,
  labelMap,
}: {
  data: Array<{ name: string; value: number }>;
  labelMap?: Record<string, string>;
}) {
  if (data.length === 0) return <p className="muted">Sem dados</p>;
  const mapped = data.map((d) => ({
    ...d,
    name: labelMap?.[d.name] ?? d.name,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={mapped}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          outerRadius={80}
          label={({ name, percent }: { name?: string; percent?: number }) =>
            `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
          }
        >
          {mapped.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DashboardCharts({ metrics }: { metrics: DashboardMetrics }) {
  const bookingTypeData = metrics.bookingsByType.map((b) => ({
    name: b.type,
    value: b.count,
  }));

  const intentData = metrics.intentDistribution
    .filter((i) => i.intent !== null)
    .map((i) => ({
      name: i.intent!,
      value: i.count,
    }));

  const paymentData = metrics.paymentMethods.map((p) => ({
    name: p.method,
    value: p.count,
  }));

  const statusData = metrics.bookingsByStatus.map((b) => ({
    status: b.status,
    count: b.count,
  }));

  const dailyData = metrics.dailyTrend.map((d) => ({
    date: d.date.slice(5),
    bookings: d.bookings,
    revenue: d.revenue,
    contacts: d.contacts,
  }));

  return (
    <div className="charts-grid">
      <ChartCard title="Bookings por Tipo">
        <SimplePie data={bookingTypeData} labelMap={TYPE_LABELS} />
      </ChartCard>

      <ChartCard title="Intencoes de Contato">
        <SimplePie data={intentData} labelMap={INTENT_LABELS} />
      </ChartCard>

      <ChartCard title="Metodos de Pagamento">
        <SimplePie data={paymentData} labelMap={METHOD_LABELS} />
      </ChartCard>

      <ChartCard title="Status dos Bookings">
        {statusData.length === 0 ? (
          <p className="muted">Sem dados</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={statusData} layout="vertical" margin={{ left: 80 }}>
              <XAxis type="number" allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="status"
                tick={{ fontSize: 13 }}
              />
              <Tooltip />
              <Bar dataKey="count" name="Qtd">
                {statusData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={STATUS_COLORS[entry.status] ?? COLORS[i % COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Top Servicos">
        {metrics.topServices.length === 0 ? (
          <p className="muted">Sem dados</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={metrics.topServices} margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11 }}
                angle={-20}
                textAnchor="end"
                height={60}
              />
              <YAxis allowDecimals={false} />
              <Tooltip
                formatter={(value, name) =>
                  name === "revenue" ? formatCurrency(Number(value)) : value
                }
              />
              <Legend />
              <Bar dataKey="count" name="Bookings" fill="#d57b52" />
              <Bar dataKey="revenue" name="Receita" fill="#1b7f6a" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Tendencia Diaria">
        {dailyData.length === 0 ? (
          <p className="muted">Sem dados</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} />
              <Tooltip
                formatter={(value, name) =>
                  String(name) === "Receita" ? formatCurrency(Number(value)) : value
                }
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="contacts"
                name="Contatos"
                stroke="#d57b52"
                fill="#d57b52"
                fillOpacity={0.15}
              />
              <Area
                type="monotone"
                dataKey="bookings"
                name="Bookings"
                stroke="#1b7f6a"
                fill="#1b7f6a"
                fillOpacity={0.15}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Receita"
                stroke="#b85f37"
                fill="#b85f37"
                fillOpacity={0.1}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}
