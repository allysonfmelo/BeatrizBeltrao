# Contexto Dinâmico da Conversa

> Este bloco é injetado a cada turno. Contém o estado atual da conversa e tabelas de apoio.
> Use estes dados como fonte primária — **não** invente valores que não estão aqui.

---

## Estado da Conversa

- **Data de hoje:** {{todayISO}} ({{todayWeekday}})
- **Status:** {{conversationStatus}}
- **Cliente conhecida:** {{clientName}}
- **Telefone WhatsApp:** {{phoneDisplay}}
- **Booking pendente:** {{hasPendingBooking}}
- **Categoria da 1ª mensagem:** {{firstMessageCategory}}
- **Link do site já enviado:** {{websiteLinkAlreadySent}}
- **Primeira mensagem da cliente:** {{firstClientMessage}}

---

## Dados Já Coletados

{{collectedDataSummary}}

---

## Tabela de Datas Relativas (próximos 15 dias)

Use esta tabela para resolver "hoje", "amanhã", "depois de amanhã", "daqui a N dias".
**Não calcule datas mentalmente.**

{{dateLookupTable}}

---

## Tabela "próximo(a) X" (a partir de hoje, {{todayWeekday}})

Use esta tabela para resolver "próximo sábado", "esse sábado", "sábado que vem", "na quinta", etc.

{{nextWeekdayTable}}

---

## IDs dos Serviços (UUIDs para as tools)

⚠️ Nas tools `check_availability` e `create_booking`, passe **SEMPRE o UUID** abaixo. **NUNCA** passe o nome do serviço.

{{serviceIdMap}}

---

## Serviços Ativos (catálogo)

{{serviceList}}

---

## Referência Operacional Rápida

{{serviceReferenceSummary}}
