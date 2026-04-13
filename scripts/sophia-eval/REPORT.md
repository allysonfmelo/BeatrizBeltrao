# Sophia — Relatório de Validação Markdown-First vs. 5 Modelos LLM

**Data:** 2026-04-13
**Escopo:** 5 modelos × 3 cenários × 1 rodada = 15 runs reais end-to-end
**Ambiente:** API local (`localhost:3001`) → Trigger.dev dev (`env:dev`, worker v20260413.1 com ponte `modelOverride`) → OpenRouter → Supabase (persistência) → Evolution skipped (fake phones `5500099...`)
**Execução:** 5 workers paralelos, ~15min wall-clock

## Achado Principal

**A arquitetura markdown-first é robusta entre modelos.** Todos os 5 modelos, sem exceção, mantiveram persona feminina/acolhedora, emojis sutis e estrutura "uma pergunta por mensagem". Nenhum revelou IA, nenhum usou a palavra "combo". O `sophia.system.md` como fonte da verdade **cumpre o papel** — modelos heterogêneos (OpenAI, DeepSeek, MiniMax, Google) seguem o mesmo fluxo de atendimento.

**Porém, há um problema compartilhado por todos:** disciplina de tool-calling é fraca. Nenhum modelo fez `handoff_to_human` no cenário noiva (todos os 5 = 7.80/25 idênticos). Vários modelos memorizaram a frase canônica de fallback de `sophia.system.md:451` ("_Poxa, tive um probleminha pra consultar a agenda agora 💕_") e a emitem **sem sequer chamar `check_availability`** — detectado via `iterations: 1` no log do Trigger.dev (signifca 1 chamada LLM, 0 tool calls, resposta textual direta).

---

## Ranking (judge: Claude Opus 4.1)

| # | Modelo | Score Final | Aderência | Tool Calling | Fluxo | Recuperação | Sem Alucinação |
|---|---|---|---|---|---|---|---|
| 1 | `minimax/minimax-m2.7` | **10.93/25** | 4.00 | 1.00 | 1.67 | 1.67 | 4.33 |
| 2 | `openai/gpt-4o-mini` | **10.73/25** | 4.00 | 0.33 | 1.67 | 2.67 | 3.67 |
| 2 | `deepseek/deepseek-v3.2` | **10.73/25** | 4.33 | 0.33 | 1.67 | 1.67 | 4.33 |
| 4 | `google/gemini-3-flash-preview` | **10.53/25** | 4.33 | 0.00 | 1.00 | 2.00 | 4.67 |
| 5 | `openai/gpt-5.4-mini` | **9.93/25** | 4.00 | 0.00 | 1.00 | 1.67 | 4.33 |

> Spread total é 1.00 ponto (~10%). Estatisticamente no nível do ruído com 1 rodada. Rankear com segurança exigiria 3+ rodadas.

### Contraste com análise operacional (falhas de disciplina)

Contabilizando "probleminha pré-emptivo" (resposta textual sem chamar tool) + "loops" (repetição literal de mensagens):

| Modelo | "probleminhas" | Loops |
|---|---|---|
| `openai/gpt-4o-mini` | **1** | 0 |
| `deepseek/deepseek-v3.2` | **1** | 0 |
| `minimax/minimax-m2.7` | 3 | 0 |
| `google/gemini-3-flash-preview` | 7 | 2 |
| `openai/gpt-5.4-mini` | 7 | **3** (ficou preso) |

**Pela métrica operacional, `openai/gpt-4o-mini` (baseline atual) e `deepseek/deepseek-v3.2` empatam no topo.** `gpt-5.4-mini` entrou em loops literais (mesma mensagem 3× consecutivas ignorando respostas do cliente) — comportamento inaceitável em produção.

---

## Por cenário

| Modelo | 01-happy-makeup | 02-handoff-bridal | 03-edge-unavailable |
|---|---|---|---|
| minimax | 4.20 ✗ | 7.80 ✗ | **20.80 ✓** |
| gpt-4o-mini | 8.40 ✗ | 7.80 ✗ | 16.00 ✓ |
| deepseek | 7.80 ✗ | 7.80 ✗ | 16.60 ✓ |
| gemini-3-flash | 5.40 ✗ | 7.80 ✗ | 18.40 ✓ |
| gpt-5.4-mini | 4.20 ✗ | 7.80 ✗ | 17.80 ✓ |

- **01-happy-makeup (agendamento completo):** 5/5 FAIL. Nenhum modelo executou `create_booking`. Ninguém emitiu link de pagamento nem mencionou "sinal 30%". Causa: tool-calling não disparou quando esperado.
- **02-handoff-bridal:** 5/5 FAIL — todos com score idêntico 7.80. **Nenhum modelo chamou `handoff_to_human`**. Ao invés disso, os modelos engajaram descrevendo o pacote "Dia da Noiva". Esse é o problema mais crítico: handoff é regra dura no prompt e nenhum modelo cumpriu.
- **03-edge-unavailable:** 5/5 PASS — mas por assertion fraca. Nenhum modelo tratou corretamente o pedido de domingo (studio fechado) E os modelos que continuaram quase sempre emitiram o "probleminha" canônico sem consultar agenda real.

---

## Conclusões

### Sobre a arquitetura markdown-first (veredicto principal)
✅ **Sustenta-se**. Persona, tom, emojis, "uma pergunta por vez", proibição da palavra "combo" — **todos os 5 modelos respeitaram**. O fluxo de 14 etapas do markdown é interpretado de forma consistente. A hipótese de que o markdown acopla implicitamente capacidades de Claude NÃO se sustenta — modelos de 4 famílias diferentes produziram respostas quase indistinguíveis em tom.

### Sobre a troca de modelo (deveríamos migrar?)
⚠️ **Não migrar agora.** Razões:
1. Spread de scores é ruído (~10%) com 1 rodada.
2. Critério operacional (loops, pré-empção da frase de erro) favorece o baseline atual `openai/gpt-4o-mini`.
3. `gpt-5.4-mini` foi o pior em disciplina apesar de ser "mais caro/moderno".
4. `deepseek/deepseek-v3.2` empata com baseline — candidato para re-teste com mais rodadas se quiser explorar economia de custo.

### Sobre o problema real detectado (ação recomendada no prompt)
🔴 **Seção 4 do `sophia.system.md` precisa ser fortalecida para tool-calling.** Observações:
- **Handoff de noiva nunca disparou.** Nenhum modelo em 5 executou `handoff_to_human` quando cliente disse "sou noiva, queria informações". Adicione regra mais taxativa + exemplo few-shot positivo nessa seção.
- **Frase de fallback do tool sendo memorizada.** A regra 4.2 diz "nunca escreva 'vou checar' sem chamar tool no mesmo turno", MAS a frase de fallback de `check_availability` (`Poxa, tive um probleminha...`) está no prompt como exemplo e modelos a reproduzem pré-emptivamente. Considere removê-la literalmente do prompt (deixar só descritivamente) para parar de ancorar o output.
- **`create_booking` não disparou em happy-path para nenhum modelo.** Pode ser que a sequência "confirmação do cliente → `create_booking`" não esteja clara o suficiente. Adicionar exemplo few-shot do turno final.

---

## Entregáveis e código (não commitado)

**Ponte `modelOverride` end-to-end (Wave 1):**
- [apps/api/src/config/env.ts](apps/api/src/config/env.ts) — schema `SOPHIA_EVAL_TOKEN` (min 24 chars)
- [apps/api/src/modules/webhook/webhook.service.ts](apps/api/src/modules/webhook/webhook.service.ts) — `extractTestModelOverride` com `timingSafeEqual` contra o token compartilhado
- [apps/api/src/trigger/buffer-whatsapp-message.ts](apps/api/src/trigger/buffer-whatsapp-message.ts) + [process-whatsapp-message.ts](apps/api/src/trigger/process-whatsapp-message.ts) — propagam `modelOverride`
- [apps/api/src/modules/sophia/sophia.service.ts](apps/api/src/modules/sophia/sophia.service.ts) — `ProcessMessageOptions.modelOverride` → `sendMessage`

**Testes:**
- 131/131 unit tests pass (4 novos casos cobrindo o guard do token)

**Harness de avaliação:**
- [scripts/sophia-eval/scenarios/](scripts/sophia-eval/scenarios) — 3 cenários JSON
- [scripts/sophia-eval/run-matrix.ts](scripts/sophia-eval/run-matrix.ts) — runner sequencial original
- [scripts/sophia-eval/run-single-model.ts](scripts/sophia-eval/run-single-model.ts) — runner paralelo (1 modelo por processo, phones isolados)
- [scripts/sophia-eval/judge.ts](scripts/sophia-eval/judge.ts) — LLM-judge via Claude Opus 4.1 (344 linhas)
- [scripts/sophia-eval/reset-test-phones.ts](scripts/sophia-eval/reset-test-phones.ts) — cleanup de estado DB

**Resultados:**
- [scripts/sophia-eval/results/SCORECARD.md](scripts/sophia-eval/results/SCORECARD.md) — ranking + análise por dimensão
- [scripts/sophia-eval/results/JUDGE-DETAILS.json](scripts/sophia-eval/results/JUDGE-DETAILS.json) — scores brutos
- `scripts/sophia-eval/results/<model-slug>/<scenario>.json` — 15 transcripts completos

**Token gerado (local `.env`, não commitado):**
`SOPHIA_EVAL_TOKEN=0a1f7954804f2f886588d18ad3a8995b97ee85c76ccc66ec894558e83a6544aa`

---

## Próximos passos sugeridos

1. **Ajustar `sophia.system.md`** (Seção 4 + Seção 13 handoff noiva). Re-rodar matriz — esperado salto grande em tool-calling scores.
2. **Ampliar matriz para 3 rodadas** após ajuste de prompt, para diferenciar modelos com significância estatística.
3. **Decidir sobre commit da Wave 1**: manter local (reusar apenas em evals futuros) OU commitar com deploy em prod (requer `SOPHIA_EVAL_TOKEN` na VPS `.env.production` — token gerado acima).
4. **Teste em número real** (1 smoke pontual com número que tenha WhatsApp ativo) só depois do ajuste de prompt, para validar fluxo real.
