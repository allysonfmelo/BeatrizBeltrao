import Link from "next/link";
import { ClientBookingHistory } from "@/components/client-booking-history";
import { formatPhone } from "@/lib/formatters";
import { getClientBookingHistory } from "@/services/clients";
import type { BookingStatus } from "@/types/client";

export const dynamic = "force-dynamic";

interface ClientHistoryPageProps {
  params: {
    id: string;
  };
  searchParams?: {
    status?: string | string[];
    page?: string | string[];
    name?: string | string[];
    phone?: string | string[];
    email?: string | string[];
  };
}

function parseSingle(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function parsePage(value: string | string[] | undefined): number {
  const page = Number(parseSingle(value));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseStatus(value: string | string[] | undefined): BookingStatus | undefined {
  const status = parseSingle(value);
  if (
    status === "pendente" ||
    status === "confirmado" ||
    status === "cancelado" ||
    status === "concluido" ||
    status === "expirado"
  ) {
    return status;
  }
  return undefined;
}

export default async function ClientHistoryPage({
  params,
  searchParams,
}: ClientHistoryPageProps) {
  const page = parsePage(searchParams?.page);
  const status = parseStatus(searchParams?.status);
  const name = parseSingle(searchParams?.name);
  const phone = parseSingle(searchParams?.phone);
  const email = parseSingle(searchParams?.email);

  const result = await getClientBookingHistory({
    clientId: params.id,
    status,
    page,
    limit: 20,
  });

  const displayedName = name || "Cliente";
  const statusCounts = result.data.reduce(
    (acc, booking) => {
      acc[booking.status] += 1;
      return acc;
    },
    {
      pendente: 0,
      confirmado: 0,
      cancelado: 0,
      concluido: 0,
      expirado: 0,
    } as Record<BookingStatus, number>
  );

  return (
    <main className="page-shell stack-24">
      <header className="grid-top">
        <div className="stack-16">
          <span className="eyebrow">Dashboard · Wave 7</span>
          <h1
            className="headline"
            style={{ fontFamily: "var(--font-heading), serif" }}
          >
            Historico de {displayedName}
          </h1>
          <p className="subhead">
            Analise o historico de agendamentos com filtros por status para apoiar
            atendimento, recorrencia e tomada de decisao comercial.
          </p>
          <div className="stack-16">
            <span className="pill">Cliente ID: {params.id}</span>
            {phone ? <span className="pill">{formatPhone(phone)}</span> : null}
            {email ? <span className="pill">{email}</span> : null}
          </div>
        </div>
        <Link className="btn btn-secondary" href="/dashboard/clientes">
          Voltar para clientes
        </Link>
      </header>

      <form className="card search-form" method="get">
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="phone" value={phone} />
        <input type="hidden" name="email" value={email} />
        <select className="select" name="status" defaultValue={status ?? ""}>
          <option value="">Todos os status</option>
          <option value="pendente">Pendente</option>
          <option value="confirmado">Confirmado</option>
          <option value="concluido">Concluido</option>
          <option value="cancelado">Cancelado</option>
          <option value="expirado">Expirado</option>
        </select>
        <button className="btn btn-primary" type="submit">
          Aplicar filtro
        </button>
        <Link
          className="btn btn-secondary"
          href={`/dashboard/clientes/${params.id}?name=${encodeURIComponent(name)}&phone=${encodeURIComponent(phone)}&email=${encodeURIComponent(email)}`}
        >
          Limpar
        </Link>
      </form>

      <div className="meta-bar card">
        <span className="pill">Total na API: {result.meta.total}</span>
        <span className="pill">Retornados: {result.data.length}</span>
        <span className="pill">Concluidos: {statusCounts.concluido}</span>
        <span className="pill">Confirmados: {statusCounts.confirmado}</span>
      </div>

      {result.error ? <p className="alert">{result.error}</p> : null}
      <ClientBookingHistory bookings={result.data} />
    </main>
  );
}

