# Relatório final — Sansol Mob Platform (P08, P09 e auditoria P10)

Data: 2026-10-27 · Ambiente: macOS, Node 22.19, PostgreSQL 14.19 local · Commit base: `46cc867` (P06) + alterações não commitadas de P07–P10.

**Veredito: o produto NÃO está pronto para produção.** O núcleo de software está implementado e testado em ambiente local, mas faltam itens obrigatórios que dependem de terceiros, credenciais, hardware ou decisão (gateway de pagamento real, provedores de notificação, homologação de carregadores, deploy/TLS/backup executados, revisão jurídica e contábil). Detalhes no checklist (seção 7).

---

## 1. O que está implementado (e arquivos principais)

### P08 — Financeiro, contratos, parceiros e repasses
| Requisito | Implementação |
|---|---|
| Parceiros, unidades, contratos, aditivos, vigência, anexos, condições, status | `src/server/modules/contracts/service.ts`, `/app/contratos`, `/app/contratos/[id]`, `/app/contratos/novo`; anexos em `src/server/modules/attachments/service.ts` + `/api/anexos/[id]` |
| Versionamento imutável, autor/data/motivo, quatro olhos | `ContractVersion` (original + aditivos), motivo obrigatório, aprovação/recusa por pessoa ≠ autor, decisão condicional contra corrida; auditoria |
| Contas a pagar/receber, despesas, receitas, tributos configuráveis | `src/server/modules/finance/entries.ts`, `/app/financeiro/lancamentos`, `/app/financeiro/tributos` (`TaxRule` versionado por vigência) |
| Conciliação | Conciliação de pagamentos (P07, agora com escopo por operadora) + validações do fechamento (pagamentos não capturados/não conciliados) |
| Royalties e repasses com base contratual aprovada | Motor puro `src/domain/finance/settlement.ts` (`settlement-1.1.0`); bases configuráveis por versão (bruto, líquida, resultado), rateio × compensação de prejuízo |
| Demonstrativo por estação, parceiro, período e rede (bruto, deduções, líquido, provisionado, pago) | `src/server/modules/finance/statement.ts`, `/app/financeiro/demonstrativo` (visões rede/parceiro/unidade/estação) |
| Fechamento: prévia, validações, aprovação, registro imutável, ajuste | `src/server/modules/finance/closing.ts`, `/app/financeiro/fechamento*`: hash SHA-256 do snapshot, recálculo na aprovação (pedido "superado" se os dados mudaram), índices únicos parciais (1 aprovado + 1 pendente por período), período fechado bloqueia lançamentos/cancelamentos/vigências; correção só por ajuste ligado ao período |
| Portal do parceiro | `src/server/modules/partner/portal.ts`, `/app/portal`, `/api/portal/extrato`: indicadores, contratos/documentos visíveis, extratos (somente linhas próprias) |
| Exportações com controle e auditoria | `/api/financeiro/exportar` (`finance:export`), `/api/portal/extrato` (parceiro), proteção contra injeção de fórmulas no CSV, evento de auditoria por exportação e por download de anexo |
| Sem transferência bancária real | `src/server/modules/finance/payouts.ts`: nenhum provedor; `initiatePayout` exige permissão + confirmação e recusa ("não configurada"); fluxo suportado = pagar pelo banco e registrar baixa |

### P09 — Manutenção, suporte, alertas e automações
| Requisito | Implementação |
|---|---|
| Tickets (categoria, prioridade, origem, responsável, estação, anexos, comentários, status, histórico) | `src/server/modules/support/tickets.ts`, `/app/suporte*`; motoristas (P07) viram tickets automaticamente |
| SLA configurável por prioridade/contrato, calendário e pausas documentadas | `src/domain/support/sla.ts` (24×7 ou horário útil America/Belem), `SlaPolicy` (cópia no ticket), pausas com motivo (`PAUSE`/`RESUME`) |
| Ordens de serviço (diagnóstico, peças, custos, técnico, agendamento, checklist, evidências) | `src/server/modules/maintenance/service.ts`, `/app/manutencao`, `/app/manutencao/os/[id]`; conclusão exige checklist completo + evidência; custo vira despesa a pagar |
| Preventiva por tempo, uso ou telemetria confiável | `src/domain/maintenance/plan.ts`; por uso só com estação de produção, comunicação estabelecida e sem sessões com comunicação perdida |
| Alertas (offline, falhas repetidas, queda de disponibilidade, sessão interrompida, divergência de pagamento) | `src/server/modules/alerts/engine.ts` + `rules.ts` |
| Regras configuráveis, deduplicação, limite de frequência, escalonamento | Índice único parcial por chave; cooldown reabre sem notificar; escalonamento único que eleva o ticket |
| Notificações só por adaptador configurado e com consentimento | `src/server/integrations/notify.ts` (nenhum configurado), `NotificationRecipient` (opt-in em Minha conta), outbox `Notification` com deduplicação e retentativa exponencial |
| Painel operacional com fórmulas | `src/server/modules/support/panel.ts`, `/app/suporte/painel` (disponibilidade, indisponibilidade, MTTR, SLA de resposta/solução) |
| Registro de execução, falha e nova tentativa | `AutomationRun` + `src/server/modules/automation/runner.ts`; ciclo a cada minuto no processo OCPP (`scripts/ocpp-server.ts`) e botão manual |

### P10 — Correções da auditoria
| Achado | Evidência | Correção |
|---|---|---|
| **Pagamentos sem escopo de operadora** (lista, detalhe, reembolso e conciliação viam a rede inteira; qualquer 2ª operadora veria pagamentos alheios) | Teste novo falha sem a correção (`expected [ {…} ] to deeply equal []`) | `operatorPaymentScope` em `src/server/payments/service.ts` |
| Sem direito de acesso/eliminação do titular (LGPD) no portal do motorista | Revisão | "Baixar meus dados" (`/api/motorista/meus-dados`) e "Excluir minha conta" (anonimização, preserva registros fiscais) |
| Sem Content-Security-Policy | Revisão de `next.config.ts` | CSP `default-src 'self'` (ver limitações) — verificado sem violações no navegador |
| Sem procedimento de primeiro administrador em produção (seed recusa produção) | Revisão | `npm run setup:first-admin` (recusa se já existir superadmin; testado em banco descartável) |
| Health check não mostrava se as automações rodam | Revisão | `automation: ok/stale/failing/never` sem detalhes internos |
| Página do motorista consultava o banco direto (fora da camada de serviço) | Revisão | `getMyChargeRequest` |
| Arrays de entrada sem limite (advisory de memória do Zod) | `npm audit` | `.max()` nos arrays novos/restantes |
| Receita de recarga lançada externamente aparecia como "outras receitas" | Verificação no navegador (CSV) | motor 1.1.0 + teste |
| Overflow horizontal a 375 px em /app/alertas | Medição no navegador (783 px) | `min-w-0` nos grids, quebra de JSON |

Verificado sem defeito: autorização no servidor em todos os serviços novos (varredura automática: toda função exportada que recebe `ctx` chama `requirePermission`, exceto `getAttachmentForDownload` e `changePassword`, revisadas manualmente); nenhum `$queryRawUnsafe` em `src/`; único `dangerouslySetInnerHTML` é o SVG gerado pela biblioteca de QR a partir de URL codificada; cookies `httpOnly`, `sameSite=lax`, `secure` em produção; sem cabeçalhos CORS (só mesma origem); upload valida tipo pela assinatura do arquivo, limita 5 MB, sanitiza nome e é servido como download com `CSP: sandbox` e `nosniff`; logs mascaram senha/token/segredo/cartão; destino de notificação não é exibido na tela nem logado.

## 2. Testes realmente executados

Executados em 2026-10-27 nesta máquina (saída real resumida):
```
npx vitest run              → Test Files 16 passed (16) · Tests 170 passed (170) · 180,8 s
npm run lint                → 0 problemas
npm run typecheck           → 0 erros
npm run build               → ✓ Compiled successfully · 74 rotas
npm audit --omit=dev        → 7 vulnerabilidades (6 altas, 1 moderada, 0 críticas)
```
Antes desta etapa: 11 arquivos / 127 testes. Novos: `finance.test.ts` (11), `support.test.ts` (11), `resilience.test.ts` (3), `settlement.test.ts` (10), `sla-maintenance.test.ts` (6), `payments.test.ts` +2 (isolamento entre operadoras, LGPD).

**Falhas reais encontradas pelos testes e tratadas:** 1ª execução de `support.test.ts` → 3 falhas: uma revelou alerta duplicado (estação offline gerava também "queda de disponibilidade") → **corrigido no código**; duas eram premissas erradas do teste (descrição curta demais; após reconectar, ausência de evidência de status corretamente gera alerta de disponibilidade). `resilience.test.ts` → 2 falhas causadas pelo próprio teste (mock do cliente Prisma) → teste corrigido. Teste de isolamento de pagamentos: **falha sem a correção** (`expected [ {…} ] to deeply equal []`) e passa com ela.

**Fluxos críticos e onde estão cobertos**
| Fluxo | Cobertura |
|---|---|
| Login, sessões, revogação, recuperação de senha | `identity`, `authz`, `audit-findings` (P02) |
| Permissões e isolamento entre organizações | `authz`, `crm`, `ocpp`, `finance` (parceiro × parceiro, operadora × operadora), `support`, `payments` (novo) |
| Cadastro de estação, sessão de recarga, OCPP | `ocpp` (inclui WebSocket real com simulador) |
| Webhook idempotente, falha de pagamento, rede indisponível | `payments` (P07) |
| Cálculo financeiro, arredondamento, royalties | `settlement` (unit, 10) + `finance` (fórmula conferida à mão: 1.000 → 60 → 100 → 840 → 67,20 → 300 → 472,80 → 236,40) |
| Fechamento, reprocessamento, período fechado, ajuste | `finance` (prévia idempotente, pedido superado, bloqueios, ajuste sem alterar hash) |
| Concorrência | aprovações simultâneas de fechamento (1 vence), avaliações de alerta simultâneas (1 alerta), geração de preventiva simultânea (1 OS), aprovações de versão condicionais |
| Banco indisponível, erro inesperado, estados vazios | `resilience` (health 503 sem detalhes; mensagem genérica; telas sem dados) |
| Repetição de requisições | webhook duplicado, StartTransaction repetido, solicitação de fechamento duplicada, baixa duplicada, importação de solicitações de motorista |

**Navegador (dev, http://localhost:3001, usuários de teste):** unidade vinculada ao parceiro → tributo 6% → contrato criado pelo admin A (UI bloqueia a autoaprovação) → aprovado pelo admin B → lançamentos de set/2026 → prévia com os mesmos valores do cálculo manual → solicitação (B, bloqueado de aprovar) → aprovação (A) → "Fechado (aprovado) · Registro íntegro", repasse R$ 236,40 provisionado com vencimento 11/10/2026 → CSV do demonstrativo → login do parceiro: portal com contrato, extrato próprio (provisionado R$ 236,40 · pago R$ 0,00), CSV do extrato com 1 linha; `/api/financeiro/exportar` → 403; 8 telas internas redirecionam para "sem permissão" sem nenhum dado no HTML. Ticket com SLA copiado (60 min/8 h), pausa sem motivo recusada, pausa com motivo registrada. Avaliação de alertas manual (5 regras, 3 execuções registradas) e canais exibidos como "NÃO configurado". CSP ativa sem violações no console (site público, backoffice, portal do motorista, server action). 375 px sem rolagem horizontal em fechamento, ticket, alertas, contrato, manutenção, painel e lançamentos. `/api/health` → `{"status":"ok","db":"ok","automation":"ok"}`.

**Implantação inicial (banco descartável `sansol_bootstrap_check`, apagado depois):** `npm run setup:first-admin` → 1 usuário, 9 perfis, 5 regras de alerta, 4 políticas de SLA, 7 etapas, **0** versões de modelo comercial; reexecução → recusada; senha fraca → recusada.

**Não executados:** E2E automatizado (Playwright não instalado), axe automatizado (bloqueado pela política do ambiente no P03; agora também pela CSP para scripts externos), build/execução Docker, pipeline de CI, teste de carga, teste de restauração de backup.

## 3. O que foi testado apenas em simulação
- **Pagamentos**: só com o gateway *sandbox* (P07) e, no P08, com pagamentos de produção **inseridos diretamente no banco de teste** para exercitar o fechamento. Nenhum dinheiro real, nenhum gateway real.
- **Carregadores**: apenas simulador OCPP 1.6-J próprio e eventos injetados nos testes; nenhum hardware.
- **Notificações**: adaptadores **falsos** dentro dos testes (sucesso, falha, retentativa). Nenhum e-mail/SMS/WhatsApp enviado.
- **Automações**: o ciclo do processo OCPP não foi executado continuamente; foi exercitado por chamadas diretas nos testes e pelo botão "Executar avaliação agora" no navegador.
- **Receita no navegador**: o fechamento de demonstração (2026-09, dev) usou receita lançada manualmente, porque produção não tem gateway.

## 4. Dependências de credenciais, hardware, fornecedor ou decisão comercial
- Gateway de pagamento real (Pix/cartão): contratação, credenciais, homologação e adaptador.
- Provedor bancário/PSP para repasses automáticos (opcional; hoje baixa manual).
- Provedores de e-mail, SMS e WhatsApp (e templates aprovados no WhatsApp Business).
- Hardware: cada fabricante/modelo de carregador precisa de homologação em bancada; OCPP 2.0.1 não implementado; sem OCTT.
- Contador habilitado: validar tributos (hoje % sobre o bruto), regime, retenções, NF-e/NFS-e (não implementadas).
- Jurídico/DPO: textos de privacidade/termos, base legal e **prazo de retenção** após exclusão de conta, modelo de contrato e assinatura eletrônica (não implementada).
- Decisões comerciais pendentes registradas no P01 (31,125 dias/mês, custo de energia implícito, royalty 50/50, base "bruto recebido").
- Infraestrutura: hospedagem, TLS, backup automatizado, monitoramento/alertas de infraestrutura, agregador de logs.

## 5. Bugs conhecidos, riscos e limitações
- `npm audit --omit=dev`: 6 altas + 1 moderada (Next/postcss, Zod, dependências do Prisma) — exigem upgrades major (Next 16, Zod 4, Prisma 7); não aplicados. Mitigação parcial: limites de tamanho nas entradas, corpo de server action limitado a 6 MB.
- CSP usa `'unsafe-inline'` em scripts (App Router sem nonce). Endurecer com nonce por requisição.
- Fechamento não faz rateio por dia: troca de condição contratual ou de tributo no meio do mês **bloqueia** o fechamento (a vigência deve começar no dia 1).
- Reembolso ocorrido depois do fechamento não altera o período: exige lançamento de ajuste manual (não há geração automática).
- Despesas sem unidade não são rateadas com parceiros (entram só no resultado da rede).
- Feriados não são considerados no SLA em horário útil.
- MTTR usa relógio corrido; SLA usa o calendário da política.
- `SupportRequest` sem sessão vai para a operadora mais antiga (rede com uma operadora; revisar se houver várias).
- Escalonamento notifica os mesmos destinatários consentidos (não há cadeia de escalonamento por pessoa).
- Recuperação de senha por e-mail, convite de usuário e MFA: dependem de provedor de e-mail (não configurado).
- Redirecionamento de páginas sem permissão responde HTTP 200 com instrução de redirect (comportamento do streaming do Next); nenhum dado é enviado (verificado).
- Isolamento multiempresa é feito na camada de serviço (sem RLS no Postgres).
- E2E automatizado (Playwright) e auditoria de acessibilidade automatizada (axe) **não executados** (ver checklist).
- Docker/compose e CI: escritos, **não executados** neste ambiente.

## 6. Como executar localmente
```bash
cp .env.example .env              # ajuste DATABASE_URL, TEST_DATABASE_URL, APP_SECRET, SEED_ADMIN_PASSWORD
npm ci
npm run db:deploy                 # migrações
npm run db:seed                   # perfis, operadora, funil, modelos de referência, alertas/SLA padrão, superadmin de dev
npm run dev:users                 # opcional: 2 admins + financeiro + parceiro de teste (senha em .env.dev-users)
npm run dev                       # http://localhost:3000
npm run ocpp:server               # outro terminal: OCPP + ciclo de automações a cada minuto
npm run ocpp:simulate -- <identidade> <senha> interativo   # estação SIMULATED
npm run lint && npm run typecheck && npm test
npm run build                     # pare o npm run dev antes
```
Fluxo de verificação manual de P08: Unidades (vincular parceiro) → Tributos → Contratos/novo (admin A) → aprovar versão (admin B) → Lançamentos do mês anterior → Fechamento → Solicitar (B) → Aprovar (A) → Demonstrativo/CSV → entrar como parceiro → Portal.

## 7. Checklist de produção

| # | Item | Situação | Evidência / bloqueio |
|---|---|---|---|
| 1 | Lint, tipos, testes e build verdes | ✅ APROVADO | Seção 2 |
| 2 | Autorização no servidor em todos os serviços e rotas | ✅ APROVADO | Varredura + testes de permissão/isolamento |
| 3 | Isolamento multiempresa | ✅ APROVADO (camada de serviço) | Testes; 🟡 sem RLS no banco |
| 4 | Sessões revogáveis, cookies seguros, rate limit de login | ✅ APROVADO | P02 + revisão |
| 5 | Upload de arquivos seguro | ✅ APROVADO | Assinatura de tipo, 5 MB, download com sandbox |
| 6 | Cabeçalhos de segurança + CSP | 🟡 APROVADO com ressalva | CSP com `'unsafe-inline'` em script |
| 7 | Sem segredos/senhas/cartões em logs e no código | ✅ APROVADO | Redação no logger; `.env*` ignorado; nenhum cartão armazenado |
| 8 | Dependências sem vulnerabilidade alta | ❌ REPROVADO | 6 altas exigem upgrade major (Next 16, Zod 4, Prisma 7) |
| 9 | LGPD: consentimento, acesso, eliminação (motorista) | 🟡 APROVADO parcial | Implementado e testado; prazo de retenção e textos legais pendentes de jurídico/DPO; pedidos de leads/usuários internos são manuais |
| 10 | Pagamentos reais | ⏳ PENDENTE (bloqueado) | Sem gateway contratado; produção bloqueada por código |
| 11 | Repasses bancários automáticos | ⏳ PENDENTE (bloqueado) | Sem provedor; baixa manual |
| 12 | Notificações e-mail/SMS/WhatsApp | ⏳ PENDENTE (bloqueado) | Nenhum adaptador; nenhum envio real testado |
| 13 | Carregadores reais homologados | ⏳ PENDENTE (bloqueado) | Só simulador; sem OCTT |
| 14 | Validação contábil/fiscal das fórmulas | ⏳ PENDENTE | Contador habilitado; NF não implementada |
| 15 | Textos jurídicos (privacidade, termos, contrato) | ⏳ PENDENTE | Minutas para revisão |
| 16 | Deploy, TLS (wss:// e https://), domínio | ⏳ PENDENTE | Não executado (sem autorização/infra) |
| 17 | Backup automatizado e teste de restauração | ⏳ PENDENTE | Procedimento escrito; nunca executado |
| 18 | Monitoramento/alertas de infraestrutura e agregador de logs | ⏳ PENDENTE | Health check pronto; sem ferramenta configurada |
| 19 | Docker/compose e CI executados | ⏳ PENDENTE | Arquivos existem; daemon Docker parado; CI depende de push |
| 20 | E2E automatizado e acessibilidade automatizada | ⏳ PENDENTE | Infra não disponível neste ambiente |
| 21 | MFA para administradores | ⏳ PENDENTE | Depende de provedor de e-mail/TOTP (não implementado) |
| 22 | Ambientes separados (dev/teste/sandbox/produção) | ✅ APROVADO (código) | Guardas no seed, testes, sandbox só em TEST, comandos de produção bloqueados por padrão; separação de infraestrutura pendente (16) |
| 23 | Primeiro administrador e implantação inicial | ✅ APROVADO | `setup:first-admin` testado em banco descartável |
| 24 | Runbook (variáveis, migrações, backup, restauração, monitoramento, rollback) | ✅ APROVADO (documento) | `docs/runbook.md`; execução real pendente (16–18) |

Itens ❌/⏳ impedem declarar prontidão para produção.
