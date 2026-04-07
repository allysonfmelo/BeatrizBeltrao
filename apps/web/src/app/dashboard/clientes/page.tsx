import { ClientSearchForm } from "@/components/client-search-form";
import { ClientsTable } from "@/components/clients-table";
import { getClients } from "@/services/clients";

export const dynamic = "force-dynamic";

interface ClientsPageProps {
  searchParams?: {
    search?: string | string[];
    page?: string | string[];
  };
}

function parsePage(pageParam: string | string[] | undefined): number {
  const value = Array.isArray(pageParam) ? pageParam[0] : pageParam;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseSearch(searchParam: string | string[] | undefined): string {
  const raw = Array.isArray(searchParam) ? searchParam[0] : searchParam;
  return (raw ?? "").trim();
}

export default async function ClientsDashboardPage({
  searchParams,
}: ClientsPageProps) {
  const search = parseSearch(searchParams?.search);
  const page = parsePage(searchParams?.page);

  const result = await getClients({
    search: search || undefined,
    page,
    limit: 20,
  });

  return (
    <main className="page-shell stack-24">
      <header className="grid-top">
        <div className="stack-16">
          <span className="eyebrow">Dashboard · Wave 6</span>
          <h1
            className="headline"
            style={{ fontFamily: "var(--font-heading), serif" }}
          >
            Clientes com busca inteligente
          </h1>
          <p className="subhead">
            Explore a base de clientes do estudio com filtro por nome, telefone ou
            e-mail e acesso rapido ao historico individual de agendamentos.
          </p>
        </div>
        <div className="stack-16" style={{ textAlign: "right" }}>
          <a href="/dashboard/analytics" className="btn btn-secondary">
            Analytics
          </a>
          <span className="pill" style={{ marginLeft: 8 }}>Pagina {result.meta.page}</span>
        </div>
      </header>

      <ClientSearchForm initialSearch={search} />

      <div className="meta-bar card">
        <span className="pill">Total visivel: {result.data.length}</span>
        <span className="pill">Limite: {result.meta.limit}</span>
        <span className="pill">Retorno da API: {result.meta.total}</span>
      </div>

      {result.error ? <p className="alert">{result.error}</p> : null}
      <ClientsTable clients={result.data} />
    </main>
  );
}

