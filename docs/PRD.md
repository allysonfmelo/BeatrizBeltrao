# PRD — Studio Beatriz Beltrão

> Versão: 1.0 | Data: 2026-03-17 | Status: Draft
> Autor: Claude (PRD Builder) | Última atualização: 2026-03-17

---

## 1. Resumo Executivo

O **Studio Beatriz Beltrão** é um sistema inteligente de atendimento e agendamento para um estúdio de maquiagem e penteados. O sistema utiliza uma assistente virtual chamada **Sophia**, integrada ao WhatsApp via Evolution API, que conduz o atendimento completo ao cliente — desde o esclarecimento de dúvidas até a coleta de dados, agendamento, cobrança de sinal (30% via ASAAS) e confirmação automática. A agenda é gerenciada via Google Calendar, com resumos diários enviados à maquiadora via Google Sheets/Docs. O MVP prioriza velocidade de lançamento, automação máxima para serviços de estúdio e handoff humano apenas para casamentos e serviços externos.

---

## 2. Contexto Estratégico

### Problema
A maquiadora gerencia manualmente todos os agendamentos, orçamentos e dúvidas via WhatsApp pessoal. Isso consome tempo, gera esquecimentos, causa conflitos de horário, dificulta o controle financeiro e não fornece nenhuma visão de métricas do negócio (faturamento, clientes atendidos, taxa de cancelamento, etc.).

### Oportunidade
O mercado de beleza no Brasil é um dos maiores do mundo. Profissionais autônomos e pequenos estúdios sofrem com a falta de ferramentas acessíveis e integradas ao WhatsApp — canal onde 99% das conversas com clientes acontecem. Automatizar o atendimento e agendamento nesse canal reduz drasticamente o tempo operacional e aumenta a conversão de consultas em agendamentos confirmados.

### Diferenciais
- **Atendimento onde a cliente já está** — WhatsApp, sem necessidade de baixar apps ou acessar sites
- **Sophia, a assistente IA** — conduz conversas naturais, acolhedoras e eficientes, sem parecer robótica
- **Cobrança automática de sinal** — elimina no-shows e garante comprometimento da cliente
- **Integração nativa com Google Workspace** — Calendar, Sheets e Docs já fazem parte do fluxo da maquiadora
- **Human-in-the-loop inteligente** — automação total para serviços de estúdio, toque humano apenas onde realmente importa (casamentos/eventos externos)

---

## 3. Personas e Público-Alvo

```
PERSONA: Beatriz, 30 anos, Maquiadora profissional / Dona do estúdio
- DOR: Perde horas por dia respondendo WhatsApp, organizando agenda manual, e não tem visão clara do faturamento mensal
- OBJETIVO: Automatizar atendimento e agendamento para focar no que faz de melhor — maquiar
- CENÁRIO DE USO: Recebe notificações de novos agendamentos confirmados, consulta agenda no Google Calendar, recebe resumo diário via Sheets/Docs, intervém manualmente apenas em serviços especiais
- NÍVEL TÉCNICO: Baixo a Médio
```

```
PERSONA: Camila, 25 anos, Cliente do estúdio
- DOR: Quer agendar maquiagem para uma festa de forma rápida e prática, sem ficar esperando resposta manual
- OBJETIVO: Agendar serviço de maquiagem/penteado, saber preços, escolher horário e confirmar com pagamento
- CENÁRIO DE USO: Envia mensagem no WhatsApp do estúdio, conversa com Sophia, escolhe serviço/data/hora, paga sinal via Pix/crédito/débito, recebe confirmação por WhatsApp e e-mail
- NÍVEL TÉCNICO: Baixo
```

```
PERSONA: Juliana, 28 anos, Noiva
- DOR: Precisa de orçamento personalizado para maquiagem e penteado do casamento, com atendimento externo
- OBJETIVO: Receber atendimento personalizado com preço diferenciado para evento especial
- CENÁRIO DE USO: Conversa com Sophia, bot identifica que é casamento/serviço externo, faz handoff para Beatriz que negocia diretamente e define o valor
- NÍVEL TÉCNICO: Baixo
```

---

## 4. Funcionalidades e User Stories

### 4.1 Feature: Chatbot Sophia (WhatsApp)
**Prioridade:** Must-Have
**Fase:** 1

```
USER STORY: Como cliente, quero conversar pelo WhatsApp e ser atendida por Sophia para que eu possa tirar dúvidas e agendar serviços de forma rápida e natural.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sophia responde mensagens recebidas via Evolution API webhook
- [ ] Sophia se apresenta com tom acolhedor, leve e profissional
- [ ] Sophia utiliza emojis sutis (✨💄💬) sem excesso
- [ ] Sophia faz apenas UMA pergunta por mensagem
- [ ] Sophia NUNCA revela que é uma inteligência artificial
- [ ] Sophia mantém contexto e memória do histórico da conversa
- [ ] Sophia não repete perguntas cujas respostas já foram fornecidas

RESTRIÇÕES TÉCNICAS:
- Integração via Evolution API (self-hosted) com webhooks
- IA powered by Claude API (Anthropic)
- Contexto da conversa armazenado no Supabase
- PDFs de serviços (maquiagem e penteados) carregados como knowledge base
```

```
USER STORY: Como cliente, quero que Sophia me apresente os serviços disponíveis e seus preços para que eu possa escolher o que desejo.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sophia identifica a intenção de consulta de serviços
- [ ] Sophia apresenta opções: maquiagem, penteado ou ambos
- [ ] Sophia informa preços baseados nos PDFs de catálogo
- [ ] Sophia diferencia serviços de estúdio (preço fixo) vs. externos/casamentos (sob consulta)

RESTRIÇÕES TÉCNICAS:
- Catálogo extraído de 2 PDFs (maquiagem + penteados) armazenados no sistema
- Preços devem ser configuráveis sem alterar código
```

```
USER STORY: Como cliente, quero que Sophia identifique quando meu serviço é de casamento ou externo para que eu seja atendida diretamente pela maquiadora.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sophia detecta palavras-chave ou contexto de casamento/evento externo
- [ ] Sophia informa a cliente que a maquiadora assumirá o atendimento
- [ ] Sistema notifica a maquiadora via WhatsApp com resumo da conversa
- [ ] Maquiadora pode assumir a conversa diretamente
- [ ] Após acordo de preço, fluxo de cobrança ASAAS é retomado normalmente

RESTRIÇÕES TÉCNICAS:
- Flag de handoff no registro da conversa
- Notificação push para número da maquiadora
```

### 4.2 Feature: Coleta de Dados do Cliente
**Prioridade:** Must-Have
**Fase:** 1

```
USER STORY: Como Sophia, preciso coletar todos os dados obrigatórios da cliente para que o agendamento seja processado corretamente.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sophia coleta: nome completo, telefone, CPF, e-mail, tipo de serviço, data desejada, horário desejado
- [ ] Cada dado é solicitado individualmente (uma pergunta por mensagem)
- [ ] Sophia valida formato do CPF (11 dígitos)
- [ ] Sophia valida formato do e-mail
- [ ] Sophia valida que a data não é passada
- [ ] Sophia valida que o horário está entre 5h e 22h
- [ ] Se algum dado já foi fornecido no histórico, Sophia NÃO repete a pergunta
- [ ] Sophia confirma todos os dados com a cliente antes de prosseguir

RESTRIÇÕES TÉCNICAS:
- Validação via Zod schemas no backend
- Dados persistidos no Supabase vinculados à conversa
```

### 4.3 Feature: Agendamento com Google Calendar
**Prioridade:** Must-Have
**Fase:** 1

```
USER STORY: Como cliente, quero escolher uma data e horário disponíveis para que meu serviço seja agendado.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sophia consulta disponibilidade no Google Calendar antes de oferecer horários
- [ ] Sophia apresenta horários livres para a data escolhida
- [ ] Sophia não permite agendamento em horários já ocupados
- [ ] Sophia não permite agendamento fora do horário de funcionamento (5h-22h)
- [ ] Ao confirmar, um PRÉ-AGENDAMENTO é criado com status "pendente"
- [ ] Evento no Google Calendar é criado apenas APÓS confirmação de pagamento

RESTRIÇÕES TÉCNICAS:
- Google Calendar API via Google Workspace
- Considerar duração padrão por tipo de serviço ao verificar disponibilidade
- Bloqueio otimista de horário durante o pré-agendamento (24h)
```

### 4.4 Feature: Cobrança de Sinal via ASAAS
**Prioridade:** Must-Have
**Fase:** 1

```
USER STORY: Como cliente, após escolher serviço/data/hora, quero receber um link de pagamento do sinal (30%) para que eu possa confirmar meu agendamento.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sistema calcula 30% do valor do serviço selecionado
- [ ] Sistema cria cobrança no ASAAS com métodos: Pix, Crédito e Débito
- [ ] Link de pagamento é enviado à cliente via WhatsApp (por Sophia)
- [ ] Cliente tem 24 horas para efetuar o pagamento
- [ ] Se não pagar em 24h, pré-agendamento é cancelado automaticamente e horário é liberado
- [ ] Sophia notifica a cliente sobre o cancelamento por timeout

RESTRIÇÕES TÉCNICAS:
- ASAAS API para criação de cobranças
- Webhook ASAAS para confirmação de pagamento
- Job/cron para verificar timeouts de 24h
- Valor do sinal calculado dinamicamente sobre o preço do serviço
```

```
USER STORY: Como sistema, ao receber confirmação de pagamento do ASAAS, devo confirmar o agendamento e notificar a cliente.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Webhook ASAAS recebido e validado (assinatura)
- [ ] Status do agendamento muda de "pendente" para "confirmado"
- [ ] Evento criado no Google Calendar com detalhes do serviço
- [ ] Confirmação enviada via WhatsApp (Sophia) com: data, horário, tipo de serviço, valor total, valor do sinal pago
- [ ] Confirmação enviada via e-mail com as mesmas informações
- [ ] Registro de pagamento persistido no banco

RESTRIÇÕES TÉCNICAS:
- Endpoint webhook com validação de assinatura ASAAS
- Template de mensagem WhatsApp para confirmação
- Template de e-mail para confirmação (Resend)
```

### 4.5 Feature: Cancelamento e Remarcação
**Prioridade:** Must-Have
**Fase:** 1

```
USER STORY: Como cliente, quero poder cancelar meu agendamento confirmado, ciente de que o sinal de 30% não será devolvido.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sophia identifica intenção de cancelamento
- [ ] Sophia informa que o sinal de 30% NÃO é reembolsável
- [ ] Sophia pede confirmação explícita do cancelamento
- [ ] Ao confirmar: status muda para "cancelado", evento removido do Google Calendar, horário liberado
- [ ] Cliente recebe confirmação de cancelamento via WhatsApp

RESTRIÇÕES TÉCNICAS:
- Soft delete no agendamento (manter histórico)
- Google Calendar API para remoção do evento
```

```
USER STORY: Como cliente, quero poder remarcar meu agendamento para outra data/hora, sendo atendida pela maquiadora.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sophia identifica intenção de remarcação
- [ ] Sophia realiza handoff humano para a maquiadora
- [ ] Maquiadora negocia nova data/hora diretamente com a cliente
- [ ] Após acordo, sistema atualiza agendamento e evento no Calendar
- [ ] Cliente recebe confirmação da remarcação via WhatsApp e e-mail

RESTRIÇÕES TÉCNICAS:
- Handoff humano com contexto completo da conversa
- Atualização do evento existente no Google Calendar (não criar novo)
```

### 4.6 Feature: Resumo Diário para Maquiadora
**Prioridade:** Should-Have
**Fase:** 2

```
USER STORY: Como maquiadora, quero receber diariamente um resumo dos agendamentos do dia seguinte para que eu possa me preparar.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Sistema gera resumo diário às 20h (configurável)
- [ ] Resumo inclui: lista de clientes do dia seguinte, horários, serviços, valores
- [ ] Resumo enviado via Google Sheets (planilha atualizada) e/ou Google Docs
- [ ] Resumo também enviado via WhatsApp para a maquiadora

RESTRIÇÕES TÉCNICAS:
- Google Sheets API para atualização de planilha
- Google Docs API para geração de documento
- Cron job para disparo diário
```

### 4.7 Feature: Dashboard de Métricas
**Prioridade:** Could-Have
**Fase:** 3

```
USER STORY: Como maquiadora, quero acessar um painel web com métricas do meu negócio para que eu possa acompanhar faturamento, clientes e desempenho.

CRITÉRIOS DE ACEITAÇÃO:
- [ ] Dashboard mostra: total de agendamentos no mês, faturamento bruto, faturamento líquido (sinais recebidos), taxa de cancelamento, serviços mais procurados
- [ ] Filtros por período (semana, mês, trimestre)
- [ ] Acesso protegido por autenticação (Supabase Auth)
- [ ] Design responsivo (mobile-first)

RESTRIÇÕES TÉCNICAS:
- Next.js + Tailwind + shadcn/ui
- Supabase Auth para login da maquiadora
- Queries otimizadas com índices no banco
```

---

## 5. Stack Tecnológico

### Ferramentas e Frameworks

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Frontend (Fase 3) | Next.js 14+ + Tailwind CSS + shadcn/ui | SSR para landing page pública + dashboard admin protegido |
| Backend / API | Hono + Node.js | Ultraperformático, ideal para webhooks e integrações, rápido de desenvolver |
| Banco de Dados | Supabase (PostgreSQL) + Drizzle ORM | DB + Auth + Realtime em um só lugar, type-safe com Drizzle |
| Autenticação | Supabase Auth | Já incluso no Supabase, sem setup adicional |
| IA / Chatbot | Claude API (Anthropic) | Excelente compreensão contextual, ideal para conversas naturais como Sophia |
| WhatsApp | Evolution API (self-hosted) | Open source, sem custo por mensagem, controle total |
| Agendamento | Google Calendar API | Integração nativa com Google Workspace da maquiadora |
| Resumos | Google Sheets API + Google Docs API | Resumos diários automáticos no formato que a maquiadora já usa |
| Pagamentos | ASAAS API | Gateway BR, suporta Pix/Crédito/Débito, webhooks nativos |
| E-mail | Resend | API simples para e-mails transacionais de confirmação |
| Validação | Zod | Validação type-safe de dados de entrada |
| Styling | Tailwind CSS + shadcn/ui | Design system moderno e consistente |
| Ícones | Lucide React | Biblioteca de ícones leve e completa |
| Monorepo | Turborepo + pnpm | Organiza backend + futuro frontend, facilita trabalho com IA |
| Testes | Vitest | Rápido, compatível com TypeScript, boa DX |
| Deploy | Railway (API + Evolution API) + Vercel (Frontend) + Supabase (DB) | Stack de deploy otimizada para cada camada |

### Comandos Executáveis

```bash
# Instalar dependências
pnpm install

# Desenvolvimento (todos os apps)
pnpm dev

# Build
pnpm build

# Testes
pnpm test

# Lint
pnpm lint

# Migrations do banco
pnpm db:migrate

# Seed do banco
pnpm db:seed

# Gerar tipos do Drizzle
pnpm db:generate
```

---

## 6. Estrutura do Monorepo

```
studio-beatriz-beltrao/
├── apps/
│   ├── api/                        # Backend Hono
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── webhook/        # Webhooks (Evolution API + ASAAS)
│   │   │   │   │   ├── webhook.controller.ts
│   │   │   │   │   ├── webhook.service.ts
│   │   │   │   │   ├── webhook.routes.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── sophia/         # Agente Sophia (IA + lógica de conversa)
│   │   │   │   │   ├── sophia.controller.ts
│   │   │   │   │   ├── sophia.service.ts
│   │   │   │   │   ├── sophia.prompt.ts
│   │   │   │   │   ├── sophia.context.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── booking/        # Agendamentos
│   │   │   │   │   ├── booking.controller.ts
│   │   │   │   │   ├── booking.service.ts
│   │   │   │   │   ├── booking.routes.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── payment/        # Pagamentos ASAAS
│   │   │   │   │   ├── payment.controller.ts
│   │   │   │   │   ├── payment.service.ts
│   │   │   │   │   ├── payment.routes.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── calendar/       # Google Calendar
│   │   │   │   │   ├── calendar.service.ts
│   │   │   │   │   └── calendar.types.ts
│   │   │   │   ├── notification/   # WhatsApp + E-mail
│   │   │   │   │   ├── notification.service.ts
│   │   │   │   │   ├── whatsapp.provider.ts
│   │   │   │   │   └── email.provider.ts
│   │   │   │   ├── client/         # Clientes
│   │   │   │   │   ├── client.controller.ts
│   │   │   │   │   ├── client.service.ts
│   │   │   │   │   ├── client.routes.ts
│   │   │   │   │   └── dto/
│   │   │   │   ├── service/        # Serviços (maquiagem, penteado)
│   │   │   │   │   ├── service.controller.ts
│   │   │   │   │   ├── service.service.ts
│   │   │   │   │   ├── service.routes.ts
│   │   │   │   │   └── dto/
│   │   │   │   └── report/         # Resumos diários
│   │   │   │       ├── report.service.ts
│   │   │   │       └── report.cron.ts
│   │   │   ├── common/             # Middlewares, guards, interceptors
│   │   │   │   ├── middleware/
│   │   │   │   ├── guards/
│   │   │   │   └── interceptors/
│   │   │   ├── config/             # Configurações
│   │   │   │   ├── env.ts
│   │   │   │   ├── supabase.ts
│   │   │   │   ├── claude.ts
│   │   │   │   └── google.ts
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   └── web/                        # Frontend (Fase 3)
│       ├── src/
│       │   ├── app/                # App Router (Next.js)
│       │   │   ├── (public)/       # Landing page pública
│       │   │   ├── (dashboard)/    # Área admin protegida
│       │   │   └── api/            # API Routes (se necessário)
│       │   ├── components/
│       │   ├── hooks/
│       │   ├── lib/
│       │   ├── services/
│       │   └── types/
│       └── package.json
│
├── packages/
│   ├── db/                         # Schema, migrations, seed
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── clients.ts
│   │   │   │   ├── services.ts
│   │   │   │   ├── bookings.ts
│   │   │   │   ├── payments.ts
│   │   │   │   ├── conversations.ts
│   │   │   │   ├── messages.ts
│   │   │   │   └── settings.ts
│   │   │   ├── migrations/
│   │   │   └── seed/
│   │   └── package.json
│   │
│   ├── shared/                     # Tipos, validadores, constantes
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── client.types.ts
│   │   │   │   ├── booking.types.ts
│   │   │   │   ├── payment.types.ts
│   │   │   │   └── conversation.types.ts
│   │   │   ├── validators/         # Schemas Zod
│   │   │   │   ├── client.validator.ts
│   │   │   │   ├── booking.validator.ts
│   │   │   │   └── payment.validator.ts
│   │   │   ├── constants/
│   │   │   │   ├── services.ts
│   │   │   │   ├── business-hours.ts
│   │   │   │   └── messages.ts
│   │   │   └── utils/
│   │   └── package.json
│   │
│   ├── ui/                         # Component library (Fase 3)
│   │   └── package.json
│   │
│   ├── eslint-config/
│   └── ts-config/
│
├── assets/
│   ├── catalogo-maquiagem.pdf      # PDF catálogo de maquiagem
│   └── catalogo-penteados.pdf      # PDF catálogo de penteados
│
├── docs/
│   └── PRD.md                      # Este documento
│
├── AGENTS.md
├── CLAUDE.md
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## 7. Regras de Boundary (Importação)

```
REGRAS DE IMPORTAÇÃO:
- apps/web → PODE importar de: packages/shared, packages/ui
- apps/api → PODE importar de: packages/shared, packages/db
- packages/shared → NÃO importa de: apps/*, packages/db, packages/ui
- packages/ui → PODE importar de: packages/shared
- packages/db → PODE importar de: packages/shared
- NENHUM pacote pode ter dependência circular
```

---

## 8. Modelo de Dados

```
ENTIDADE: Cliente
TABELA: clients
CAMPOS:
  - id: UUID, PK, auto-generated
  - full_name: VARCHAR(255), NOT NULL
  - phone: VARCHAR(20), NOT NULL, UNIQUE
  - cpf: VARCHAR(14), NOT NULL, UNIQUE
  - email: VARCHAR(255), NOT NULL
  - notes: TEXT, NULLABLE
  - created_at: TIMESTAMP, DEFAULT NOW()
  - updated_at: TIMESTAMP, DEFAULT NOW()
ÍNDICES:
  - idx_clients_phone (phone) UNIQUE
  - idx_clients_cpf (cpf) UNIQUE
  - idx_clients_email (email)
```

```
ENTIDADE: Serviço
TABELA: services
CAMPOS:
  - id: UUID, PK, auto-generated
  - name: VARCHAR(255), NOT NULL
  - type: ENUM('maquiagem', 'penteado', 'combo'), NOT NULL
  - category: ENUM('estudio', 'externo'), NOT NULL, DEFAULT 'estudio'
  - description: TEXT, NULLABLE
  - price: DECIMAL(10,2), NOT NULL
  - duration_minutes: INTEGER, NOT NULL
  - is_active: BOOLEAN, DEFAULT TRUE
  - created_at: TIMESTAMP, DEFAULT NOW()
  - updated_at: TIMESTAMP, DEFAULT NOW()
ÍNDICES:
  - idx_services_type (type)
  - idx_services_category (category)
  - idx_services_active (is_active)
```

```
ENTIDADE: Agendamento
TABELA: bookings
CAMPOS:
  - id: UUID, PK, auto-generated
  - client_id: UUID, FK → clients.id, NOT NULL
  - service_id: UUID, FK → services.id, NOT NULL
  - scheduled_date: DATE, NOT NULL
  - scheduled_time: TIME, NOT NULL
  - end_time: TIME, NOT NULL
  - status: ENUM('pendente', 'confirmado', 'cancelado', 'concluido', 'expirado'), NOT NULL, DEFAULT 'pendente'
  - total_price: DECIMAL(10,2), NOT NULL
  - deposit_amount: DECIMAL(10,2), NOT NULL
  - google_calendar_event_id: VARCHAR(255), NULLABLE
  - payment_deadline: TIMESTAMP, NOT NULL
  - cancellation_reason: TEXT, NULLABLE
  - created_at: TIMESTAMP, DEFAULT NOW()
  - updated_at: TIMESTAMP, DEFAULT NOW()
ÍNDICES:
  - idx_bookings_client (client_id)
  - idx_bookings_date (scheduled_date)
  - idx_bookings_status (status)
  - idx_bookings_deadline (payment_deadline)
RELACIONAMENTOS:
  - Cliente 1:N Agendamento
  - Serviço 1:N Agendamento
```

```
ENTIDADE: Pagamento
TABELA: payments
CAMPOS:
  - id: UUID, PK, auto-generated
  - booking_id: UUID, FK → bookings.id, NOT NULL, UNIQUE
  - asaas_payment_id: VARCHAR(255), NOT NULL, UNIQUE
  - asaas_invoice_url: VARCHAR(500), NULLABLE
  - amount: DECIMAL(10,2), NOT NULL
  - method: ENUM('pix', 'credito', 'debito'), NULLABLE
  - status: ENUM('pendente', 'confirmado', 'cancelado', 'expirado', 'estornado'), NOT NULL, DEFAULT 'pendente'
  - paid_at: TIMESTAMP, NULLABLE
  - created_at: TIMESTAMP, DEFAULT NOW()
  - updated_at: TIMESTAMP, DEFAULT NOW()
ÍNDICES:
  - idx_payments_booking (booking_id) UNIQUE
  - idx_payments_asaas (asaas_payment_id) UNIQUE
  - idx_payments_status (status)
RELACIONAMENTOS:
  - Agendamento 1:1 Pagamento
```

```
ENTIDADE: Conversa
TABELA: conversations
CAMPOS:
  - id: UUID, PK, auto-generated
  - client_id: UUID, FK → clients.id, NULLABLE
  - phone: VARCHAR(20), NOT NULL
  - status: ENUM('ativa', 'aguardando_humano', 'finalizada'), NOT NULL, DEFAULT 'ativa'
  - intent: ENUM('agendamento', 'cancelamento', 'remarcacao', 'duvida', 'orcamento', 'outro'), NULLABLE
  - context_summary: TEXT, NULLABLE
  - collected_data: JSONB, NULLABLE
  - is_handoff: BOOLEAN, DEFAULT FALSE
  - handoff_reason: TEXT, NULLABLE
  - created_at: TIMESTAMP, DEFAULT NOW()
  - updated_at: TIMESTAMP, DEFAULT NOW()
ÍNDICES:
  - idx_conversations_client (client_id)
  - idx_conversations_phone (phone)
  - idx_conversations_status (status)
RELACIONAMENTOS:
  - Cliente 1:N Conversa
```

```
ENTIDADE: Mensagem
TABELA: messages
CAMPOS:
  - id: UUID, PK, auto-generated
  - conversation_id: UUID, FK → conversations.id, NOT NULL
  - role: ENUM('client', 'sophia', 'maquiadora'), NOT NULL
  - content: TEXT, NOT NULL
  - message_type: ENUM('text', 'image', 'audio', 'document', 'link'), DEFAULT 'text'
  - evolution_message_id: VARCHAR(255), NULLABLE
  - created_at: TIMESTAMP, DEFAULT NOW()
ÍNDICES:
  - idx_messages_conversation (conversation_id)
  - idx_messages_created (created_at)
RELACIONAMENTOS:
  - Conversa 1:N Mensagem
```

```
ENTIDADE: Configuração
TABELA: settings
CAMPOS:
  - id: UUID, PK, auto-generated
  - key: VARCHAR(100), NOT NULL, UNIQUE
  - value: JSONB, NOT NULL
  - description: TEXT, NULLABLE
  - updated_at: TIMESTAMP, DEFAULT NOW()
ÍNDICES:
  - idx_settings_key (key) UNIQUE

VALORES INICIAIS:
  - business_hours: { "start": "05:00", "end": "22:00", "days": [1,2,3,4,5,6] }
  - deposit_percentage: 30
  - payment_timeout_hours: 24
  - daily_report_time: "20:00"
  - studio_address: "..."
  - maquiadora_phone: "..."
  - maquiadora_email: "..."
```

---

## 9. Endpoints da API

```
ENDPOINT: POST /api/v1/webhook/evolution
DESCRIÇÃO: Recebe mensagens do WhatsApp via Evolution API
AUTENTICAÇÃO: API Key (Evolution API)
BODY:
  {
    "event": "messages.upsert",
    "instance": "string",
    "data": {
      "key": { "remoteJid": "string", "fromMe": "boolean", "id": "string" },
      "message": { "conversation": "string" }
    }
  }
RESPOSTA 200:
  { "status": "received" }
```

```
ENDPOINT: POST /api/v1/webhook/asaas
DESCRIÇÃO: Recebe notificações de pagamento do ASAAS
AUTENTICAÇÃO: Webhook Token (ASAAS)
BODY:
  {
    "event": "PAYMENT_CONFIRMED | PAYMENT_RECEIVED",
    "payment": {
      "id": "string",
      "status": "string",
      "value": "number",
      "billingType": "string"
    }
  }
RESPOSTA 200:
  { "status": "processed" }
```

```
ENDPOINT: GET /api/v1/bookings
DESCRIÇÃO: Lista agendamentos com filtros
AUTENTICAÇÃO: Bearer JWT (Supabase Auth)
QUERY PARAMS:
  {
    "date_from": "string (YYYY-MM-DD, optional)",
    "date_to": "string (YYYY-MM-DD, optional)",
    "status": "string (optional)",
    "page": "number (optional, default 1)",
    "limit": "number (optional, default 20)"
  }
RESPOSTA 200:
  {
    "data": [
      {
        "id": "uuid",
        "client": { "full_name": "string", "phone": "string" },
        "service": { "name": "string", "type": "string" },
        "scheduled_date": "YYYY-MM-DD",
        "scheduled_time": "HH:mm",
        "status": "string",
        "total_price": "number",
        "deposit_amount": "number"
      }
    ],
    "meta": { "total": "number", "page": "number", "limit": "number" }
  }
```

```
ENDPOINT: GET /api/v1/bookings/:id
DESCRIÇÃO: Detalhes de um agendamento
AUTENTICAÇÃO: Bearer JWT (Supabase Auth)
RESPOSTA 200:
  {
    "data": {
      "id": "uuid",
      "client": { "full_name": "string", "phone": "string", "cpf": "string", "email": "string" },
      "service": { "name": "string", "type": "string", "price": "number" },
      "scheduled_date": "YYYY-MM-DD",
      "scheduled_time": "HH:mm",
      "end_time": "HH:mm",
      "status": "string",
      "total_price": "number",
      "deposit_amount": "number",
      "payment": { "method": "string", "status": "string", "paid_at": "string" },
      "google_calendar_event_id": "string"
    }
  }
ERROS:
  - 404: { "error": "Agendamento não encontrado" }
```

```
ENDPOINT: GET /api/v1/dashboard/metrics
DESCRIÇÃO: Métricas para o dashboard (Fase 3)
AUTENTICAÇÃO: Bearer JWT (Supabase Auth)
QUERY PARAMS:
  {
    "period": "string (week | month | quarter, default month)"
  }
RESPOSTA 200:
  {
    "data": {
      "total_bookings": "number",
      "confirmed_bookings": "number",
      "cancelled_bookings": "number",
      "cancellation_rate": "number",
      "total_revenue": "number",
      "deposits_received": "number",
      "top_services": [{ "name": "string", "count": "number" }],
      "clients_served": "number"
    }
  }
```

```
ENDPOINT: GET /api/v1/services
DESCRIÇÃO: Lista serviços ativos
AUTENTICAÇÃO: Nenhuma
RESPOSTA 200:
  {
    "data": [
      {
        "id": "uuid",
        "name": "string",
        "type": "maquiagem | penteado | combo",
        "category": "estudio | externo",
        "price": "number",
        "duration_minutes": "number",
        "description": "string"
      }
    ]
  }
```

```
ENDPOINT: GET /api/v1/clients
DESCRIÇÃO: Lista clientes com busca
AUTENTICAÇÃO: Bearer JWT (Supabase Auth)
QUERY PARAMS:
  {
    "search": "string (optional, busca por nome, telefone ou CPF)",
    "page": "number (optional, default 1)",
    "limit": "number (optional, default 20)"
  }
RESPOSTA 200:
  {
    "data": [
      {
        "id": "uuid",
        "full_name": "string",
        "phone": "string",
        "email": "string",
        "total_bookings": "number",
        "last_booking_date": "string"
      }
    ],
    "meta": { "total": "number", "page": "number", "limit": "number" }
  }
```

---

## 10. Design e UI/UX

### Diretrizes Visuais
- **Framework CSS:** Tailwind CSS
- **Componentes:** shadcn/ui
- **Ícones:** Lucide React
- **Fontes:** Inter (body), JetBrains Mono (code/dados)
- **Cores primárias:** Rosa suave (#E8A0BF) + Dourado (#D4AF37) + Branco (#FFFFFF)
- **Cores secundárias:** Cinza escuro (#1F1F1F) para texto + Cinza claro (#F5F5F5) para backgrounds
- **Modo escuro:** Não (fase inicial)
- **Breakpoints:** sm(640px), md(768px), lg(1024px), xl(1280px)

### Identidade da Sophia (WhatsApp)
- Foto de perfil: Logo do Studio Beatriz Beltrão
- Nome exibido: "Studio Beatriz Beltrão"
- Descrição: "✨ Agende sua maquiagem e penteado"
- Tom: Acolhedor, profissional, feminino, com emojis sutis

### Estados Obrigatórios em Toda Tela (Dashboard — Fase 3)
- **Loading:** Skeleton shimmer
- **Empty:** Ilustração suave + mensagem + CTA
- **Error:** Toast de erro + botão de retry
- **Success:** Toast de confirmação com ícone ✓

### Referências visuais
- Calendly (fluxo de agendamento simples e limpo)
- Estética feminina e elegante, condizente com o universo de maquiagem

---

## 11. NÃO ALTERAR (Proteções para IA)

```
NÃO ALTERAR SEM APROVAÇÃO EXPLÍCITA:
- Schema do banco de dados (tabelas existentes)
- Assinaturas de endpoints da API já implementados
- Fluxo de autenticação/autorização (Supabase Auth)
- Prompt e personalidade da Sophia
- Configuração do Turborepo (turbo.json)
- Configuração de deploy e CI/CD
- Variáveis de ambiente existentes
- Arquivos AGENTS.md e CLAUDE.md
- Lógica de cálculo do sinal (30%)
- Lógica de timeout de pagamento (24h)
- Fluxo de handoff humano para casamentos/externos
- PDFs de catálogo de serviços
```

---

## 12. NÃO IMPLEMENTAR (Non-Goals)

- Pagamento online do valor total (apenas sinal de 30%)
- App mobile nativo (iOS/Android)
- E-commerce de produtos de beleza
- Sistema de fidelidade ou pontos
- Suporte a múltiplas maquiadoras (apenas Beatriz)
- Chat via site/plataforma web (apenas WhatsApp)
- Integração com Instagram ou outras redes sociais
- Sistema de avaliações/reviews
- Programa de indicações
- Agendamento recorrente automático
- Multi-idiomas (apenas pt-BR)

---

## 13. Fases de Implementação

### Fase 1: Core — Sophia + Agendamento + Pagamento (Semanas 1-4)
**Objetivo:** Sophia funcional no WhatsApp com fluxo completo de agendamento e cobrança de sinal.
**Entregáveis:**
- [ ] Setup do monorepo (Turborepo + pnpm)
- [ ] Setup do Supabase (DB + Auth)
- [ ] Schema do banco (todas as tabelas) com migrations
- [ ] Seed de serviços (maquiagem, penteados, combos com preços)
- [ ] Integração Evolution API (receber/enviar mensagens)
- [ ] Módulo Sophia: prompt, contexto, memória de conversa, coleta de dados
- [ ] Integração Claude API para processamento de linguagem natural
- [ ] Integração Google Calendar API (consultar/criar/remover eventos)
- [ ] Integração ASAAS API (criar cobranças, receber webhooks)
- [ ] Integração Resend (e-mail de confirmação)
- [ ] Fluxo completo: conversa → pré-agendamento → pagamento → confirmação
- [ ] Fluxo de cancelamento com informação de não-reembolso do sinal
- [ ] Fluxo de handoff humano para casamentos/externos
- [ ] Fluxo de timeout (24h sem pagamento → cancelamento automático)
- [ ] Testes unitários dos módulos críticos (booking, payment, sophia)
**Verificação:** Cliente consegue, via WhatsApp, conversar com Sophia, agendar um serviço, pagar o sinal, e receber confirmação via WhatsApp + e-mail. Maquiadora vê o evento no Google Calendar.
**Dependências:** Nenhuma

### Fase 2: Resumos + Operacional (Semanas 5-6)
**Objetivo:** Maquiadora recebe resumos diários automáticos e o sistema está estabilizado.
**Entregáveis:**
- [ ] Integração Google Sheets API (planilha de agendamentos)
- [ ] Integração Google Docs API (resumo diário formatado)
- [ ] Cron job para geração e envio de resumo diário (20h)
- [ ] Envio de resumo via WhatsApp para a maquiadora
- [ ] Lembrete automático para clientes (24h antes do agendamento)
- [ ] Refinamento do prompt da Sophia com base em testes reais
- [ ] Tratamento de edge cases (mensagens de áudio, imagens, etc.)
- [ ] Monitoramento e logs (Sentry)
**Verificação:** Maquiadora recebe resumo diário completo. Clientes recebem lembrete. Sistema estável com logs.
**Dependências:** Fase 1 completa

### Fase 3: Dashboard Web (Semanas 7-10)
**Objetivo:** Painel web com métricas de negócio para a maquiadora.
**Entregáveis:**
- [ ] Setup Next.js + Tailwind + shadcn/ui
- [ ] Landing page pública do estúdio
- [ ] Login com Supabase Auth
- [ ] Dashboard: agendamentos do dia/semana/mês
- [ ] Dashboard: métricas de faturamento
- [ ] Dashboard: lista de clientes com busca
- [ ] Dashboard: histórico de agendamentos por cliente
- [ ] Dashboard: taxa de cancelamento e serviços mais procurados
- [ ] Design responsivo (mobile-first)
- [ ] Deploy no Vercel
**Verificação:** Maquiadora acessa o dashboard, visualiza métricas, consulta agendamentos e clientes.
**Dependências:** Fase 1 e 2 completas

---

## 14. Métricas de Sucesso

### Métricas de Produto
- Taxa de conversão (conversa → agendamento confirmado): ≥ 60%
- Taxa de pagamento dentro das 24h: ≥ 80%
- Taxa de no-show (após confirmação): ≤ 5%
- Taxa de handoff humano: ≤ 20% das conversas
- NPS da cliente (pesquisa pós-serviço): ≥ 8/10
- Tempo médio de agendamento (início da conversa → pagamento): ≤ 15 minutos

### Métricas Técnicas
- Cobertura de testes: ≥ 70%
- API response time p95: ≤ 500ms
- Uptime: ≥ 99.5%
- Tempo de resposta da Sophia: ≤ 5 segundos
- Taxa de erro em webhooks: ≤ 1%

---

## 15. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Evolution API instável ou fora do ar | Média | Crítico | Monitoramento com alertas, fallback manual para WhatsApp Web |
| Claude API com latência alta | Baixa | Alto | Cache de respostas frequentes, timeout com fallback de mensagem padrão |
| ASAAS webhook não entregue | Baixa | Crítico | Polling periódico de status de pagamento como fallback |
| Sophia interpreta mal a intenção da cliente | Média | Médio | Confirmação explícita antes de ações irreversíveis, refinamento contínuo do prompt |
| Conflito de horário no Calendar | Baixa | Alto | Verificação de disponibilidade com lock otimista antes de criar pré-agendamento |
| Cliente não paga em 24h e perde horário | Média | Baixo | Lembrete automático antes do timeout (ex: 6h e 2h antes de expirar) |
| Dados sensíveis expostos (CPF) | Baixa | Crítico | Criptografia de campos sensíveis no banco, HTTPS everywhere, políticas de acesso Supabase RLS |

---

## 16. Variáveis de Ambiente

```bash
# apps/api/.env

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=

# Claude API
ANTHROPIC_API_KEY=

# Evolution API
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE_NAME=

# Google Workspace
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_CALENDAR_ID=
GOOGLE_SHEETS_ID=

# ASAAS
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=
ASAAS_ENVIRONMENT=sandbox

# Resend
RESEND_API_KEY=
RESEND_FROM_EMAIL=contato@studiobeatrizbeltrao.com.br

# App
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
DEPOSIT_PERCENTAGE=30
PAYMENT_TIMEOUT_HOURS=24
BUSINESS_HOURS_START=05:00
BUSINESS_HOURS_END=22:00
MAQUIADORA_PHONE=
MAQUIADORA_EMAIL=

# apps/web/.env (Fase 3)
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## 17. Instruções para Agentes de IA (AGENTS.md)

```markdown
# Instruções para Agentes de IA

## Projeto
Studio Beatriz Beltrão — Sistema inteligente de atendimento e agendamento via WhatsApp para estúdio de maquiagem e penteados.

## Stack
- Backend: Hono + Node.js
- DB: Supabase (PostgreSQL) + Drizzle ORM
- IA: Claude API (Anthropic)
- WhatsApp: Evolution API
- Agendamento: Google Calendar API
- Resumos: Google Sheets + Docs API
- Pagamentos: ASAAS API
- E-mail: Resend
- Frontend (Fase 3): Next.js + Tailwind + shadcn/ui
- Monorepo: Turborepo + pnpm

## Regras Gerais
- TypeScript strict mode obrigatório
- Sem uso de 'any' — types explícitos sempre
- async/await (nunca .then/.catch)
- Imports absolutos dentro de cada app
- Seguir estrutura de pastas existente
- Toda função pública deve ter JSDoc
- Sem console.log em produção — usar logger
- Validação de entrada com Zod em TODOS os endpoints e webhooks
- Campos sensíveis (CPF) devem ser tratados com cuidado nos logs

## Padrões de Código
- Variáveis/funções: camelCase
- Componentes/Types: PascalCase
- Arquivos: kebab-case.ts
- Componentes React: arrow functions + export default
- API responses: formato padrão { data, meta, error }
- Módulos da API: controller → service → repository pattern

## Padrões da Sophia
- Prompt da Sophia fica em sophia.prompt.ts — NÃO alterar sem aprovação
- Contexto de conversa gerenciado em sophia.context.ts
- Toda mensagem recebida deve ser logada na tabela messages
- Toda resposta da Sophia deve ser logada na tabela messages
- Handoff humano é sinalizado via flag is_handoff na conversa
- Uma pergunta por mensagem — SEMPRE

## Testes
- Framework: Vitest
- Localização: __tests__/ dentro de cada módulo
- Rodar: pnpm test
- Mocks para APIs externas: Evolution API, Claude API, ASAAS, Google APIs

## Commits
- Conventional commits: feat:, fix:, docs:, refactor:, test:, chore:
- Escopo: feat(api): add booking flow
- Sempre em inglês

## NÃO fazer
- Não instalar dependências sem confirmação
- Não alterar turbo.json ou pnpm-workspace.yaml
- Não criar arquivos fora da estrutura definida
- Não alterar schemas de banco sem aprovação
- Não remover testes existentes
- Não alterar o prompt da Sophia sem aprovação
- Não alterar lógica de cálculo de sinal (30%)
- Não alterar timeout de pagamento (24h)
- Não expor CPF em logs ou respostas de API (mascarar)
```

---

**Fim do PRD**
