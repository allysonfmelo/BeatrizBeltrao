import { formatCurrency, formatDate, formatTime } from "@/lib/formatters";
import type { ClientBookingHistoryItem } from "@/types/client";

interface ClientBookingHistoryProps {
  bookings: ClientBookingHistoryItem[];
}

function getStatusClass(status: string): string {
  if (
    status === "pendente" ||
    status === "confirmado" ||
    status === "cancelado" ||
    status === "concluido" ||
    status === "expirado"
  ) {
    return `status status-${status}`;
  }
  return "status";
}

function resolveServiceName(item: ClientBookingHistoryItem): string {
  return item.service?.name ?? item.serviceName ?? "Servico";
}

function resolveServiceType(item: ClientBookingHistoryItem): string {
  return item.service?.type ?? item.serviceType ?? "—";
}

function resolveServicePrice(item: ClientBookingHistoryItem): string {
  return item.service?.price ?? item.servicePrice ?? item.totalPrice;
}

export function ClientBookingHistory({ bookings }: ClientBookingHistoryProps) {
  if (bookings.length === 0) {
    return (
      <div className="card" style={{ padding: 22 }}>
        <p className="muted" style={{ margin: 0 }}>
          Esta cliente ainda nao possui historico de agendamentos.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="desktop-table table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Horario</th>
              <th>Servico</th>
              <th>Valor</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <td>{formatDate(booking.scheduledDate)}</td>
                <td>
                  {formatTime(booking.scheduledTime)} - {formatTime(booking.endTime)}
                </td>
                <td>
                  <strong>{resolveServiceName(booking)}</strong>
                  <br />
                  <span className="muted">{resolveServiceType(booking)}</span>
                </td>
                <td>{formatCurrency(resolveServicePrice(booking))}</td>
                <td>
                  <span className={getStatusClass(booking.status)}>{booking.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-list">
        {bookings.map((booking) => (
          <article className="mobile-item stack-16" key={booking.id}>
            <div>
              <strong>{resolveServiceName(booking)}</strong>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {resolveServiceType(booking)}
              </p>
            </div>
            <span className="pill">
              {formatDate(booking.scheduledDate)} · {formatTime(booking.scheduledTime)}
            </span>
            <span className="pill">{formatCurrency(resolveServicePrice(booking))}</span>
            <div>
              <span className={getStatusClass(booking.status)}>{booking.status}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

