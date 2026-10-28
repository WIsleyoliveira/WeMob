# Relatório final técnico — P16

Data: 2026-10-28 · Commit de partida: `c783402` (confirmado no histórico; árvore limpa; branch `main`) · Ambiente: máquina local (Node 22.19, npm 10.9.3, PostgreSQL 14) + **Asaas sandbox oficial**. Nenhum push, deploy, operação financeira real ou habilitação de produção.

Estados: **CONCLUÍDO COM EVIDÊNCIA** · **PARCIAL / BLOQUEADO** · **PENDENTE**. "Evidência" distingue: código, teste automatizado (servidor Asaas falso / carregador simulado), **sandbox real** e produção (nenhum item).

## 1. Inventário de pendências encontradas (P0–P3) e destino
| # | Prioridade | Achado | Destino |
|---|---|---|---|
| 1 | **P0** | Recarga sem limite financeiro: o consumo só parava pelo motorista/veículo (risco de energia não paga) | corrigido — limite por sessão + parada remota + contingência |
| 2 | **P0** | Estorno com resultado ambíguo (HTTP 5xx/rede após envio) marcado como **recusado** — podia esconder estorno feito ou levar a reenvio manual em dobro | corrigido — "resultado incerto" + consulta pelo marcador antes de reenviar |
| 3 | **P1** | Estorno parcial de cartão recusado no mesmo dia virava falha definitiva; acerto do fim da recarga no cartão sempre ia para análise | corrigido — `SCHEDULED` + retentativa automática no dia seguinte |
| 4 | **P1** | Retentativa de webhook sem espera (consulta ao Asaas a cada 30 s por evento) e fila presa pelos 100 eventos mais antigos | corrigido — espera crescente 1→60 min, ordem por vencimento |
| 5 | **P1** | Tela de pagamento mostrava saldo estornável sem descontar estornos agendados/em andamento (o servidor já bloqueava) | corrigido |
| 6 | P2 | Conciliação só manual | corrigido — job horário auditável |
| 7 | P2 | Base do repasse do contrato vinha pré-selecionada ("Resultado operacional") | corrigido — escolha explícita obrigatória |
| 8 | P2 | Split habilitado em produção sem trava de política/recebedor de produção | corrigido — `productionReadiness` bloqueia |
| 9 | P2 | Sem limite de requisições em pedir recarga (cada pedido cria cobrança no Asaas), abrir chamado e login de motorista por IP | corrigido |
| 10 | P2 | Parada por limite sem efeito não era repetida | corrigido — até 5 tentativas, sem sobrepor pendentes |
| 11 | P2 | Alertas ausentes: parada não confirmada, perto do limite, sem telemetria, webhook não processado, estorno agendado não reprocessado, pagamento em análise | corrigido |
| 12 | P2 | Dependências de desenvolvimento com 1 crítica (vitest < 3.2.6) + 1 crítica (tinypool) | corrigido (vitest 3.2.7, tinypool 2.1.2) — restam 2 moderadas |
| 13 | P3 | `@vitest/mocker` moderado (exige vitest 4.1.12) | bloqueado — bug do npm 10.9.3 (`edgesOut`, ciclo de dependências de pares opcionais) |
| 14 | P3 | E2E automatizado (Playwright) e acessibilidade automatizada | pendente — não instalados no ambiente |

Varredura sem achados: TODO/FIXME/stubs, `any`, `console.log` fora do logger, `eslint-disable`/`@ts-ignore`, rotas de debug (7 rotas de API, todas autorizadas no serviço), redirecionamento aberto (`safeNext`), nome de anexo (`safeFilename`), webhook do provedor local (HMAC com segredo próprio).

## 2. Correções implementadas (arquivos principais)
- **Estornos**: `src/domain/payments/refund.ts` (classificação pura), `src/server/payments/service.ts` (`dispatchRefund`, `retryDueRefunds`, `retryRefundNow`, saldo com agendados, conciliação `REFUND_RETRY_OVERDUE`), `src/app/actions/payments.ts`, `src/app/app/pagamentos/[id]/page.tsx`.
- **Limite financeiro**: `src/domain/charging/limit.ts`, `src/server/drivers/charging.ts` (`checkSessionLimit`, `enforceSessionLimits`, `retryLimitStops`), `src/server/ocpp/handler.ts` (gancho `onMeter`), `scripts/ocpp-server.ts`, `src/app/motorista/recarga/[id]/page.tsx` (barra de uso do limite).
- **Webhooks/conciliação/alertas**: `PaymentEvent.nextAttemptAt` + `webhookRetryAt`, `reconcileAutomatically`, `src/server/modules/automation/runner.ts`, `src/server/modules/alerts/engine.ts`.
- **Split/contratos**: `src/server/payments/activation.ts`, `src/components/app/contract-terms-fields.tsx`.
- **Segurança**: `src/server/drivers/auth.ts`, `src/server/drivers/service.ts`, `src/app/actions/driver.ts`.
- **Banco**: migrations `20261028150000_refund_retry_session_limit` (enum `SCHEDULED`, colunas de estorno e de limite) e `20261028160000_payment_event_retry_backoff`, ambas aditivas com `down.sql` testado.
- **Dependências**: `vitest` 3.2.7, override `vitest → tinypool 2.1.2`.

## 3. Testes e verificações executados (saída real)
| Comando | Resultado |
|---|---|
| `npm test` | **18 arquivos, 222 testes passando** (eram 210; +12 de estorno, limite, webhook, conciliação e split) |
| `npm run lint` / `npm run typecheck` | saída 0 / saída 0 |
| `NEXT_DIST_DIR=.next-build npm run build` | **sucesso** (saída 0, "Compiled successfully", 76 rotas; pasta removida; `tsconfig.json` restaurado) |
| Migrations em banco vazio | **12 aplicadas**, `migrate diff` banco × schema sem diferença; índices parciais e enum `{REQUESTED,SUCCEEDED,FAILED,SCHEDULED}` presentes |
| Atualização incremental | banco de desenvolvimento migrado passo a passo (as 3 novas desta etapa) sem divergência |
| `down.sql` das 2 migrations do P16 | executado em banco temporário: enum e colunas revertidos |
| `npm audit --omit=dev` | **0 vulnerabilidades** |
| `npm audit` (inclui dev) | **2 moderadas** (`@vitest/mocker`, `vitest`), 0 altas/críticas |
| Teste que prova o defeito do P15 | falha no código antigo, passa no novo (registrado no P15) |

Testes novos relevantes: estorno agendado→concluído uma vez; timeout após processar (não reenvia); 503 antes de processar (reenvia uma vez); 5 tentativas com execuções concorrentes (um envio por vez); acerto do cartão agendado; limite com aviso, parada única, varredura por tempo, contingência e excedente em análise; repetição da parada até 5×; espera crescente e fila sem bloqueio; conciliação horária sem ajustes; trava de split em produção.

## 4. Situação por área
| Item | Estado | Evidência / motivo |
|---|---|---|
| Pix: criação, QR, pagamento, idempotência, cancelamento | **CONCLUÍDO COM EVIDÊNCIA** | sandbox real (P14/P15) + testes |
| Cartão: criação, pagamento, confirmação por webhook | **CONCLUÍDO COM EVIDÊNCIA** | sandbox real (P15) |
| Confirmação nunca pelo retorno do checkout | **CONCLUÍDO COM EVIDÊNCIA** | status só por `GET /payments/{id}` (webhook/consulta); página do cartão abre em outra aba sem retorno |
| Webhook: autenticação, gravação antes de processar, duplicado, fora de ordem, falha e reenvio | **CONCLUÍDO COM EVIDÊNCIA** | sandbox real (P15: aprovado, falha+reenvio) + chamadas simuladas + testes; espera crescente: testes |
| Estorno: estados, tentativas, incerteza, saldo, revisão manual | **CONCLUÍDO COM EVIDÊNCIA** (código/testes) | 5 testes + sandbox real até `SCHEDULED` |
| Estorno parcial de cartão concluído após a janela | **PENDENTE** (externo, data) | agendado para 2026-10-29 06:00 BRT; executar `retryDueRefunds` (ciclo OCPP ou "Tentar agora") e conferir `DONE`/`confirmedAmount` |
| Conciliação | **CONCLUÍDO COM EVIDÊNCIA** (código/testes) | manual + horária; nunca ajusta sozinha |
| Split no sandbox | **PARCIAL / BLOQUEADO** | falta `walletId` de segunda conta sandbox; Asaas não informa elegibilidade Pix/cartão |
| Split em produção | **CONCLUÍDO COM EVIDÊNCIA** (trava) | bloqueado sem política aprovada e recebedor de produção (teste) |
| Regra 50/50 (bruto × líquido) | **PENDENTE** (decisão comercial) | parametrizada por contrato, escolha explícita obrigatória |
| Limite financeiro da sessão | **CONCLUÍDO COM EVIDÊNCIA** (simulador) | 4 testes pelo handler OCPP; **não validado em carregador físico** |
| OCPP 1.6-J (Boot, Heartbeat, Status, Authorize, Start/Stop, MeterValues, Remote Start/Stop) | **PARCIAL** | testado com simulador/handler; nenhum carregador físico homologado |
| Barra de limite na tela da recarga | **PARCIAL** | compila e tipa; não vista no navegador (sem sessão ativa no ambiente de desenvolvimento) |
| Vulnerabilidades de produção | **CONCLUÍDO COM EVIDÊNCIA** | `npm audit --omit=dev` = 0 |
| Vulnerabilidades de desenvolvimento | **PARCIAL / BLOQUEADO** | 2 moderadas; vitest 4 bloqueado pelo npm 10.9.3 |
| E2E/acessibilidade automatizados | **PENDENTE** | ferramentas não instaladas |
| Deploy, DNS, TLS, cofre, backup automático, monitoramento | **PENDENTE** (autorização/infra) | plano em `docs/staging.md` |

## 5. Dependências externas (não concluíveis sem terceiros)
| Item | Responsável pela próxima ação | Bloqueio |
|---|---|---|
| Estorno parcial de cartão após a janela | equipe técnica, a partir de 29/10 06:00 BRT | data |
| Permissão de estornos na conta de produção ("autorização de ação crítica") | responsável comercial + Asaas | conta de produção |
| Segundo recebedor e split no sandbox; elegibilidade por método | responsável comercial / Asaas | credencial (carteira) |
| Base do 50/50 | sócios/jurídico | decisão comercial |
| Credenciais e habilitação de produção (duas pessoas) | superadministradores | autorização |
| Carregadores físicos, conectividade e estabilidade em campo | operação + fabricante | equipamento |
| Deploy, domínio, TLS, monitoramento | responsável técnico | autorização/infra |

## 6. Riscos residuais
- Limite financeiro depende de MeterValues e de o carregador aceitar `RemoteStopTransaction`; com carregador offline o limite não para a recarga — há alerta de contingência e o excedente fica em análise.
- Margem padrão de 10% é uma escolha técnica conservadora; calibrar com o intervalo real de MeterValues de cada fabricante.
- Retentativa após resultado incerto assume que o gateway reflete o estorno na consulta (verificado no sandbox para o fluxo normal; não para falhas reais do Asaas).
- Tudo que roda no ciclo do servidor OCPP para se ele cair (monitorado por `/api/health`).

## 7. Git
Commit local desta etapa: `7a98acd` (sobre `c783402`). Nenhum push, deploy ou operação financeira real.
