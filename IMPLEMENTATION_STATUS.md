# IMPLEMENTATION_STATUS — Sansol Mob Platform

Atualizado em 2026-10-27 · Etapa concluída: **Fase 1 (auditoria) + Fase 2 (fundação) + primeira fatia da Fase 3**.

Legenda: ✅ implementado e testado · 🟡 parcial · ⏳ pendente · ⛔ bloqueado por dependência externa

## 1. Diagnóstico inicial (Fase 1)
- Repositório **vazio** em 2026-10-27: nenhum código, banco, rota ou teste preexistente. Nada a preservar.
- Ambiente: Node 22.19, npm 10.9, PostgreSQL 14.19 local, Docker instalado com daemon parado, sem Redis.
- Fonte de negócio: `Portfolio_Comercial_Sansol_Mob.pptx` (14 slides). Inconsistências encontradas — **precisam de decisão comercial**:

| # | Slide | Achado | Tratamento |
|---|---|---|---|
| 1 | 8 e 10 | Faturamento de R$ 17.928 com 60 kW × 4 h × R$ 2,40 implica **31,125 dias/mês** (7.470 kWh). | Simulador usa 365/12 = 30,42 dias, editável e exibido. |
| 2 | 8 e 10 | Custo operacional = 65,16% do bruto + R$ 150 fixo em todas as colunas → energia implícita ≈ 40,2% do bruto (≈ R$ 0,96/kWh). O custo de energia não está declarado. | Valor 0,96 usado só como premissa inicial editável, com aviso para usar a tarifa real. |
| 3 | 10 | Tabela do modelo 50/50 repete os custos do modelo 100% (royalty 5% em vez de 8%) e mostra **"Retorno anual R$ 73.152"**, mas 50% × R$ 6.096 × 12 = **R$ 36.576**. | Motor calcula com 8% e divide resultado; não replica o erro. |
| 4 | 12 × 13 | Manutenção no 50/50: "Sansol Mob" (slide 12) × "quando houver" (slide 13). | Campo `maintenancePolicy` por versão; texto atual "cobrada quando houver, conforme contrato". |
| 5 | 13 | Royalty 50/50 "sobre o faturamento bruto **recebido**" — base exata não definida. | Base configurável por versão (bruto ou bruto após taxa de sistema). Seed usa bruto. |
| 6 | 3 e 7 | "Frota +200% na região Norte" e "redução de até 20% na energia" sem fonte. | **Não publicados** no site. Usina citada apenas como possibilidade sujeita a análise. |

## 2. Fundação (Fase 2)

| Requisito | Status | Evidência |
|---|---|---|
| Stack TypeScript/Next.js/Prisma/Postgres | ✅ | `docs/adr/0001-stack.md`; `npm run build` OK |
| Migrações versionadas | ✅ | `prisma/migrations/*_init` |
| Seed apenas de desenvolvimento, sem dados operacionais fictícios | ✅ | `prisma/seed.ts` (recusa `NODE_ENV=production`) |
| Organizações (operadora / investidor / parceiro) e vínculos | ✅ | `Organization`, `Membership` |
| Autenticação com sessões revogáveis (hash do token em banco, cookie httpOnly) | ✅ | `src/server/auth/session.ts`; testes "logout revoga", "perde acesso após revogação" |
| RBAC recurso:ação + 9 perfis de sistema + perfis por organização | ✅ | `src/server/auth/permissions.ts`, `Role` |
| Autorização no backend em todo serviço | ✅ | `requirePermission` em todos os serviços; testes de autorização |
| Isolamento entre organizações | ✅ | testes "outra organização não lê leads", "parceiro vê somente as próprias unidades" |
| Rate limit (login e formulários) | ✅ | `src/server/rate-limit.ts` (upsert atômico); teste "limita envios por IP" |
| Auditoria de ações críticas | ✅ | `AuditEvent`; tela `/app/auditoria` |
| Cabeçalhos de segurança, CSRF (Origin check das server actions) | ✅ | `next.config.ts` |
| Health check | ✅ | `GET /api/health` → `{"status":"ok","db":"ok"}` verificado |
| Design system (tokens, botões, campos, cards, badges, alertas, tabelas, estados vazios, KPI com fonte) | ✅ | `src/app/globals.css`, `src/components/ui/*` |
| Docker / compose / CI | 🟡 | Arquivos criados; **não executados** aqui (daemon Docker parado; CI depende de push ao GitHub) |
| Recuperação de senha por e-mail, convite de usuários, MFA | ⏳ | Depende de provedor de e-mail |
| RLS no Postgres | ⏳ | Isolamento hoje na camada de serviço (testado) |
| Logs estruturados completos, métricas, correlation IDs | 🟡 | Erros de action em JSON; restante pendente |

## 3. Núcleo comercial (Fase 3) — primeira fatia

| Requisito | Status | Evidência |
|---|---|---|
| Modelos comerciais A e B cadastrados a partir do portfólio | ✅ | `src/domain/commercial/reference.ts`; seed v1 com nota de origem |
| Versionamento, vigência, aprovação por 2º administrador, imutabilidade | ✅ | `approveVersion`; teste "nova taxa vale para novas simulações sem alterar as já registradas" |
| Base de cálculo de cada taxa configurável; sem base circular | ✅ | `FeeBase`; teste "rejeita base circular" |
| Simulador: energia limitada por potência/disponibilidade/limite de conexão, eficiência | ✅ | 22 testes unitários (`tests/unit/viability-engine.test.ts`) |
| Receita, taxas, tributos, royalty, energia, fixos, resultado operacional, parte de cada sócio | ✅ | idem |
| Fluxo mensal, payback, ROI, retorno 1º ano, VPL (com taxa), TIR, ponto de equilíbrio | ✅ | idem (inclui VPL na TIR ≈ 0) |
| Sensibilidade (utilização, preço, energia, fixos ±10/20%), cenários e comparação de modelos | ✅ | idem + UI |
| Projeções identificadas, com premissas, fórmulas, data e versão do motor | ✅ | `SimulatorResults` |
| Simulação salva recalculada no servidor com termos do banco (ignora termos do cliente) | ✅ | teste "ignora termos enviados pelo cliente"; E2E no navegador |
| Sazonalidade (12 multiplicadores) | 🟡 | Suportada no motor; sem campo na interface |
| Portal institucional (home, segmentos, jornada, modelos, simulador, FAQ, contato, privacidade, termos, SEO) | ✅ | `src/app/(public)/*`, `robots.ts`, `sitemap.ts` |
| Formulário de viabilidade → CRM (validação, honeypot, tempo mínimo, limite por IP, consentimento LGPD, dedupe concorrente) | ✅ | 5 testes de integração + E2E no navegador |
| CRM: kanban, lista, filtros, busca, detalhe, histórico, notas/ligações/reuniões, responsável, motivo de perda, leads parados | ✅ | `/app/crm*`; teste "exige motivo de perda" |
| CRM: tarefas/lembretes, propostas, anexos, exportação, etapas editáveis na UI, conversão em contrato | ⏳ | Próxima fatia |
| Agendamento de reunião | ⏳ | Depende de integração de calendário |
| Mapa de unidades públicas | ⏳ | Não há dados reais de unidades |
| Textos legais | 🟡 | Minutas marcadas para revisão jurídica/DPO |
| Portal do investidor/parceiro | 🟡 | Login e `/app/unidades` com escopo por organização; demonstrativos dependem da Fase 5 |
| Contratos, documentos, assinatura eletrônica | ⏳ ⛔ | Assinatura depende de provedor real |

## 4. Fases seguintes
| Fase | Status | Bloqueios externos |
|---|---|---|
| 4 — Unidades, carregadores, OCPP, telemetria, manutenção | ⏳ (só `Site` mínimo) | Modelos/fabricantes dos carregadores e versão OCPP suportada |
| 5 — Pagamentos, conciliação, royalties, repasses, fechamento | ⏳ | Escolha do gateway e credenciais de sandbox |
| 6 — Portal do motorista | ⏳ | Depende das Fases 4 e 5 |
| 7 — Analytics, notificações | ⏳ | Provedores de e-mail/SMS/WhatsApp |
| 8 — Homologação | ⏳ | — |

O painel executivo mostra hoje **apenas** indicadores comerciais reais; receita de recarga, kWh, sessões e pagamentos
aparecem como "indisponíveis" até existir integração.

## 5. Testes executados (resultado real)
Comando: `npx vitest run` — 2026-10-27 10:16 (horário local)
```
✓ tests/integration/authz.test.ts      (15 tests)
✓ tests/unit/viability-engine.test.ts  (22 tests)
✓ tests/integration/commercial.test.ts (3 tests)
Test Files 3 passed (3) · Tests 40 passed (40)
```
Também: `npm run lint` (0 problemas), `npm run typecheck` (0 erros), `npm run build` (OK, 20 rotas).

Verificação manual no navegador (dev, localhost):
- Formulário `/contato` → lead gravado com consentimento e evento `lead.created`.
- Login do superadmin → painel exibindo o lead real.
- `/app/crm/[id]`: mover para "Perdido" sem motivo é bloqueado; mover para "Qualificação" funciona.
- `/app/simulador`: salvar simulação → recalculada no servidor e listada.
- Largura 375 px: sem rolagem horizontal em `/`, `/simulador`, `/modelos`, `/app/crm` (overflow corrigido em tabelas do simulador).

Não executados: build Docker, pipeline de CI, testes E2E automatizados (Playwright), auditoria de acessibilidade automatizada.

## 6. Riscos conhecidos
- `npm audit --omit=dev`: 6 altas e 1 moderada que só se resolvem com upgrades major (Next 16, Prisma 7, Zod 4).
  Mitigação parcial: limites de tamanho nas entradas validadas. CI falha apenas em vulnerabilidade crítica até o upgrade.
- Fórmulas tributárias e contábeis são gerenciais; precisam de validação por contador habilitado antes de uso oficial.
- Aprovação de versões exige dois administradores: com um único admin cadastrado não é possível aprovar novas versões (intencional).

## 7. Próxima etapa concreta
1. CRM: tarefas e lembretes, propostas vinculadas a simulações, etapas configuráveis, exportação autorizada, notificações internas de leads parados.
2. Fase 4: cadastro completo de unidades/equipamentos/conectores com histórico de status e simulador OCPP 1.6J isolado (marcado como simulado).
3. Testes E2E com Playwright nos fluxos validados manualmente.
