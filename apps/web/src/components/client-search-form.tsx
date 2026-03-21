interface ClientSearchFormProps {
  initialSearch: string;
}

export function ClientSearchForm({ initialSearch }: ClientSearchFormProps) {
  return (
    <form method="get" className="card search-form">
      <input
        className="input"
        name="search"
        placeholder="Buscar por nome, telefone ou e-mail"
        defaultValue={initialSearch}
      />
      <button className="btn btn-primary" type="submit">
        Buscar
      </button>
      <a className="btn btn-secondary" href="/dashboard/clientes">
        Limpar
      </a>
    </form>
  );
}

