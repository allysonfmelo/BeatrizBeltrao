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

## Session 2026-03-20 — Waves 6 e 7 (Fase 3)

- `apps/web` deixou de ser placeholder e virou app Next.js 14 funcional com rotas de dashboard.
- Wave 6 implementada em `/dashboard/clientes` com busca por nome/telefone/email consumindo `GET /api/v1/clients`.
- Wave 7 implementada em `/dashboard/clientes/[id]` com histórico por cliente consumindo novo endpoint `GET /api/v1/clients/:id/bookings`.
- `client.service.list` agora calcula `meta.total` por query de contagem (antes retornava `data.length`).
- Novo fluxo backend em `client`:
  - controller `getClientBookings`
  - service `listBookingsByClient`
  - rota `/:id/bookings`
- Suíte de validação executada com sucesso:
  - `pnpm --filter @studio/api test` (98 testes)
  - `pnpm --filter @studio/api typecheck`
  - `pnpm --filter @studio/web typecheck`
  - `pnpm --filter @studio/web build`
- Ajuste de consistência final:
  - `tsconfig.json` da raiz alterado para `./packages/ts-config/base.json` (evita dependência de symlink `@studio/ts-config` no root `node_modules`).
- Observação de validação:
  - `turbo` pode mostrar warnings antigos quando um pacote está em cache (`cache hit, replaying logs`); para confirmar estado real, rodar o comando do pacote diretamente (`pnpm --filter @studio/shared test`).

## Session 2026-03-20 — Webhook ASAAS guidance

- Em macOS/zsh neste ambiente, `timeout` não está disponível por padrão (GNU coreutils). Para processos longos (ex.: `ngrok`), usar sessão TTY e interromper com `Ctrl+C`.
- Endpoint de webhook ASAAS já implementado em `POST /api/v1/webhook/asaas`; aceita token via header `asaas-access-token` ou query `?token=...`.

## Session 2026-03-21 — Dev boot checks

- `pnpm dev`: `@studio/web` sobe em `http://localhost:3000`, mas `@studio/api` falha no boot quando faltam env vars obrigatórias (`DATABASE_URL`, `OPENROUTER_API_KEY`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`).
- `pnpm trigger:dev` inicia o worker local (`Local worker ready -> 20260321.1`) mesmo exibindo warning de depreciação Node `[DEP0169] url.parse()`.
- Backend (`apps/api`) não carrega `.env` automaticamente: `env.ts` valida apenas `process.env`; sem `dotenv/config` ou `--env-file`, `pnpm dev` acusa variáveis obrigatórias ausentes.
- Em shell (`source .env`), qualquer secret iniciado por `$` sem aspas pode ser expandido para vazio. Caso observado: `ASAAS_API_KEY`.
- Correção aplicada: `apps/api/src/config/env.ts` agora carrega automaticamente o `.env` da raiz via `process.loadEnvFile(...)` antes do `safeParse`, resolvendo falha de boot do `pnpm dev` por env ausente.
- Em execução local de testes (`pnpm --filter @studio/api test`), ainda há falha preexistente em `webhook.service.test.ts` por conexão Redis (`MaxRetriesPerRequestError`), independente do ajuste de boot do `.env`.
- Correção do usuário: antes de assumir variáveis ausentes, validar primeiro o conteúdo do `.env` da raiz; neste projeto os valores estavam presentes e o problema era carregamento no runtime.
- Preferência do usuário (2026-03-21): para validação de atendimento, não usar mensagens simuladas via terminal/cURL; executar somente teste real enviando mensagens de celulares para o número WhatsApp integrado.
- Playwright CLI `fill` expõe o valor digitado no output do comando; nunca usar diretamente para secrets. Preferir inspeção sem preencher segredo ou inserir manualmente no browser.
- Diagnóstico real de integração WhatsApp (2026-03-21): Evolution estava enviando para `/api/v1/webhook/evolution/messages-upsert` (por `Webhook by Events=true`) e a API só aceitava `/api/v1/webhook/evolution`, resultando em 404 no ngrok e zero disparo do Trigger.
- Mitigação aplicada: webhook da instância ajustado para `Webhook by Events=false` e backend recebeu rota de compatibilidade `POST /api/v1/webhook/evolution/:event`.
- Falha real de resposta da Sophia (2026-03-21): webhook chegou com 200 e Trigger executou `process-whatsapp-message`, mas run falhou por `OPENROUTER_MODEL=openrouter/hunter-alpha` (modelo removido no OpenRouter, erro 404). Correção aplicada: `OPENROUTER_MODEL=anthropic/claude-sonnet-4` e restart de `pnpm dev` + `pnpm trigger:dev`.
- MCP Trigger bloqueado neste ambiente por token de formato incorreto (`TRIGGER_ACCESS_TOKEN` com prefixo `tr_` em vez de `tr_pat_`).
- 2026-03-24 (self): Repeti login no Sentry por abrir múltiplos `pwcli open --headed` em sessão padrão com contexto efêmero; correção: usar `pwcli --session sentry ...` e evitar reabrir navegador durante a configuração.
- 2026-03-24 (user correction): projeto Sentry `node_meloagency` é de outro sistema (UE n8n). Para Beatriz Beltrão, criar projeto Sentry novo do zero e configurar runtime para esse projeto dedicado.
- 2026-03-24 (self): `pwcli --session default open <url>` recriou browser (headless/in-memory) e perdeu login. Para sessões autenticadas, evitar `open`; navegar só com `click/go-back/go-forward` após snapshot.
- 2026-03-24 (self): Na criação de projeto do Sentry, o clique em `Create Project` pode abrir modal "Do you use a framework?"; enquanto o modal/backdrop estiver ativo, novos cliques falham. Fechar modal (`Close Modal`) ou usar `Configure SDK` para concluir e seguir.
- 2026-03-24 (self): no fluxo da Sophia, para evitar mensagens duplicadas no histórico, o envio de resposta deve registrar os chunks no `notification.service` e não salvar a resposta completa antes no `sophia.service`.
- 2026-03-24 (self): regex de validação de nome via `pushName` deve remover caracteres não-letras (emoji/símbolos) e exigir padrão `letras+espaços` com tamanho mínimo para não tratar payload inválido como nome.
- 2026-03-24 (self): `service-reference.yaml` precisa ser a fonte prioritária também no retorno de `list_services` (não apenas no prompt), para manter consistência de regras/preço/FAQ quando DB estiver vazio ou desatualizado.
- 2026-03-24 (self): para manter compliance da regra "nome do payload não persiste sem confirmação", `save_client_data` deve exigir nome completo válido antes de criar cliente novo no banco.

## Session 2026-04-10 — Sophia handoff + ambos/express/sequencial

- **Bug reportado**: IA "não está fazendo o check da agenda". Diagnóstico real ao ler DB prod (tabela `messages`): o Google Calendar está OK; o bug é a Sophia escolhendo `handoff_to_human` em vez de `check_availability` para perguntas de disponibilidade. Exemplo real em prod: cliente "Amanhã você tem disponibilidade de 15h?" → Sophia "A Beatriz já vai te atender". Evitar diagnosticar cegamente: antes de mexer em `google-calendar.ts`, sempre consultar tabela `messages`/`conversations` e ver o que a Sophia realmente respondeu.
- **Trigger.dev MCP `get_run_details` está quebrado** (retorna `Trace not found` para qualquer run em dev e prod). `list_runs` funciona. CLI `trigger.dev@4.4.3` não tem subcomando pra inspecionar runs. Fallback: ler `messages`/`conversations` direto da DB via script `apps/api/scripts/query-msgs.mts`.
- **Trigger worker NÃO inicializa Sentry**: `Sentry.init` só é chamado em `apps/api/src/main.ts`, não nos arquivos de `src/trigger/*`. Qualquer `captureException` dentro de uma task é no-op. TODO futuro: adicionar init de Sentry no entry point do worker.
- **Distinção Trigger env vars**: `TRIGGER_SECRET_KEY=tr_prod_...` é a chave de projeto (SDK dentro do app dispara tasks). `TRIGGER_ACCESS_TOKEN=tr_pat_...` é Personal Access Token (CLI + MCP). Não confundir.
- **Race condition em `syncReferenceServicesToDb`** (main.ts:34): roda na boot e faz `findFirst`+`insert` não-atômicos. Se o dev server tiver hot-reload ativo e várias instâncias boot em sequência, cria duplicatas por nome. Limpei as duplicatas com `scripts/dedupe-ambos-services.mts` + `scripts/purge-duplicate-services.mts`. Mitigação definitiva: adicionar UNIQUE constraint em `services.name` via migration.
- **Regra de precificação (cliente)**: NUNCA informar soma de valores na conversa com a cliente. Sempre mostrar valores individuais (Maquiagem R$ 240 / Penteado R$ 190 separados). O único valor total permitido é o bloco técnico de "Sinal (30%)" no pré-agendamento. Regra aplicada no prompt (seção `REGRA DE PREÇOS`) e no `executeCreateBooking` (bloco itemizado quando `service.type === "combo"`).
- **Vocabulário proibido**: palavra "combo" não deve aparecer em mensagens da Sophia. Usar "ambos", "os dois serviços", "maquiagem e penteado juntos". Novos serviços bookable: `ambos_express` (60min) e `ambos_sequencial` (120min), preço R$ 430 cada (usado internamente para cálculo de sinal).
- **Teste E2E via harness**: `apps/api/scripts/test-sophia-e2e.mts` sobe um mock HTTP na porta 4999, aponta `EVOLUTION_API_URL` pra ele, e dirige conversa scriptada. Não pode fazer monkey-patch de funções exportadas (`calculateTypingDelay`) porque ESM módulos são frozen. Testes demoram ~60s por causa do delay de digitação. Não chama Evolution real.
- **Testes pré-existentes quebrados** (commit 7fa93b9, não causados por mim):
  - `send_service_pdf` tests (4) — tool foi substituído por `send_website_link`
  - `booking.service > createPreBooking` (4) — mock setup problemático
  - `notification.service > sendSophiaMessage` (2) — mock de chunks

## Session 2026-03-25 — Sophia Rules & Triage

- Preferência do usuário sobre comportamento da Sophia:
  - MÁXIMO de 3 mensagens subsequentes enviadas em sequência.
  - Evitar envio direto de valores/preços já na primeira interação.
  - Fazer **triagem inicial** (entender o que a cliente busca) antes de despejar a lista de serviços.
  - Sempre ofertar PRIMEIRO o PDF informativo do tema desejado, e só informar valores extras se a cliente recusar ou pedir diretamente.
  - Tudo documentado na sessão `## REGRAS DE CONVERSA E TRIAGEM` de `sophia.prompt.ts`.
