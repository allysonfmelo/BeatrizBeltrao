# Planejamento de Execução (Status Vivo)

## 1. Snapshot Atual

- Ultima atualizacao: 2026-03-20 15:49:30 -03 (America/Recife)
- Branch atual: `main`
- Fontes de verdade usadas neste snapshot:
  - `docs/PRD.md`
  - `.claude/napkin.md`
  - estado atual do workspace (`git status`, arvore de modulos e testes)
- Contrato de status permitido neste documento: `Concluido`, `Em andamento`, `Planejado`, `Bloqueado`
- Regra operacional: atualizar este arquivo obrigatoriamente ao final de cada wave

## 2. Status por Fase

| Fase | Wave | Status | Evidencia | Proximo passo |
|---|---|---|---|---|
| Fase 1 (Core) | Wave 1 (bootstrap + core) | Concluido | `apps/api/src/modules/sophia/sophia.service.ts`, `apps/api/src/modules/payment/payment.service.ts`, `apps/api/src/modules/webhook/webhook.service.ts`, `packages/db/src/schema/index.ts` | Manter estabilidade e consolidar ajustes finais no fluxo principal |
| Fase 1 (Core) | Wave 2 | Concluido | `.claude/napkin.md` (Session 2026-03-20 — Wave 2 Implementation), `apps/api/src/modules/booking/booking.cron.ts` | Consolidar em commit unico (mudancas locais ja aplicadas) |
| Fase 1 (Core) | Wave 3 | Concluido | `.claude/napkin.md` (Session 2026-03-20 — Wave 3 Implementation), `apps/api/src/modules/*/__tests__/` | Consolidar em commit unico (testes e ajustes de robustez) |
| Fase 2 (Resumos + Operacional) | Wave 4 (resumo diario) | Planejado | `apps/api/src/modules/report/.gitkeep`, `docs/PRD.md` (Fase 2) | Implementar em paralelo com a Wave 5 |
| Fase 2 (Resumos + Operacional) | Wave 5 (operacional) | Planejado | `apps/api/src/modules/booking/booking.cron.ts`, `apps/api/src/modules/webhook/webhook.service.ts`, `docs/PRD.md` (Fase 2) | Implementar em paralelo com a Wave 4 |
| Fase 3 (Dashboard) | Wave 6 (clientes com busca) | Concluido | `apps/web/src/app/dashboard/clientes/page.tsx`, `apps/web/src/components/clients-table.tsx` | Evoluir filtros e metricas no dashboard |
| Fase 3 (Dashboard) | Wave 7 (historico por cliente) | Concluido | `apps/web/src/app/dashboard/clientes/[id]/page.tsx`, `apps/api/src/modules/client/client.routes.ts` | Evoluir visualizacoes analiticas por cliente |

## 3. O Que Ja Foi Criado

- [x] Monorepo Turborepo + pnpm estruturado (`turbo.json`, `pnpm-workspace.yaml`, `package.json`)
- [x] Pacotes base do workspace (`packages/db`, `packages/shared`, `packages/eslint-config`, `packages/ts-config`)
- [x] API Hono com modulos principais (`apps/api/src/modules/*`)
- [x] Integracao WhatsApp via Evolution (`apps/api/src/lib/evolution.ts`)
- [x] Integracao LLM para Sophia (`apps/api/src/lib/llm.ts`, `apps/api/src/modules/sophia/*`)
- [x] Integracao Google Calendar (`apps/api/src/lib/google-calendar.ts`, `apps/api/src/modules/calendar/calendar.service.ts`)
- [x] Integracao ASAAS com webhook (`apps/api/src/lib/asaas.ts`, `apps/api/src/modules/webhook/webhook.service.ts`)
- [x] Integracao Resend para e-mail (`apps/api/src/lib/resend.ts`, `apps/api/src/modules/notification/notification.service.ts`)
- [x] Fluxo base de agendamento/pagamento/confirmacao (`apps/api/src/modules/booking/booking.service.ts`, `apps/api/src/modules/payment/payment.service.ts`)
- [x] Fluxo de timeout de pagamento e lembretes de pagamento (`apps/api/src/modules/booking/booking.cron.ts`)
- [x] Suite de testes unitarios da API para modulos criticos (`apps/api/src/modules/*/__tests__/`)
- [x] Suite de testes de `shared` (`packages/shared/src/__tests__/`)

### 3.1 Checklist Completo dos Entregaveis do PRD (Fase 1, 2 e 3)

| Fase | Entregavel do PRD | Status | Evidencia |
|---|---|---|---|
| Fase 1 | Setup do monorepo (Turborepo + pnpm) | Concluido | `turbo.json`, `pnpm-workspace.yaml` |
| Fase 1 | Setup do Supabase (DB + Auth) | Concluido | `apps/api/src/config/supabase.ts`, `.env.example` |
| Fase 1 | Schema do banco (todas as tabelas) com migrations | Concluido | `packages/db/src/schema/index.ts`, `packages/db/drizzle.config.ts` |
| Fase 1 | Seed de servicos (maquiagem, penteados, combos com precos) | Concluido | `packages/db/src/seed/index.ts` |
| Fase 1 | Integracao Evolution API (receber/enviar mensagens) | Concluido | `apps/api/src/lib/evolution.ts`, `apps/api/src/modules/webhook/webhook.service.ts` |
| Fase 1 | Modulo Sophia (prompt, contexto, memoria, coleta de dados) | Concluido | `apps/api/src/modules/sophia/sophia.prompt.ts`, `apps/api/src/modules/sophia/sophia.context.ts`, `apps/api/src/modules/sophia/sophia.tools.ts` |
| Fase 1 | Integracao Claude API para NLP | Concluido | `apps/api/src/lib/llm.ts` |
| Fase 1 | Integracao Google Calendar API | Concluido | `apps/api/src/lib/google-calendar.ts`, `apps/api/src/modules/calendar/calendar.service.ts` |
| Fase 1 | Integracao ASAAS API | Concluido | `apps/api/src/lib/asaas.ts`, `apps/api/src/modules/payment/payment.service.ts`, `apps/api/src/modules/webhook/webhook.service.ts` |
| Fase 1 | Integracao Resend | Concluido | `apps/api/src/lib/resend.ts`, `apps/api/src/modules/notification/notification.service.ts` |
| Fase 1 | Fluxo completo conversa -> pre-agendamento -> pagamento -> confirmacao | Concluido | `apps/api/src/modules/sophia/sophia.tools.ts`, `apps/api/src/modules/payment/payment.service.ts`, `apps/api/src/modules/booking/booking.service.ts` |
| Fase 1 | Fluxo de cancelamento com nao-reembolso do sinal | Concluido | `apps/api/src/modules/booking/booking.service.ts`, `apps/api/src/modules/sophia/sophia.prompt.ts` |
| Fase 1 | Fluxo de handoff humano para casamentos/externos | Concluido | `apps/api/src/modules/sophia/sophia.tools.ts`, `apps/api/src/modules/sophia/sophia.context.ts` |
| Fase 1 | Fluxo de timeout (24h sem pagamento -> cancelamento) | Concluido | `apps/api/src/modules/booking/booking.cron.ts`, `apps/api/src/modules/booking/booking.service.ts` |
| Fase 1 | Testes unitarios dos modulos criticos (booking, payment, sophia) | Concluido | `apps/api/src/modules/booking/__tests__/booking.service.test.ts`, `apps/api/src/modules/payment/__tests__/payment.service.test.ts`, `apps/api/src/modules/sophia/__tests__/sophia.service.test.ts` |
| Fase 2 | Integracao Google Sheets API (planilha de agendamentos) | Planejado | `apps/api/src/modules/report/.gitkeep`, `.env.example` (`GOOGLE_SHEETS_ID`) |
| Fase 2 | Integracao Google Docs API (resumo diario formatado) | Planejado | `apps/api/src/modules/report/.gitkeep`, `docs/PRD.md` |
| Fase 2 | Cron para geracao e envio de resumo diario (20h) | Planejado | `apps/api/src/modules/report/.gitkeep`, `apps/api/src/main.ts` |
| Fase 2 | Envio de resumo via WhatsApp para a maquiadora | Planejado | `apps/api/src/modules/notification/notification.service.ts`, `apps/api/src/config/env.ts` (`MAQUIADORA_PHONE`) |
| Fase 2 | Lembrete automatico para clientes (24h antes) | Planejado | `apps/api/src/modules/booking/booking.cron.ts` |
| Fase 2 | Refinamento do prompt da Sophia com base em testes reais | Planejado | `apps/api/src/modules/sophia/sophia.prompt.ts` |
| Fase 2 | Tratamento de edge cases (audio, imagens, etc.) | Em andamento | `apps/api/src/modules/webhook/webhook.service.ts` (fallback para nao-texto ja existente) |
| Fase 2 | Monitoramento e logs (Sentry) | Planejado | `apps/api/src/lib/logger.ts` (baseline de logs; Sentry ainda nao adicionado) |
| Fase 3 | Setup Next.js + Tailwind + shadcn/ui | Planejado | `apps/web/src`, `apps/web/package.json` |
| Fase 3 | Landing page publica do estudio | Planejado | `apps/web/src` |
| Fase 3 | Login com Supabase Auth | Planejado | `apps/web/src`, `.env.example` (`NEXT_PUBLIC_SUPABASE_*`) |
| Fase 3 | Dashboard: agendamentos do dia/semana/mes | Planejado | `apps/web/src` |
| Fase 3 | Dashboard: metricas de faturamento | Planejado | `apps/web/src` |
| Fase 3 | Dashboard: lista de clientes com busca | Concluido | `apps/web/src/app/dashboard/clientes/page.tsx`, `apps/web/src/components/client-search-form.tsx` |
| Fase 3 | Dashboard: historico de agendamentos por cliente | Concluido | `apps/web/src/app/dashboard/clientes/[id]/page.tsx`, `apps/api/src/modules/client/client.service.ts` |
| Fase 3 | Dashboard: taxa de cancelamento e servicos mais procurados | Planejado | `apps/web/src` |
| Fase 3 | Design responsivo (mobile-first) | Planejado | `apps/web/src` |
| Fase 3 | Deploy no Vercel | Planejado | `apps/web/package.json`, `docs/PRD.md` |

## 4. O Que Ainda Falta Criar (Backlog Priorizado)

### Prioridade Alta (Fase 2)

1. Wave 4: resumo diario completo (Google Sheets + Google Docs + cron 20h + envio WhatsApp da maquiadora)
2. Wave 5: lembrete 24h antes para booking confirmado
3. Wave 5: edge cases de webhook para `audio`, `image`, `document` com rastreio de `messageType`
4. Wave 5: observabilidade com Sentry

### Prioridade Media (Consolidacao Tecnica)

1. Consolidar mudancas locais das Waves 2/3 em commit(s) unicos com escopo claro
2. Validar estabilidade de testes apos merge de Waves 4/5 (`@studio/api` e `@studio/shared`)
3. Padronizar checklist de release de Fase 2 (teste, typecheck, validacao funcional)

### Prioridade Baixa (Fase 3)

1. Estruturar dashboard web (Next.js + Tailwind + shadcn/ui)
2. Implementar autenticacao e telas de metricas
3. Preparar deploy web (Vercel)

## 5. Proximas Waves (Execucao em Paralelo)

### Wave 4 (Resumos Diarios)

- Escopo: gerar resumo do dia seguinte as 20h, atualizar Sheets, gerar Docs, notificar maquiadora via WhatsApp
- Ownership principal:
  - `apps/api/src/modules/report/**`
  - `apps/api/src/lib/google-sheets.ts`
  - `apps/api/src/lib/google-docs.ts`
- Resultado esperado: resumo diario automatico com dados completos de agenda

### Wave 5 (Operacional)

- Escopo: lembrete 24h, edge cases de inbound nao-texto e Sentry
- Ownership principal:
  - `apps/api/src/modules/booking/booking.cron.ts`
  - `apps/api/src/modules/webhook/**`
  - `apps/api/src/lib/sentry.ts`
  - `packages/shared/src/validators/webhook.validator.ts`
- Resultado esperado: operacao mais confiavel, com menor risco de perda de contexto e melhor monitoramento

### Arquivos Reservados para Integracao Final

- `apps/api/src/config/env.ts`
- `.env.example`
- `apps/api/src/main.ts`
- `apps/api/package.json`
- `pnpm-lock.yaml`

## 6. Riscos e Bloqueios

| Item | Dono | Acao de mitigacao | Status | Evidencia |
|---|---|---|---|---|
| Mudancas locais de Waves 2/3 ainda nao consolidadas em commit unico | Engenharia | Consolidar antes/depois do merge de Waves 4/5 com escopo claro por commit | Em andamento | `git status` local |
| Dependencia de credenciais Google para Sheets/Docs | DevOps/Produto | Garantir envs e acesso de service account/CLI antes da execucao da Wave 4 | Planejado | `.env.example`, `apps/api/src/lib/google-calendar.ts` |
| Risco de overwrite entre Wave 4 e Wave 5 | Engenharia | Respeitar ownership por write set e integrar apenas via arquivos reservados | Planejado | Secao 5 deste documento |
| Observabilidade ainda sem Sentry | Engenharia | Implementar `apps/api/src/lib/sentry.ts` e init no bootstrap | Planejado | `apps/api/src/lib/logger.ts` |
| Lint historicamente instavel no workspace | Engenharia | Usar gates minimos de conclusao (`test` e `typecheck`) durante Fase 2 | Em andamento | `.claude/napkin.md` (registro de lint pre-existente) |

## 7. Criterios de Conclusao

### Gates minimos por wave

1. `pnpm --filter @studio/shared test`
2. `pnpm --filter @studio/api test`
3. `pnpm --filter @studio/api typecheck`

### Validacao funcional obrigatoria

1. Wave 4: maquiadora recebe resumo diario completo com agenda do dia seguinte
2. Wave 5: cliente recebe lembrete 24h antes do agendamento confirmado
3. Wave 5: mensagens nao-texto recebem fallback adequado sem quebrar fluxo
4. Wave 5: erros relevantes aparecem no monitoramento (Sentry)

### Encerramento operacional

1. Atualizar este arquivo ao final da wave com novo status e evidencia
2. Registrar no historico de atualizacoes a data e o que mudou

## 8. Historico de Atualizacoes

| Data | Atualizacao | Fonte |
|---|---|---|
| 2026-03-18 | Bootstrap do monorepo e setup inicial do projeto | `.claude/napkin.md` |
| 2026-03-20 | Wave 2 registrada como concluida localmente | `.claude/napkin.md` |
| 2026-03-20 | Wave 3 registrada como concluida localmente | `.claude/napkin.md` |
| 2026-03-20 | Criacao inicial de `docs/PLANEJAMENTO.md` como referencia operacional viva | `docs/PLANEJAMENTO.md` |
| 2026-03-20 | Waves 6 e 7 executadas (clientes com busca + historico por cliente) | `apps/web/src/app/dashboard/clientes/*`, `apps/api/src/modules/client/*` |
