# ADR 0001 — Stack e arquitetura inicial

Data: 2026-10-27 · Status: aceito

## Contexto
Repositório vazio. Requisitos: TypeScript ponta a ponta, consistência financeira, multi-organização, evolução por fases.

## Decisão
- **Monólito modular em Next.js 15** (App Router, server actions). Domínios separados em `src/server/modules/*`
  e regras puras em `src/domain/*`. Sem microsserviços até haver necessidade real (ex.: servidor OCPP de WebSocket
  de longa duração — será um processo separado na Fase 4).
- **PostgreSQL + Prisma 6** com migrações versionadas. Dinheiro em `Decimal(14,2)`, taxas em `Decimal(9,6)`.
- **decimal.js** em todo cálculo financeiro; arredondamento ROUND_HALF_UP por linha mensal; totais = soma das linhas.
- **Sessões em banco** (token aleatório, apenas hash SHA-256 persistido, cookie httpOnly/SameSite=Lax). Permite
  revogação imediata — requisito explícito. Perfil e vínculo são revalidados a cada requisição.
- **RBAC** por permissão `recurso:ação` em perfis (`Role.permissions`), com perfis de sistema e por organização.
  Escopo por organização aplicado nos serviços (todas as consultas filtram `organizationId`).
- **Rate limit em Postgres** (upsert atômico). Redis entra quando houver filas (Fase 4/5).
- **Zod** para validação compartilhada entre cliente e servidor.

## Consequências
- Sem RLS no Postgres por enquanto: isolamento garantido na camada de serviço e coberto por testes.
  RLS é recomendado antes de expor acesso direto ao banco ou relatórios ad hoc (pendência registrada).
- Server actions já verificam Origin/Host (proteção CSRF do Next). Rotas de API futuras (webhooks) terão validação própria.
