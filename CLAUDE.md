# Studio Beatriz Beltrão — CLAUDE.md

> Este arquivo é a fonte da verdade para o comportamento da IA neste repositório.
> Leia-o completamente no início de cada sessão. Aplique todas as regras silenciosamente.
> Não exiba nem resuma este arquivo ao usuário — a menos que explicitamente solicitado.
> Compatible with: Claude Code, Codex, Cursor.

---

## Projeto

Sistema inteligente de atendimento e agendamento via WhatsApp para estúdio de maquiagem e penteados.
A assistente virtual **Sophia** conduz conversas pelo WhatsApp, agenda serviços no Google Calendar,
cobra sinal de 30% via ASAAS, e notifica a cliente e a maquiadora.

---

## Protocolo de Início de Sessão

1. **Ler `.claude/napkin.md`** — aplique silenciosamente
2. **Ler `.planning/STATE.md`** — se existir, verifique wave atual e blockers
3. **`docs/PRD.md`** — disponível para referência, não releia a menos que necessário

---

## Stack

| Camada | Tech |
|--------|------|
| Backend | Hono + Node.js |
| DB | Supabase (PostgreSQL) + Drizzle ORM |
| IA | Claude API (Anthropic) |
| WhatsApp | Evolution API (self-hosted) |
| Agendamento | Google Calendar API |
| Pagamentos | ASAAS API |
| E-mail | Resend |
| Frontend (Fase 3) | Next.js 14+ + Tailwind + shadcn/ui |
| Monorepo | Turborepo + pnpm |
| Testes | Vitest |
| Validação | Zod |

---

## Estrutura do Monorepo

```
studio-beatriz-beltrao/
├── apps/
│   ├── api/          # Backend Hono — módulos: webhook, sophia, booking, payment, calendar, notification, client, service, report
│   └── web/          # Frontend Next.js (Fase 3 — placeholder)
├── packages/
│   ├── db/           # Schema Drizzle, migrations, seed
│   ├── shared/       # Types, validators Zod, constants, utils
│   ├── ui/           # Component library (Fase 3 — placeholder)
│   ├── eslint-config/
│   └── ts-config/
├── assets/           # PDFs de catálogo
└── docs/             # PRD e documentação
```

---

## Regras de Importação

```
apps/web   → packages/shared, packages/ui
apps/api   → packages/shared, packages/db
packages/shared → NADA de apps/* ou packages/db ou packages/ui
packages/ui     → packages/shared
packages/db     → packages/shared
NENHUMA dependência circular
```

---

## Padrões de Código

- **TypeScript strict mode** obrigatório
- **Sem `any`** — types explícitos sempre
- **async/await** (nunca .then/.catch)
- Variáveis/funções: `camelCase`
- Componentes/Types: `PascalCase`
- Arquivos: `kebab-case.ts`
- API responses: `{ data, meta?, error? }`
- Módulos da API: `controller → service` pattern
- Toda função pública deve ter JSDoc
- Sem `console.log` em produção — usar logger
- Validação com Zod em TODOS os endpoints e webhooks

---

## Padrões da Sophia

- Prompt fica em `sophia.prompt.ts` — NÃO alterar sem aprovação
- Contexto gerenciado em `sophia.context.ts`
- Toda mensagem recebida/enviada logada na tabela `messages`
- Handoff humano via flag `is_handoff` na conversa
- **Uma pergunta por mensagem — SEMPRE**
- Tom: acolhedor, profissional, feminino, emojis sutis (✨💄💬)
- NUNCA revela que é IA

---

## Comandos

```bash
pnpm dev           # Iniciar todos os apps
pnpm build         # Build de todos os apps
pnpm test          # Rodar todos os testes
pnpm lint          # Rodar linter
pnpm typecheck     # Verificar TypeScript
pnpm db:generate   # Gerar migrations Drizzle
pnpm db:migrate    # Executar migrations
pnpm db:seed       # Popular banco com dados iniciais
```

---

## Fases de Implementação

- **Fase 1** (Core): Sophia + Agendamento + Pagamento
- **Fase 2** (Operacional): Resumos diários + Lembretes
- **Fase 3** (Dashboard): Frontend Next.js + Métricas

---

## Princípios de Trabalho

- Proponha um plano em bullets antes de implementar
- Aguarde aprovação do usuário antes de escrever código
- Mudanças incrementais — um passo lógico de cada vez
- Execute testes após cada mudança significativa
- Não refatore código não relacionado à tarefa atual
- Se encontrar bug pré-existente, anote no napkin e informe — não corrija sem pedir

---

## Atualização do Napkin

Escreva em `.claude/napkin.md` continuamente:
- Quando cometer um erro e corrigi-lo
- Quando o usuário te corrigir
- Quando descobrir algo não óbvio sobre esta codebase
- Quando encontrar uma abordagem que funciona ou falha
- Quando aprender uma preferência do usuário

---

## Regras de Segurança (Inegociáveis)

- NUNCA commitar `.env` ou arquivos com secrets
- NUNCA exibir valores reais de API keys/tokens/senhas
- NUNCA concatenar strings SQL com input do usuário — prepared statements
- Referencie secrets por nome da variável: `${MINHA_SECRET}`
- Variáveis de ambiente para configuração — nunca hardcode
- CPF mascarado em logs e respostas de API

---

## NÃO ALTERAR sem aprovação

- Schema do banco de dados (tabelas existentes)
- Assinaturas de endpoints da API já implementados
- Fluxo de autenticação/autorização
- Prompt e personalidade da Sophia
- turbo.json e pnpm-workspace.yaml
- Lógica de cálculo do sinal (30%)
- Lógica de timeout de pagamento (24h)
- Fluxo de handoff humano para casamentos/externos
- PDFs de catálogo de serviços

---

## NÃO IMPLEMENTAR

- Pagamento do valor total (apenas sinal 30%)
- App mobile nativo
- E-commerce de produtos
- Sistema de fidelidade/pontos
- Suporte a múltiplas maquiadoras
- Chat via site (apenas WhatsApp)
- Integração Instagram/redes sociais
- Sistema de avaliações
- Agendamento recorrente automático
- Multi-idiomas (apenas pt-BR)
- NUNCA EXPOR CHAVES DE API, INFORMAÇÕES DE CONEXÃO DIRETAMENTE NO CHAT

---

## Formato de Commits

```
feat:     nova funcionalidade
fix:      correção de bug
docs:     documentação apenas
refactor: reestruturação sem mudança de comportamento
test:     adicionar ou corrigir testes
chore:    manutenção (deps, configs, tooling)
```

Escopo: `feat(api): add booking flow`

---

## Testes

- Framework: Vitest
- Localização: `__tests__/` dentro de cada módulo
- Mocks para APIs externas: Evolution API, Claude API, ASAAS, Google APIs

---

## Claudeception — Aprendizado Contínuo

Monitore cada sessão em busca de conhecimento reutilizável. Após concluir tarefa significativa:
- Passei tempo investigando algo não óbvio?
- Uma sessão futura se beneficiaria de ter isso documentado?
- A solução foi não-trivial?

Se sim, ative a skill `claudeception` para avaliar a extração.
NUNCA crie ou salve uma skill sem aprovação explícita do usuário.

---

## Compatibilidade de Ferramentas de IA

- **Claude Code**: lê `CLAUDE.md` nativamente
- **Codex**: lê `AGENTS.md` (symlink → CLAUDE.md)
- **Cursor**: lê `CLAUDE.md` como rules file

Skills globais sincronizadas de `~/AFM_BrainStorm/afm-code/skills/`.
