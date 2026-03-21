import Link from "next/link";
import { formatDate, formatPhone } from "@/lib/formatters";
import type { ClientListItem } from "@/types/client";

interface ClientsTableProps {
  clients: ClientListItem[];
}

export function ClientsTable({ clients }: ClientsTableProps) {
  const createHistoryHref = (client: ClientListItem): string => {
    const params = new URLSearchParams({
      name: client.fullName,
      phone: client.phone,
      email: client.email,
    });
    return `/dashboard/clientes/${client.id}?${params.toString()}`;
  };

  if (clients.length === 0) {
    return (
      <div className="card" style={{ padding: 22 }}>
        <p className="muted" style={{ margin: 0 }}>
          Nenhuma cliente encontrada para o filtro atual.
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
              <th>Cliente</th>
              <th>Contato</th>
              <th>Total agend.</th>
              <th>Ultimo agend.</th>
              <th>Acoes</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>
                  <strong>{client.fullName}</strong>
                  <br />
                  <span className="muted">{client.email}</span>
                </td>
                <td>{formatPhone(client.phone)}</td>
                <td>{client.totalBookings}</td>
                <td>{formatDate(client.lastBookingDate)}</td>
                <td>
                  <Link className="btn btn-secondary" href={createHistoryHref(client)}>
                    Ver historico
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-list">
        {clients.map((client) => (
          <article className="mobile-item stack-16" key={client.id}>
            <div>
              <strong>{client.fullName}</strong>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                {client.email}
              </p>
            </div>
            <p style={{ margin: 0 }}>{formatPhone(client.phone)}</p>
            <div className="stack-16">
              <span className="pill">Agendamentos: {client.totalBookings}</span>
              <span className="pill">Ultimo: {formatDate(client.lastBookingDate)}</span>
            </div>
            <Link className="btn btn-secondary" href={createHistoryHref(client)}>
              Ver historico
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
