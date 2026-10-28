# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sansol Mob Platform — EV-charging network platform (public site, CRM, commercial models + viability simulator, stations/OCPP, driver portal, payments). UI text, domain terms, comments and commit messages are in **Portuguese (pt-BR)**; keep that convention. Progress, evidence and known gaps per phase live in `IMPLEMENTATION_STATUS.md` — update it when finishing a phase/feature (record real command output, never invented results).

## Commands

```bash
npm run dev                 # Next.js dev server (port 3000)
npm run build               # production build (stop `npm run dev` first: both write .next/)
npm run lint                # ESLint (vars prefixed with _ are allowed unused)
npm run typecheck           # tsc --noEmit
npm test                    # all Vitest tests (unit + integration)
npx vitest run tests/unit/viability-engine.test.ts      # one file
npx vitest run -t "nome do teste"                       # by test name
npm run db:migrate          # prisma migrate dev (create migration)
npm run db:deploy           # apply migrations (non-destructive)
npm run db:seed             # roles, operator org, pipeline, reference models, superadmin
npm run ocpp:server         # OCPP 1.6-J WebSocket server (separate process, port 9220)
npm run ocpp:simulate -- <identity> <senha> [ciclo|interativo]   # simulated charger (SIMULATED stations only)
npm run dev:users           # dev DB only: 2 admins + finance + partner test users (password in .env.dev-users, git-ignored)
npm run setup:first-admin   # any env: roles/operator/defaults + FIRST superadmin from ADMIN_EMAIL/ADMIN_PASSWORD; refuses if one exists
npm run asaas:homologar     # official Asaas SANDBOX check (refuses production); report in docs/homologacao/
npm run asaas:webhook -- listar|criar <url>|atualizar <id> <url>|remover <id>   # sandbox webhooks only
NEXT_DIST_DIR=.next-build npm run build   # build without stopping `npm run dev` (Next rewrites tsconfig.json include: restore it)
npm run e2e:rotas           # HTTP route/permission E2E (dev DB only; E2E_BASE=http://localhost:3002 for a prod build — `next dev` restarts on memory with many routes)
```
- Port 3000 may be taken by another local project; `.claude/launch.json` has `sansol-dev-3001`.

- Tests run against `TEST_DATABASE_URL` (never `DATABASE_URL`): `tests/global-setup.ts` runs `migrate deploy` on it and `tests/integration/fixtures.ts#resetDb` truncates it. Files run sequentially (`fileParallelism: false`). Do not use `prisma migrate reset` (blocked in this environment and destructive).
- After `prisma migrate dev`, **restart `npm run dev`**: the dev server caches the Prisma client on `globalThis` and fails with `Cannot read properties of undefined` on new models.
- After changing `SYSTEM_ROLES`/permissions, rerun `npm run db:seed` so existing role rows get the new permissions.
- New migrations must be additive; add a manual `down.sql` next to `migration.sql` (pattern used by every migration).

## Architecture

Single Next.js 15 App Router app (TypeScript, Prisma/PostgreSQL, Zod, decimal.js, Tailwind 4) plus a separate Node process for OCPP.

**Layering (enforced by convention):**
- `src/domain/*` — pure rules, no I/O: viability engine (`viability/engine.ts`), commercial terms types, station status rules (`stations/status.ts`).
- `src/server/modules/*`, `src/server/drivers/*`, `src/server/payments/*`, `src/server/ocpp/*` — services. Every staff-facing service takes an `AuthContext` and calls `requirePermission(ctx, "recurso:ação")` and filters by `ctx.organizationId` itself. Pages and actions must not query `db` directly for tenant data — go through a service.
- `src/app/actions/*` — thin `"use server"` wrappers using `toActionState()` (`src/server/action-result.ts`), which maps `ZodError`/`AppError` to form state. Actions must return only plain data (ids/messages), never Prisma records (Decimal breaks client serialization).
- UI: `src/components/ui/*` design system (tokens in `src/app/globals.css`, documented in `docs/design-system.md`); `ActionForm` (`src/components/app/action-form.tsx`) is the standard form-with-server-action component (pending/success/error + accessible confirm dialog).

**Auth & tenancy:**
- Staff: DB sessions (`Session`, SHA-256 token hash, cookie `sm_session`), re-validated each request in `resolveSession`; RBAC via `Role.permissions` strings (`src/server/auth/permissions.ts`). Org kinds: `OPERATOR` (Sansol Mob), `PARTNER`, `INVESTOR`; partners see only sites where `Site.partnerOrganizationId` is their org.
- Drivers: completely separate auth (`Driver`, `DriverSession`, cookie `sm_driver`, `src/server/drivers/auth.ts`); a driver never gets an `AuthContext`.
- `station:command_production` is superadmin-only and also requires `OCPP_ALLOW_PRODUCTION_COMMANDS=1`.

**Money and projections:** all financial math uses Decimal with ROUND_HALF_UP per line; money columns are `Decimal(14,2)`, rates `Decimal(9,6)` stored as fractions (0.05 = 5%). Commercial model versions are immutable once approved (four-eyes: approver ≠ creator; effective-date windows via `effectiveWhere`). Simulations store inputs + results + engine version; legacy inputs are read through `normalizeStoredInput`. Fee bases are configurable per version; `platformFeeIncludesGateway` forbids separate gateway costs (no double counting).

**OCPP (`src/server/ocpp/`):** `protocol.ts` (framing + Zod for the supported Core subset), `handler.ts` (idempotent by `(station, direction, UniqueId)` in `OcppMessage`; StartTransaction retries dedupe on connector+timestamp+idTag; status ordered by charger clock, out-of-order kept with `applied=false`; staleness always by server clock), `ws-server.ts` (HTTP Basic per station, delivers queued `RemoteCommand` rows from the DB every second, 30 s timeout). Missing communication must never be shown as available (`effectiveStatus` → `UNKNOWN`). Station `environment` (`PRODUCTION|TEST|SIMULATED`) is copied to sessions; non-production data is excluded from indicators unless explicitly requested.

**Charging + payments flow:** `src/server/drivers/charging.ts` — ChargeRequest → pre-authorization → RemoteStart → `onSessionStarted` hook (links driver/payment, freezes tariff) → `onSessionStopped` hook (computes amount, captures). Hooks and `driverAwareAuthorizer` are wired in `scripts/ocpp-server.ts`. Payments (`src/server/payments/`) change status only from the provider (`fetch` or verified webhook at `/api/payments/webhooks/[provider]`) through the `PAYMENT_TRANSITIONS` state machine; `onPaymentStateChange(key, fn)` listeners live on `globalThis` (the webhook route imports `@/server/drivers/charging` to register the flow). Providers: local simulated `sandbox` (TEST stations only) and `asaas` (official sandbox/production, below); production stations stay blocked until `productionReadiness` passes. `reconcile()` lists divergences (payment without session, session without payment, amount/provider mismatch).

**Finance/contracts (P08):** contract terms live in immutable `ContractVersion`s (four-eyes approval; effective = approved with latest `effectiveFrom ≤ date`). Settlement math is pure in `src/domain/finance/settlement.ts` (bump `SETTLEMENT_ENGINE_VERSION` when semantics change). Monthly closing (`modules/finance/closing.ts`): preview → request → approval by another person, which recomputes and compares the SHA-256 of the snapshot (mismatch → `SUPERSEDED`). Approved periods are locked (`lockOpenPeriod` advisory lock + check) — corrections only via `ADJUSTMENT` entries in an open period. Partial unique indexes (one APPROVED/PENDING closing per period, one unresolved alert per dedupeKey, one open WO per plan) exist only in the migration SQL. Production revenue = captured − refunded payments of PRODUCTION sessions; TEST/SIMULATED never enter closings. No payout provider: never initiate transfers.

**Support/alerts (P09):** tickets copy the SLA policy at creation; pauses are `PAUSE`/`RESUME` events (reason required). Alert engine (`modules/alerts/engine.ts`) + notification outbox (`notifications.ts`, consent opt-in, no channel adapter configured) + `AutomationRun` log; the cycle runs every minute inside `npm run ocpp:server`. Partner portal (`modules/partner/portal.ts`) must only ever return the partner's own lines from closing snapshots.

**Asaas (P13, guide in `docs/asaas.md`):** `PAYMENT_PROVIDER=asaas` + `ASAAS_*` env vars select the official sandbox or production; production also needs `ASAAS_PRODUCTION_ENABLED=1` AND an approved `GatewayActivation` (`productionReadiness`). All HTTP goes through `payments/asaas/client.ts`; Pix and card are `PREPAID` (charge up front, refund the unused difference once; `isPrepaidMethod`); card is paid on the Asaas hosted page (`invoiceUrl`, only shown if `safeInvoiceUrl` passes) — never collect card data. The order page polls the gateway itself (`syncPendingPayment`, ≤1 call/10 s), so payment confirms even without webhook. Charge creation is idempotent by `externalReference = charge:<chargeRequestId>` + `PaymentOperation`; on TIMEOUT never retry blindly — look up by externalReference. Local status comes only from `GET /payments/{id}` (webhooks just trigger the fetch). Split % applies to Asaas `netValue`, not gross. Tests use `tests/support/fake-asaas.ts` via `__setAsaasFetchForTests` — never the real API. Driver CPF is encrypted with `DATA_ENCRYPTION_KEY`. Asaas keys start with `$`: write `\$` in `.env` (Next and `scripts/load-env.mjs` expand `$`). TEST stations are reachable by direct link/QR only (not listed). Charger deadlines count from `ChargeRequest.startRequestedAt` (set when payment is confirmed), not `createdAt`; partial unique indexes allow one open request per driver and per connector (SQL only). Bench idTags `TEST-`/`SIM-` are rejected on PRODUCTION stations. Card partial refunds are rejected by Asaas on the same day → refund becomes `SCHEDULED` (`classifyRefundFailure` in `domain/payments/refund.ts`); `retryDueRefunds` (OCPP cycle) always fetches the gateway and matches by `refundMarker` before re-sending, max 5 attempts; it claims each refund with a unique lease (`nextAttemptAt` + `remoteStatus RETRYING`) and re-sends only via a conditional update on that lease (manual "Tentar agora" refuses an active lease). Sessions get `fundedAmount`/`limitAmount` at start; `checkSessionLimit` (on MeterValues and every sweep) queues one `REMOTE_STOP` at the limit (`domain/charging/limit.ts`, `SESSION_LIMIT_MARGIN`). Webhook retries back off via `PaymentEvent.nextAttemptAt`; `payments.reconcile` runs hourly in the automation cycle (report only).

## Environment

See `.env.example` (DATABASE_URL, TEST_DATABASE_URL, APP_SECRET, SEED_ADMIN_PASSWORD, TRUST_PROXY, PUBLIC_SITE_URL, OCPP_*, PAYMENT_*). `X-Forwarded-For` is only trusted with `TRUST_PROXY=1`. Dev superadmin: `admin@sansolmob.local` with `SEED_ADMIN_PASSWORD`. Docker/compose and CI (`.github/workflows/ci.yml`) exist but have not been executed in this environment (the container no longer migrates on start: use `docker compose --profile migrate run --rm migrate`; run compose with `--env-file` because it expands `$` in the project `.env` and prints the Asaas key); operations notes are in `docs/runbook.md`, stack rationale in `docs/adr/0001-stack.md`.
