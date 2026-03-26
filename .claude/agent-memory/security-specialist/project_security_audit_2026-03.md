---
name: Security Audit March 2026
description: Resultados da auditoria de segurança completa do projeto em 2026-03-25 — findings abertos, aprovados e bloqueadores de deploy
type: project
---

Auditoria completa realizada em 2026-03-25. 23 findings identificados.

**Why:** Primeira auditoria completa do projeto antes de deploy em producao.

**How to apply:** Verificar status de cada finding abaixo antes de aprovar qualquer deploy em producao.

## Bloqueadores de Deploy (ainda abertos em 2026-03-25)

- SEC-01 CRITICA: `POST /api/v1/bookings/:id/confirm-payment` exposto sem auth em todos os ambientes (booking.routes.ts:13)
- SEC-02 ALTA: Webhook Evolution API sem validacao de token (webhook.controller.ts:10-22)
- SEC-03 ALTA: next@14.2.35 com 3 CVEs — precisa upgrade para >=15.5.14
- SEC-04 ALTA: systeminformation@5.23.8 com 3 CVEs de Command Injection (via trigger.dev)
- SEC-06 ALTA: Zero security headers na API Hono (app.ts) — usar hono/secure-headers
- SEC-07 ALTA: Zero security headers no Next.js (next.config.mjs)
- SEC-08 ALTA: Endpoints REST /clients, /bookings, /services sem autenticacao — expoe PII
- SEC-10 MEDIA: CPF completo retornado em GET /clients — viola LGPD
- SEC-13 MEDIA: Query params page/limit sem validacao Zod nem bounds
- SEC-14 MEDIA: ASAAS_ENVIRONMENT default "sandbox" — risco silencioso em producao

## Aprovados / Conformes

- Sem secrets hardcoded (scan limpo)
- .env nunca commitado (git log verificado)
- Drizzle ORM correto — sem SQL raw
- CPF mascarado em logs via maskSensitiveData()
- ASAAS webhook valida token
- Evolution webhook valida payload com Zod
- google-calendar.ts usa execFile com array de args (seguro contra shell injection)
- CORS nao e wildcard — usa env.CORS_ORIGIN
- Sentry nao expoe stack traces ao cliente
