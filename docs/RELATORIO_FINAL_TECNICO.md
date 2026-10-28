# Relatório final técnico — P16 e auditoria de aceitação P17

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


---

# Auditoria final de aceitação — P17 (2026-10-28)

Commit inicial: `1a99aca` (sobre `7a98acd` e `c783402`; árvore limpa; `main`). Commit final: `9f2f0da` (código e relatório) + este registro. Nenhum push, deploy, operação financeira real, alteração de `.env` ou migração destrutiva.

## 1. Inventário de integrações
| Integração | Endpoint / versão | Autenticação | Erros, timeout, idempotência | Evidência |
|---|---|---|---|---|
| Asaas — clientes | `POST /v3/customers` | header `access_token` (chave por ambiente), `User-Agent` | 400/401/404/429/5xx → `AsaasError` tipado; timeout `ASAAS_TIMEOUT_MS`; `externalReference` por motorista+documento | sandbox real (P14–P16) |
| Asaas — cobranças | `POST /v3/payments` (PIX, CREDIT_CARD), `GET /v3/payments/{id}`, `GET /v3/payments?externalReference=`, `DELETE /v3/payments/{id}` | idem | criação idempotente por `charge:<pedido>` + `PaymentOperation`; timeout → busca pela chave, nunca reenvio cego; status só por `GET` | sandbox real + testes |
| Asaas — QR Pix | `GET /v3/payments/{id}/pixQrCode` | idem | falha → painel "QR indisponível", sem bloquear | sandbox real |
| Asaas — estorno | `POST /v3/payments/{id}/refund` (`value`, `description` com marcador) | idem | ver seção 2; concluído só com `refunds[].status = DONE` | sandbox real: recusa "próximo dia" → `SCHEDULED`; formato de `refunds[]` conferido |
| Asaas — webhooks (entrada) | `POST /api/payments/webhooks/asaas`, header `asaas-access-token` | comparação em tempo constante com `ASAAS_WEBHOOK_TOKEN` | evento gravado antes de processar; duplicado por `(provider, eventId)`; estado sempre por `GET`; retentativa 1→60 min | sandbox real (P15) + testes |
| Asaas — gestão de webhooks | `GET/POST/PUT/DELETE /v3/webhooks` (só script, só sandbox) | idem | — | sandbox real (P15) |
| Gateway local simulado | `POST /api/payments/webhooks/sandbox` | HMAC-SHA256 (`PAYMENT_SANDBOX_WEBHOOK_SECRET`) | só estações TEST; claramente "simulado" | testes |
| OCPP 1.6-J (entrada, WebSocket) | Boot, Heartbeat, Status, Authorize, Start/StopTransaction, MeterValues; saída: RemoteStart/Stop, Reset, Unlock, ChangeAvailability | HTTP Basic por estação | idempotência por `(estação, direção, UniqueId)`; comando 30 s → TIMEOUT pelo relógio do banco (sobrevive a reinício) | simulador/handler + testes; **sem carregador físico** |
| Notificações (e-mail/SMS/WhatsApp) | — | — | fila com consentimento; **nenhum adaptador configurado** (limitação documentada) | testes com adaptador falso |
| Google Maps | link de saída (sem API) | — | — | — |

Não há mocks fora dos testes (`fake-asaas.ts` só em `tests/`); URLs base do Asaas conferem com a documentação oficial (`api-sandbox.asaas.com/v3`, `api.asaas.com/v3`).

## 2. Defeitos encontrados e corrigidos no P17
| # | Defeito | Reprodução | Correção | Regressão |
|---|---|---|---|---|
| 1 | **"Tentar agora" durante a retentativa automática enviava o estorno duas vezes** (o manual sobrescrevia a reserva do ciclo) | teste com gateway lento: 3 envios ao Asaas em vez de 2 | reserva com valor único + `remoteStatus RETRYING`; reenvio só por atualização condicional à reserva; manual recusa reserva ativa | teste P17 de concorrência |
| 2 | Estorno parado em `AWAITING_CRITICAL_ACTION_AUTHORIZATION` (status real do sandbox) não gerava alerta | auditoria do motor de alertas | alerta `refund-auth:<id>` após 30 min; rótulo "autorizar no painel do Asaas" | teste P17 |
| 3 | Páginas de detalhe (OS, chamado, contrato, fechamento) com id inexistente mostravam a tela de erro genérica em vez de 404 | varredura de rotas + log do servidor | `.catch(() => notFound())` (padrão das demais) | teste estático `tests/unit/detail-pages.test.ts` (falha sem a correção) |

## 3. Estorno agendado de R$ 75,10
- Registro local `cmvs5o69u0001z1lujwc501g1`: `SCHEDULED`, 1 tentativa, próxima **2026-10-29 09:00 UTC (06:00 BRT)**, último retorno "Esta transação só pode ser estornada parcialmente no próximo dia.".
- Estado externo (consulta `GET`, somente leitura): `pay_fzvllcs4rjfnze8h` `CONFIRMED`, `refunds: []` — coerente com o local (nada devolvido).
- A janela **não havia começado** durante o P17 (28/10 ~12:00 BRT): **nenhuma tentativa antecipada**. Retentativa preparada (tarefa agendada para 29/10 06:20 BRT, só sandbox, sem commit).
- Garantias verificadas: consulta ao gateway antes de reenviar; marcador `[wemob-refund:<id>]` devolvido pelo Asaas em `refunds[].description` (conferido em `pay_aksy7ycwtemzpz5r`); resultado incerto nunca reenvia sem consulta; execução concorrente manual/automática não duplica (defeito 1); segunda execução sem efeito (testes).
- Atenção: o estorno Pix do P14 segue `AWAITING_CRITICAL_ACTION_AUTHORIZATION` no sandbox — o de cartão pode exigir o mesmo.

## 4. Ciclo de recarga e limite financeiro
- Ciclo completo coberto por testes de integração (pedido → pagamento → RemoteStart → Start → MeterValues → limite → Stop → cálculo → estorno/conciliação), com falhas: timeout, offline, comando expirado, pedido duplicado, pagamento tardio, excedente.
- **Barra de limite verificada no navegador** com recarga de teste controlada (estação TEST-UI-01, etiqueta de bancada, sem cobrança; cobertura R$ 100 / limite R$ 90 gravados na sessão de teste): 30 kWh → R$ 74,70 (barra parcial); 33 kWh → aviso; 36,2 kWh → **uma** parada remota (repetida leitura não duplicou); tela "Limite atingido: pedimos ao carregador para encerrar"; valor final R$ 90,89 ≤ cobertura. Comando de teste cancelado (nunca entregue).
- Sem carregador físico: limite **não homologado em hardware**.

## 5. Telas e perfis
Varredura das 70 rotas × 10 perfis (visitante, motorista, superadmin, admin, financeiro, parceiro, comercial, operações, suporte, investidor) contra o servidor de desenvolvimento: **0 erros 500, 0 telas de erro**; sem permissão → `/app/sem-permissao`; motorista não acessa `/app`; equipe não acessa páginas privadas do motorista; parceiro recebe 404 em unidade/estação de outra organização; 404 restantes são esperados (ids inexistentes, `propostas/nova` sem oportunidade). Usuários de teste dos perfis sem usuário no banco de desenvolvimento foram criados com senha aleatória e **desativados** ao final; todas as sessões temporárias revogadas. E2E automatizado (Playwright) continua inexistente.

## 6. Verificações (saída real)
| Comando | Resultado |
|---|---|
| `npm test` | **19 arquivos, 225 testes passando** |
| `npm run lint` / `npm run typecheck` | 0 / 0 |
| `NEXT_DIST_DIR=.next-build npm run build` | sucesso, 76 rotas (pasta removida, `tsconfig.json` restaurado) |
| Migrations em banco vazio | 12 aplicadas, sem diferença com o schema (banco removido) |
| `npm audit --omit=dev` | **0** |
| `npm audit` | **2 moderadas** (`@vitest/mocker` ≤ 4.1.11, `vitest` 2.1.0-beta.1–4.1.10) |
| Varredura de segredos em todos os arquivos versionados | 0 ocorrências (chave, token, chaves de cifra/app, padrões de chave privada) |

Vulnerabilidades de desenvolvimento: correção exige `vitest@4.1.12`. Com npm 10.9.3 (o do ambiente) a instalação falha (`edgesOut`, ciclo de dependências de pares opcionais). Com npm 11 a simulação resolve, **mas reescreveria o lockfile removendo 17 pacotes opcionais por plataforma** (ex.: `@img/sharp-wasm32`, `@napi-rs/wasm-runtime`), com risco para Docker/CI Linux. Não aplicado: decisão de infraestrutura (versão do npm do projeto). Impacto: só desenvolvimento; exige servidor Vite com plugin de mocks exposto — os testes rodam em Node, sem servidor Vite. Mitigação: não usar o modo navegador/UI do Vitest.

## 7. Estado por categoria
| Item | Código | Testes | Sandbox real | Físico/operacional | Produção |
|---|---|---|---|---|---|
| Pix | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | PENDENTE | PENDENTE |
| Cartão (cobrança/pagamento/webhook) | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | PENDENTE | PENDENTE |
| Estorno parcial de cartão | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | PARCIAL / BLOQUEADO (data: 29/10 06:00 BRT) | PENDENTE | PENDENTE |
| Webhooks | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | PENDENTE (domínio próprio) | PENDENTE |
| Conciliação | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | PARCIAL / BLOQUEADO (só cobranças de teste) | PENDENTE | PENDENTE |
| Split | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA | PARCIAL / BLOQUEADO (sem 2ª carteira) | PENDENTE | PENDENTE (trava ativa) |
| Regra 50/50 | CONCLUÍDO COM EVIDÊNCIA (parametrizada, escolha obrigatória) | CONCLUÍDO COM EVIDÊNCIA | — | PENDENTE (decisão comercial) | PENDENTE |
| OCPP e limite financeiro | CONCLUÍDO COM EVIDÊNCIA | CONCLUÍDO COM EVIDÊNCIA (simulador) | — | PENDENTE (carregador físico) | PENDENTE |
| Telas e perfis | CONCLUÍDO COM EVIDÊNCIA | PARCIAL / BLOQUEADO (sem E2E automatizado; varredura + navegador feitos) | — | — | PENDENTE |
| Dependências | CONCLUÍDO COM EVIDÊNCIA (produção 0) | — | — | PARCIAL / BLOQUEADO (2 moderadas dev) | — |
| Deploy/staging | PENDENTE | — | — | PENDENTE | PENDENTE |

## 8. Pendências externas e riscos residuais
Iguais às da seção 5/6 do P16, com o estorno agora preparado para 29/10. Riscos adicionais: o estorno de cartão pode exigir autorização de ação crítica no painel (como o Pix do P14); o endereço do proxy/túnel não deve ser usado em staging.

## 9. Conclusão
**O escopo de código está completo para a próxima etapa de homologação.** Justificativa: todas as funcionalidades existentes têm implementação funcional ou limitação documentada; as integrações internas estão conectadas e testadas (225 testes); não há falhas críticas ou altas conhecidas (produção: 0 vulnerabilidades; dev: 2 moderadas sem condição de exploração, com causa e caminho documentados); fluxos financeiros idempotentes e rastreáveis, inclusive sob concorrência (defeito 1 corrigido); estado local conciliável com o Asaas (conferido por consulta real); limite financeiro e falhas de parada tratados; lint, tipos, build e migrações passam; telas principais verificadas (varredura completa + navegador); três defeitos encontrados foram corrigidos com regressão; nenhum defeito conhecido está classificado como pendência externa.
**Não está pronto para produção**: dependem de terceiros/decisões o estorno parcial de cartão real (29/10), o split (2ª carteira e elegibilidade), a regra 50/50, as permissões de estorno na conta de produção, carregadores físicos, deploy e a habilitação por duas pessoas. A ausência de E2E automatizado e as 2 moderadas de dev são as lacunas técnicas restantes, ambas fora dos critérios bloqueantes e documentadas.
