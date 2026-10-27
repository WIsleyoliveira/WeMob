# Sansol Mob Platform

Plataforma de eletromobilidade da Sansol Mob: portal institucional, CRM, modelos comerciais versionados,
simulador de viabilidade e (nas próximas fases) operação de eletropostos, pagamentos e financeiro.

Estado atual, evidências e pendências: **[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)**.

## Stack
Next.js 15 (App Router) · TypeScript · PostgreSQL + Prisma (migrações versionadas) · Zod · decimal.js · Vitest · Tailwind CSS 4.
Justificativa em [docs/adr/0001-stack.md](docs/adr/0001-stack.md).

## Primeiros passos
Pré-requisitos: Node 22, PostgreSQL 14+ (ou Docker).

```bash
npm install
cp .env.example .env   # preencha DATABASE_URL, TEST_DATABASE_URL, APP_SECRET e SEED_ADMIN_PASSWORD
npm run db:deploy      # aplica migrações
npm run db:seed        # perfis, operadora, funil, modelos de referência e superadmin
npm run dev            # http://localhost:3000
```

Superadmin de desenvolvimento: `admin@sansolmob.local` com a senha definida em `SEED_ADMIN_PASSWORD`.

Com Docker: `docker compose up --build` (Postgres na porta 5433, app na 3000).

## Comandos
| Comando | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` / `npm start` | build e execução de produção |
| `npm run lint` / `npm run typecheck` | ESLint e TypeScript |
| `npm test` | testes unitários e de integração (usam `TEST_DATABASE_URL`, nunca o banco de dev) |
| `npm run check` | lint + tipos + testes |
| `npm run db:migrate` | cria nova migração (desenvolvimento) |
| `npm run db:deploy` | aplica migrações pendentes (não destrutivo) |

## Estrutura
```
prisma/                 schema, migrações e seed de desenvolvimento
src/domain/             regras de negócio puras (sem I/O) — motor de viabilidade, termos comerciais
src/server/             infraestrutura e serviços: db, auth/RBAC, auditoria, rate limit, módulos de domínio
  modules/leads         CRM e captação pública
  modules/commercial    modelos versionados e simulações persistidas
  modules/sites         unidades com escopo por organização
  modules/identity      vínculos e revogação de acesso
src/app/(public)        site institucional
src/app/app             backoffice autenticado
src/app/actions         server actions (fina camada sobre os serviços)
src/components/ui       design system
tests/unit              fórmulas financeiras
tests/integration       autorização, isolamento, deduplicação, versionamento
docs/                   ADRs e runbook
```

Regra: páginas e actions nunca acessam dados sem passar por um serviço que recebe o `AuthContext`
e verifica permissão + organização no servidor.
