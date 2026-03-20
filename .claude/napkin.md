# Napkin

## Session 2026-03-18 — Bootstrap / System Init

- Scaffolded full monorepo structure from PRD
- Stack: Hono + Drizzle + Supabase + Evolution API + ASAAS + Claude API
- 6 parallel agents used for scaffold: root-configs, config-packages, shared-package, db-package, api-app, web-ui
- CLAUDE.md replaced from bootstrap template to project-specific version
- packages/shared/src/utils/index.ts: `formatBRL` receives cents (number), not reais — be careful with price conversions
- Drizzle schema: `price` fields are `decimal(10,2)` stored as strings in Drizzle — need `.toString()` when inserting, `parseFloat()` when reading
- packages/db seed uses string values for decimal fields (e.g., `"250.00"` not `250`)
- Preferência desta sessão: usar wireframe fornecido pelo usuário como base visual e entregar arquivos HTML standalone em `assets/catalog-html/` (Tailwind/Lucide via CDN).
- Correção técnica: no zsh, para buscar valores monetários com `rg`, usar regex com aspas simples (`'R\$'`) para evitar problema de escaping do `$`.
- Preferência desta sessão: aplicar paleta/formatação visual do template Vantage e tipografia + efeitos de botão do `design_system5.html` nos catálogos HTML.

## Session 2026-03-20 — Wave 2 Implementation

- Drizzle `listActive()` retorna `price: string` (decimal column), mas `Service` interface no shared tem `price: number`. Ao tipar funções que recebem dados do Drizzle, usar o tipo inferido do Drizzle, não o tipo do shared.
- `c.req.param("id")` no Hono com TypeScript strict pode retornar `string | undefined` — usar `as string` quando rota garante o parâmetro.
- ESLint não configurado (falta eslint.config.js) — lint falha em todos os pacotes. Pré-existente, não causado pela Wave 2.
- LLM tool-calling loop: ao resubmeter mensagens com tool_calls, o assistant message precisa incluir `tool_calls` serializado e cada resultado como `role: "tool"` com `tool_call_id` matching.

## Session 2026-03-20 — Wave 3 Implementation

- vi.mock() paths in Vitest must be relative to the **test file** location, NOT the module under test. Common mistake: `vi.mock("../../config/env.js")` from `modules/x/__tests__/` should be `../../../config/env.js`.
- Modules that instantiate clients at module level (OpenAI in llm.ts, Zod env validation in env.ts, postgres in supabase.ts) cause test failures unless mocked with factory functions BEFORE imports.
- Drizzle `count()` and `max()` are exported from `drizzle-orm` directly (not a sub-path).
- `findById` with joins uses `db.select().from().leftJoin().where()` — the chain ends at `.where()` (resolves there). `listBookings` adds `.orderBy().limit().offset()` — mock chains need different terminal methods.
- Pre-existing lint issues fixed: unused `clients` import in payment.service.ts, unused `formatBRL` in sophia.tools.ts.
- packages/ui has no eslint setup (placeholder, Fase 3) — removed its lint script to prevent turbo failure.
