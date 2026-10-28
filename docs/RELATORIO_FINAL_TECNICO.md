# Relatório final técnico — P16, auditoria P17 e homologação P18

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


---

# Homologação final e preparação para produção — P18 (2026-10-28)

**Ambiente**: macOS (Darwin 25.2), Node 22.19.0, npm 10.9.3, PostgreSQL 14 local (`sansol_dev`, `sansol_test`, bancos temporários descartáveis), Asaas **sandbox** (somente leitura nesta etapa). Execução 13:33–14:10 BRT.
**Commit inicial**: `3bfc71c` (sobre `9f2f0da` → `1a99aca`; ordem confirmada com `git merge-base`), árvore limpa. **Commit final**: `f558e88` (autorizado pelo usuário após a revisão), mais este registro. Nenhum push, deploy, operação financeira real, alteração de `.env` ou migração destrutiva.
**Fatos verificados nesta etapa** estão marcados com a evidência; itens marcados "(herdado)" vêm de relatórios anteriores e não foram reexecutados.

## 1. Estado inicial (verificado)
Branch `main`, HEAD `3bfc71c`, árvore limpa; 2,7 GB livres (1,8 GB ao final, por crescimento do `.next` do servidor de desenvolvimento); banco no ar; **porta 3001 ocupada pelo servidor de desenvolvimento iniciado no P17** (não reiniciado por mim; o próprio Next reiniciou o processo por memória — ver 5.D).

## 2. Defeitos reproduzidos e corrigidos (com regressão)
| # | Defeito | Reprodução | Correção | Regressão |
|---|---|---|---|---|
| 1 | "Tentar agora" antecipava estorno **agendado pelo gateway**; cada clique era recusado de novo e consumia tentativas | 6 cliques → estorno `FAILED`, 5 tentativas, pagamento em análise sem falha real | manual recusa `SCHEDULED` com data futura (mensagem com data e motivo); botão oculto nesse estado | teste P18 (falhava antes) |
| 2 | Split **recusado** pelo gateway (status oficial `REFUSED`) não abria análise; só apareceria após 3 dias como "não liquidado" | teste: `reviewReason` vazio | `REFUSED` na lista de status; análise imediata; divergência `SPLIT_REFUSED` na conciliação | teste P18 (falhava antes) |

Testes acrescentados sem defeito encontrado: parada **aceita** pelo carregador sem `StopTransaction` não conta como parada física (alerta continua, sem reenvio); testes unitários das regras puras de split (casas decimais, soma ≤ 100%, 50% do líquido, arredondamento por linha, divergência, fixo maior que o cobrado).

## 3. Matriz de homologação
### A. Asaas e estornos
| Item | Status | Evidência |
|---|---|---|
| Estado externo do estorno de R$ 75,10 (leitura) | APROVADO COM EVIDÊNCIA | `GET /payments/pay_fzvllcs4rjfnze8h` (13:3x BRT): `CONFIRMED`, `refunds: []`; local `CAPTURED`, estornado 0,00, estorno `cmvs5o69u0001z1lujwc501g1` `SCHEDULED` para 2026-10-29 09:00 UTC |
| Execução do estorno de R$ 75,10 | BLOQUEADO EXTERNAMENTE | janela do Asaas abre 29/10 06:00 BRT; **não antecipado**; tarefa agendada 06:20 BRT (só sandbox, sem commit) |
| Estados aprovado/recusado/pendente/incerto/aguardando autorização | APROVADO COM EVIDÊNCIA | 23 testes de estorno/webhook/conciliação + testes P16–P18 |
| Manual × automático simultâneos | APROVADO COM EVIDÊNCIA | teste P17 (reserva única) + teste P18 (sem antecipação) |
| Consulta ao gateway antes de repetir resultado incerto | APROVADO COM EVIDÊNCIA | testes P16 (timeout após processar: não reenvia) |
| Marcador do estorno devolvido pelo Asaas | APROVADO COM EVIDÊNCIA | `refunds[].description` íntegro em `pay_aksy7ycwtemzpz5r` (leitura) |
| Estorno Pix do P14 | BLOQUEADO EXTERNAMENTE | segue `AWAITING_CRITICAL_ACTION_AUTHORIZATION` (autorizar no painel do sandbox) |

### B. Split
| Item | Status | Evidência / responsável |
|---|---|---|
| Implementação × documentação (netValue, 2/4 casas, soma ≤ 100%, estorno estorna repasses, status oficiais) | APROVADO COM EVIDÊNCIA | testes unitários + integração; `REFUSED` incluído |
| Métodos que aceitam split | BLOQUEADO EXTERNAMENTE | documentação oficial não traz matriz por método (exemplo de checkout Pix existe) — confirmar com o Asaas (responsável comercial) |
| Split no sandbox | BLOQUEADO EXTERNAMENTE | falta `walletId` de **segunda conta sandbox** autorizada (responsável: dono da conta Asaas) |
| Base do 50% (bruto × líquido) | BLOQUEADO EXTERNAMENTE | decisão comercial/jurídica; código exige escolha explícita no contrato; split do Asaas é sempre sobre o líquido |
| Split em produção | APROVADO COM EVIDÊNCIA (bloqueio) | `productionReadiness` recusa sem política aprovada e recebedor de produção validado |

### C. Recarga e limite financeiro (simulador / handler OCPP)
| Item | Status | Evidência |
|---|---|---|
| Início, medidor, consumo, encerramento, cálculo | APROVADO COM EVIDÊNCIA | testes de ciclo (Pix, cartão, pré-autorização) |
| Limite, margem, aviso 90%, parada única, repetição até 5× | APROVADO COM EVIDÊNCIA | 5 testes de limite |
| Sem telemetria, rede indisponível, parada sem confirmação, parada aceita sem Stop, comandos duplicados | APROVADO COM EVIDÊNCIA | testes de limite + OCPP (idempotência, fora de ordem) |
| Barra de limite na tela | APROVADO COM EVIDÊNCIA (herdado do P17) | recarga de teste controlada no navegador |
| Carregador físico | BLOQUEADO EXTERNAMENTE | nenhum equipamento homologado |

### D. APIs, segurança e perfis
| Item | Status | Evidência |
|---|---|---|
| Inventário de integrações e rotas | APROVADO COM EVIDÊNCIA | seção P17 §1 (revalidado: única integração externa de saída é o Asaas); 7 rotas de API; tarefas: ciclo do servidor OCPP (expiração, webhooks, limites, estornos, alertas, conciliação horária) + tarefa agendada externa do estorno |
| Isolamento por perfil (10 perfis × 70 rotas) **contra build de produção** | APROVADO COM EVIDÊNCIA | `E2E_BASE=http://localhost:3002 npm run e2e:rotas`: 700 verificações, 0 falhas (500/erro/laço) |
| Cabeçalhos de segurança em produção | APROVADO COM EVIDÊNCIA | CSP sem `unsafe-eval`, HSTS, X-Frame-Options DENY, nosniff, sem X-Powered-By |
| Segredos versionados | APROVADO COM EVIDÊNCIA | varredura em todos os arquivos versionados e na árvore: 0 |
| Webhooks: autenticidade, duplicidade, ordem, retentativa, falha persistente | APROVADO COM EVIDÊNCIA | testes; webhook real (herdado P15) |
| Limite de requisições no webhook | NÃO TESTADO | sem limite por IP; mitigado por token em tempo constante, corpo ≤ 64 KB e 401 sem gravação — avaliar no proxy de staging |

### E. Qualidade
| Comando | Status | Resultado |
|---|---|---|
| `npm test` | APROVADO COM EVIDÊNCIA | **20 arquivos, 231 testes, 0 falhas** |
| `npm run lint` / `npm run typecheck` | APROVADO COM EVIDÊNCIA | 0 / 0 |
| `NEXT_DIST_DIR=.next-build npm run build` (2×) | APROVADO COM EVIDÊNCIA | sucesso, 76 rotas; `tsconfig.json` restaurado; pasta removida |
| Migrations em banco limpo | APROVADO COM EVIDÊNCIA | 12 aplicadas, `migrate diff` sem diferença, banco removido |
| `npm audit --omit=dev` | APROVADO COM EVIDÊNCIA | 0 |
| `npm audit` (dev) | BLOQUEADO EXTERNAMENTE | 2 moderadas (`vitest`/`@vitest/mocker`); correção exige vitest 4.1.12 → npm ≥ 11 no projeto, Docker e CI e lockfile regenerado (−17 pacotes opcionais por plataforma); sem condição de exploração (sem servidor Vite exposto) |

### F. E2E
| Item | Status | Evidência |
|---|---|---|
| E2E de rotas/permissões (HTTP real) | APROVADO COM EVIDÊNCIA | novo `scripts/e2e-rotas.ts` (`npm run e2e:rotas`), sem dependência nova, só banco de desenvolvimento, limpeza garantida |
| E2E de navegador (cobrança, estorno, recarga) | NÃO TESTADO | Playwright não instalado no projeto; proposta: `@playwright/test` como devDependency (1 pacote; Chromium headless já em cache, 180 MB), 3 cenários (login/permissão, pedido Pix/cartão até a tela do gateway, recarga com barra de limite via handler). Requer autorização para alterar dependências/lockfile |

## 4. Alterações propostas (não commitadas)
`src/server/payments/service.ts` (defeitos 1 e 2), `src/domain/payments/asaas.ts` (status `REFUSED`), `src/app/app/pagamentos/[id]/page.tsx` (botão oculto), `scripts/e2e-rotas.ts` + `package.json` (`e2e:rotas`), `tests/integration/asaas.test.ts` (+4), `tests/unit/split.test.ts` (novo), documentação.

## 5. Riscos remanescentes
| Risco | Impacto | Mitigação |
|---|---|---|
| Estorno de cartão pode exigir "ação crítica" no painel | devolução ao motorista atrasa | alerta `refund-auth`; confirmar política com o Asaas |
| Dockerfile roda `migrate deploy` a cada subida do contêiner | migração aplicada sem janela controlada | separar a migração em etapa manual do deploy (recomendado; não alterado) |
| `next dev` reinicia por memória com muitas rotas | só desenvolvimento | usar build de produção nas varreduras |
| Limite financeiro depende de MeterValues/RemoteStop do equipamento | consumo acima do pago em carregador que ignore a parada | alerta de contingência + análise; homologar cada fabricante |
| Webhook sem limite por IP | abuso de CPU/banco limitado | token + 64 KB; rate limit no proxy |

## 6. Critérios que impedem o deploy
Ambiente de staging inexistente (domínio, TLS, cofre, backup automático, monitoramento); estorno de cartão real não concluído; split sem validação externa e sem regra comercial; carregador físico não homologado; permissões de estorno da conta de produção não confirmadas; habilitação de produção (duas pessoas) não realizada; decisão sobre o npm/Vitest; migração automática no contêiner.

## 7. Plano de reversão
1. **Código**: as mudanças deste relatório são locais; reverter = descartar o diff ou, após commit, `git revert <commit>` (nunca reescrever histórico).
2. **Banco**: migrations do P15–P16 têm `down.sql` testados (P16); aplicar na ordem inversa, depois de `pg_dump` e com o servidor OCPP parado.
3. **Pagamentos**: produção só opera com `ASAAS_PRODUCTION_ENABLED=1` **e** habilitação aprovada — revogar a habilitação (tela de gateway) desliga novas cobranças de imediato; `PAYMENT_PROVIDER` vazio bloqueia tudo.
4. **Split**: `ASAAS_SPLIT_ENABLED` vazio desliga o split em novas cobranças; políticas são versionadas (sem efeito retroativo).
5. **Webhook**: `npm run asaas:webhook -- remover <id>` (sandbox) / painel do Asaas (produção).

## 8. Checklist de aprovação de produção
- [ ] Staging com HTTPS/wss, cofre de segredos, backup diário + restauração testada, logs e alertas (`docs/staging.md`)
- [ ] Webhook de staging com domínio próprio, recebido e monitorado (`penalizedRequestsCount`)
- [ ] Estorno parcial de cartão concluído (`DONE`) no sandbox e política de "ação crítica" definida
- [ ] Split: 2ª carteira sandbox, métodos elegíveis confirmados, regra 50/50 decidida por escrito
- [ ] Carregador físico homologado (MeterValues, RemoteStart/Stop, limite financeiro)
- [ ] Migração separada do start do contêiner; runbook de deploy/rollback ensaiado
- [ ] Decisão sobre npm 11 / Vitest 4 (ou aceite formal das 2 moderadas de dev)
- [ ] E2E de navegador (autorizar Playwright) ou aceite do E2E HTTP
- [ ] Textos jurídicos, validação contábil, credenciais de produção, habilitação por duas pessoas

## 9. Tabela de decisão
| Item | Status | Evidência | Risco | Próxima ação |
|---|---|---|---|---|
| Código e testes | APROVADO COM EVIDÊNCIA | 231 testes, lint, tipos, build, migrations | baixo | revisar e commitar o diff do P18 |
| Defeitos P18 (antecipação manual, split recusado) | APROVADO COM EVIDÊNCIA | testes falhavam antes, passam depois | baixo | revisar |
| Isolamento/permissões | APROVADO COM EVIDÊNCIA | `npm run e2e:rotas` 700/0 em produção | baixo | rodar no staging |
| Estorno R$ 75,10 | BLOQUEADO EXTERNAMENTE | `SCHEDULED` → 29/10 06:00 BRT; Asaas sem estorno | médio (ação crítica) | conferir resultado da tarefa de 29/10 06:20 |
| Pix / cartão / webhook | APROVADO COM EVIDÊNCIA (herdado P14–P16) | relatórios em `docs/homologacao/` | baixo | repetir no staging |
| Split externo e regra 50/50 | BLOQUEADO EXTERNAMENTE | sem 2ª carteira; sem decisão | alto para repasses | comercial: carteira de teste + decisão escrita |
| Recarga/limite em hardware | BLOQUEADO EXTERNAMENTE | só simulador | alto | homologar carregador de bancada |
| Dependências dev | BLOQUEADO EXTERNAMENTE | 2 moderadas | baixo | decidir npm 11 |
| E2E navegador | NÃO TESTADO | Playwright ausente | médio | autorizar `@playwright/test` |
| Deploy/produção | BLOQUEADO EXTERNAMENTE | sem staging | — | autorizar staging |

**Decisão**: o WeMob está **apto para homologação externa em staging** (código validado, integrações sandbox validadas onde havia credencial, defeitos encontrados corrigidos com regressão). **Não está apto para produção** pelos critérios da seção 6.


---

# Fechamento técnico, E2E real e preparação de deploy — P19 (2026-10-28)

**Ambiente**: macOS (Darwin 25.2), Node 22.19.0, npm 10.9.3, PostgreSQL local (`sansol_dev`, `sansol_test` e bancos temporários `sansol_e2e_*`/`sansol_migcheck_*`/`sansol_migconc_*`, criados e apagados nesta etapa). Sem Docker daemon em execução (só a CLI e o Compose v2.40.3).
**Regras respeitadas**: nenhum push, deploy, operação financeira real, alteração de `.env`/credenciais ou banco existente recriado/apagado. O estorno de R$ 75,10 **não foi consultado nem modificado** (o servidor usado no `e2e:rotas` rodou com as chaves do Asaas vazias: nenhuma chamada ao gateway).

## 1. Estado inicial (verificado)
- Branch `main`. Commits do P18 presentes (`f558e88`, `4c3471d`). Etapas 1 e 2 já commitadas no início desta rodada: `0a5ba95` (migrações fora do startup) e `ddfdbb4` (Playwright). Árvore com `package.json`/`package-lock.json` alterados = Etapa 3 em andamento (Vitest 4.1.12), sem trabalho de terceiros.
- Disco: **1,2 GB livres** (1,0 GB após o build) — crítico; nenhuma limpeza feita (o cache `~/.npm` de 3,7 GB é compartilhado com outros projetos).
- Portas: 3000 ocupada por `next-server (v16.3.6)` de **outro projeto** (PID 1210, não tocado); 3001 e 3002 livres.

## 2. Commits locais do P19
| Commit | Etapa | Arquivos |
|---|---|---|
| `0a5ba95` | 1 — migrações fora do startup | `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `src/app/api/health/route.ts`, `package.json` (`db:status`), `docs/runbook.md`, `docs/staging.md`, `README.md`, `CLAUDE.md` |
| `ddfdbb4` | 2 — Playwright | `playwright.config.ts`, `e2e/**`, `scripts/e2e-browser.ts`, `scripts/build-dist.mjs`, CI, `.gitignore`/`.dockerignore`, ESLint, remoção de `src/app/app/loading.tsx` + `tests/unit/sem-loading-app.test.ts`, docs |
| `df97c16` | 3 — dependências | `package.json`, `package-lock.json` |
| este registro | 5 — documentação | `docs/RELATORIO_FINAL_TECNICO.md`, `docs/staging.md`, `docs/runbook.md`, `IMPLEMENTATION_STATUS.md`, `CLAUDE.md`, `.github/workflows/ci.yml` (auditoria) |

## 3. Etapa 1 — migrações explícitas
**Antes**: o `CMD` do contêiner rodava `prisma migrate deploy && node server.js` a cada subida (cada réplica migrava). **Depois**: `CMD ["node", "server.js"]`; serviço `migrate` no Compose só com `--profile migrate`; `GET /api/health` com banco sem tabelas → 503 `schema: "migrations_pending"`; procedimento no runbook ("Deploy e migrações": backup, status, migração única, verificação, falha, reversão sem rollback automático).

| Verificação | Status | Evidência (esta rodada) |
|---|---|---|
| App inicia sem migrar | APROVADO COM EVIDÊNCIA | build standalone (`node server.js`) em banco temporário vazio: health `503 {"db":"ok","schema":"migrations_pending"}`; **0 tabelas** após a subida |
| Migração explícita em banco descartável | APROVADO COM EVIDÊNCIA | `migrate status` exit 1 (pendentes) → `migrate deploy` exit 0 "All migrations have been successfully applied" → 2ª execução "No pending migrations" → `status` "Database schema is up to date!" (12 migrações) → health 200 `ok`; banco removido |
| Execuções concorrentes (réplicas/jobs duplicados) | APROVADO COM EVIDÊNCIA | 2 `migrate deploy` simultâneos: A aplicou, B "No pending migrations"; `_prisma_migrations` 12 registros, 0 incompletos |
| Compose | APROVADO COM EVIDÊNCIA | `docker compose --env-file .env.example config --quiet` OK; serviços padrão `db ocpp app`; `migrate` só com `--profile migrate` |
| Build da imagem / `docker compose up` | NÃO TESTADO | Docker daemon indisponível nesta máquina |
| CI sem dependência do startup antigo | APROVADO COM EVIDÊNCIA (leitura) | CI não usa Docker; testes migram via `tests/global-setup.ts`, E2E via `scripts/e2e-browser.ts` (etapa explícita) |

## 4. Etapa 2 — Playwright (E2E de navegador real)
`@playwright/test` 1.56.1 (1 devDependency; Chromium headless). `npm run e2e:build && npm run e2e:browser`: banco temporário próprio, migração explícita, dados criados pelos serviços do app, **build de produção servido como na imagem** (`node server.js`), gateway **simulado** (`PAYMENT_PROVIDER=sandbox`, chaves do Asaas vazias), banco e fixtures apagados no fim; screenshot só em falha, trace só com `E2E_TRACE=1`.

| Cenário | Status | Evidência |
|---|---|---|
| A. Login inválido/válido, página protegida, isolamento entre parceiros (404), logout revoga a sessão, motorista × motorista e equipe × motorista | APROVADO COM EVIDÊNCIA | 5 testes |
| B. Cobrança capturada, estorno com **clique duplo → 1 estorno**, acima do disponível recusado sem gateway, estados pendente/incerto/aguardando autorização/recusado e saldo | APROVADO COM EVIDÊNCIA | 4 testes |
| C. Recarga: início, consumo e barra de limite, alerta, parada aceita ≠ confirmada, sem comunicação, sem telemetria | APROVADO COM EVIDÊNCIA | 1 teste de fluxo (10,8 s) |
| D. P18 agendado sem "Tentar agora", P17 manual × automático (outro processo) devolve 1×, P18 split recusado na conciliação, financeiro sem gestão de usuários | APROVADO COM EVIDÊNCIA | 4 testes |
| Execução | APROVADO COM EVIDÊNCIA | `14 passed (27.7s)`; `banco E2E temporário removido: sansol_e2e_1793211952941` |
| Playwright no CI | NÃO TESTADO | etapas no `ci.yml`; sem push nesta etapa |
| Defeito real achado pelo E2E | APROVADO COM EVIDÊNCIA | `src/app/app/loading.tsx` travava server actions com `revalidatePath` no build de produção; removido + teste de guarda (commit `ddfdbb4`) |

`npm run e2e:rotas` continua uma verificação distinta (HTTP, banco de desenvolvimento).

## 5. Etapa 3 — npm 11, Vitest 4 e vulnerabilidades
- **Antes** (`HEAD` com o lockfile do P18): `npm audit` → 2 moderadas: `@vitest/mocker <=4.1.11` (GHSA-82fw-gwwq-j7x9 path traversal; GHSA-qxg6-89mg-rqv8 injeção via registro de mock) e `vitest 2.1.0-beta.1 – 4.1.10`; ambas só desenvolvimento. `--omit=dev`: 0.
- **Correção**: `vitest` 3.2.7 → **4.1.12** (puxa `@vitest/*` 4.1.12, `chai` 6.3.0, `es-module-lexer` 2.3.2, `std-env` 4.3.0, `tinyrainbow` 3.2.0; mantém `vite` 7.3.7); override de `tinypool` removido (o Vitest 4 não usa). `vitest.config.ts` sem alteração; nenhum snapshot no projeto.
- **npm**: o lockfile foi regenerado com o **npm 10.9.3** (mesmo do Node 22.19.0, do Dockerfile e do CI) e é idempotente (`npm install --package-lock-only` não muda nada). O bloqueio do P18 (npm 10 falhando na resolução) **não se repetiu** com o override de `tinypool` removido.
- **npm 11.6.2** avaliado com `npx` numa cópia (sem instalação global): **rejeitado** — retiraria 4 entradas opcionais (`@emnapi/core`, `@emnapi/runtime` na raiz e aninhadas em `@tailwindcss/oxide-wasm32-wasi`), fallbacks wasm32-wasi.
- **Lockfile**: 597 → 594 entradas (−11 exclusivas do Vitest 3: `cac`, `check-error`, `deep-eql`, `loupe`, `pathval`, `strip-literal`(+`js-tokens`), `tinypool`, `tinyspy`, `vite-node`, `vitest/node_modules/tinyexec`; +8: `convert-source-map`, `obug` e 6 dependências empacotadas do `oxide-wasm32-wasi`). Pacotes com `os`/`cpu`/`libc`: **158 → 158, nenhum removido**. Binários de `@next/swc`, `lightningcss`, `@tailwindcss/oxide`, `@unrs/resolver-binding`, `@esbuild`, `@rollup` presentes para linux x64/arm64 glibc e musl (Alpine do Dockerfile), darwin x64/arm64 e win32 x64/arm64.

| Verificação | Status | Evidência |
|---|---|---|
| `npm ci` limpo (macOS) | APROVADO COM EVIDÊNCIA | "added 435 packages… found 0 vulnerabilities" |
| `npm audit` / `npm audit --omit=dev` | APROVADO COM EVIDÊNCIA | 0 / 0 |
| Testes, lint, tipos, build com Vitest 4 | APROVADO COM EVIDÊNCIA | ver §6 |
| Instalação limpa Linux (Docker/CI) e Windows | NÃO TESTADO | sem Docker daemon e sem push; só conferência estática do lockfile (acima) |

## 6. Etapa 4 — regressão integrada (saída real, 15:10–15:30 BRT)
| Comando | Status | Resultado |
|---|---|---|
| `npm test` | APROVADO COM EVIDÊNCIA | Vitest 4.1.12: **21 arquivos, 232 testes, 0 falhas** (341 s) |
| `npm run lint` / `npm run typecheck` | APROVADO COM EVIDÊNCIA | 0 / 0 |
| `npm run build` | APROVADO COM EVIDÊNCIA | sucesso (standalone) |
| Migrações em banco temporário limpo | APROVADO COM EVIDÊNCIA | §3 (12 aplicadas, idempotente, concorrência segura) |
| `E2E_BASE=http://127.0.0.1:3002 npm run e2e:rotas` (build de produção, banco de desenvolvimento) | APROVADO COM EVIDÊNCIA | **10 perfis × 70 rotas = 700 verificações; falhas: 0**; servidor encerrado ao final |
| `npm run e2e:build && npm run e2e:browser` | APROVADO COM EVIDÊNCIA | **14 passed** |
| Compose e fluxo de migração explícito | APROVADO COM EVIDÊNCIA (config) / NÃO TESTADO (imagem) | §3 |
| `npm audit` | APROVADO COM EVIDÊNCIA | 0 vulnerabilidades |
| `git diff --check`, histórico, árvore | APROVADO COM EVIDÊNCIA | sem erros; 4 commits P19 locais; árvore limpa após o commit de documentação |

Efeito colateral registrado: o `e2e:rotas` cria sessões temporárias (revogadas no fim) e, para papéis sem usuário, usuários de teste que ficam **desativados** no banco de desenvolvimento — comportamento do script desde o P18.

## 7. Vulnerabilidades restantes
Nenhuma conhecida (`npm audit`: 0 em produção e desenvolvimento). O CI passou a falhar com qualquer vulnerabilidade de produção e com moderada+ em desenvolvimento.

## 8. Riscos e lacunas de homologação
| Item | Status | Observação |
|---|---|---|
| Imagem Docker e Compose em execução | NÃO TESTADO | primeira tarefa no staging |
| CI no GitHub (inclui Playwright e `npm ci` em Linux) | NÃO TESTADO | sem push autorizado |
| Windows | NÃO TESTADO | só lockfile |
| Estorno real de R$ 75,10 | BLOQUEADO (externo) | `SCHEDULED` para 29/10 06:00 BRT; não consultado nem antecipado nesta etapa |
| Split no sandbox / regra 50/50 | BLOQUEADO (externo) | 2ª carteira e decisão comercial |
| Carregador físico | BLOQUEADO (externo) | E2E de recarga usa carregador simulado |
| Staging (domínio, TLS, cofre, backup, monitoramento) | BLOQUEADO | não autorizado |
| Disco local com ~1 GB livre | risco operacional | builds e E2E podem falhar por espaço |
| Aviso do Prisma (`package.json#prisma` obsoleto no Prisma 7) | aceito | sem efeito no Prisma 6 |

## 9. Decisão
| Dimensão | Classificação | Base |
|---|---|---|
| Qualidade de código | **APROVADO COM EVIDÊNCIA** | 232 testes, lint, tipos, build, 700 verificações de rota, 14 E2E de navegador, 0 vulnerabilidades, migrações explícitas verificadas |
| Homologação de integrações | **BLOQUEADO** (parcial) | Asaas sandbox validado onde havia credencial (P14–P18); estorno de cartão em D+1 e split pendentes de terceiros |
| Homologação física | **BLOQUEADO** | nenhum carregador homologado |
| Autorização de produção | **REPROVADO** (não autorizado) | sem staging, sem homologação física e de split, imagem Docker e CI não executados; habilitação por duas pessoas não feita |

O WeMob está **tecnicamente preparado para homologação controlada em staging**: migrações explícitas, E2E reproduzível e dependências sem vulnerabilidades conhecidas. **Não está apto para produção.**


---

# Homologação em staging e gate de produção — P20 (2026-10-28)

**Ambiente**: macOS (Darwin 25.2), Node 22.19.0, npm 10.9.3, PostgreSQL 14 local; Docker CLI/Compose/buildx presentes, **daemon indisponível**. Execução 15:33–15:45 BRT. Nenhum push, deploy, operação financeira, alteração de `.env`/credenciais/dados reais ou reescrita de histórico.

## 1. Preservação inicial (verificado)
- Branch `main`, HEAD `10836d6`, árvore limpa; commits P19 `0a5ba95`, `ddfdbb4`, `df97c16`, `10836d6` — confere com o relatório P19.
- Disco 5,1 GB livres (confere com o fim do P19). Portas: 3000 = `next-server` de outro projeto (PID 1210, não tocado); 3001, 3002, 3100 e 9220 livres; Postgres em 5432 `accepting connections`. Nenhum cache apagado.
- **Divergência registrada**: a "tarefa agendada 29/10 06:20 BRT" citada no P17/P18 **não existe** (nem nas tarefas agendadas do app, nem em `crontab`, nem em `~/Library/LaunchAgents`); e o `npm run ocpp:server` — único executor automático de `retryDueRefunds` — **não está em execução**. Ver §5.

## 2. Defeito encontrado e corrigido (comprovado e testado)
| Defeito | Reprodução | Correção | Verificação |
|---|---|---|---|
| A imagem final não conseguia migrar: o serviço `migrate` do Compose (P19) e o `CMD` antigo (pré-P19) rodavam `node node_modules/prisma/build/index.js` numa imagem que só copiava `node_modules/prisma` — sem `@prisma/engines`/`@prisma/config` | layout idêntico ao estágio `run` montado fora da árvore do projeto (standalone + `.prisma` + `prisma/` + `node_modules/prisma`): `Error: Cannot find module '@prisma/engines'` | novo estágio **`migrate`** (`FROM deps`, CLI completo, `USER node`, `CMD migrate deploy`); Compose `migrate` usa `target: migrate`; estágio `run` deixa de copiar o CLI incompleto e `prisma/` | mesmo layout isolado: app em banco vazio → **503 `migrations_pending`**; layout do estágio `migrate` → `migrate deploy` exit 0 "All migrations have been successfully applied"; app → **200 `ok`**; banco temporário `sansol_imgcheck_*` removido. `docker compose config` OK com `target: migrate`. **Imagem real não construída** (sem daemon) |

Também: novo job **`docker`** no CI (constrói as duas imagens, exige 503 `migrations_pending` antes e 200 depois da migração explícita, `migrate status`) — **não executado** (sem push); `.env.example` documenta `SEED_ADMIN_EMAIL` (opcional).

## 3. Preparação para staging
| Item | Status | Evidência / observação |
|---|---|---|
| Dockerfile (estágios `deps`/`migrate`/`build`/`run`) | APROVADO COM EVIDÊNCIA (simulado) / NÃO TESTADO (imagem) | §2; build da imagem e Alpine (musl/OpenSSL do motor do Prisma) só no CI ou no staging |
| Compose | APROVADO COM EVIDÊNCIA (config) | `config --quiet` OK; `migrate` só com `--profile migrate`, alvo `migrate` |
| Migração separada do startup; réplicas sem concorrência | APROVADO COM EVIDÊNCIA | P19 §3 (0 tabelas após subir, idempotente, 2 execuções simultâneas seguras) + §2 |
| Health sem migrations | APROVADO COM EVIDÊNCIA | 503 `schema: "migrations_pending"` com banco vazio. **Limitação**: só detecta banco sem tabelas; migração nova pendente num banco existente **não** aparece no health — o runbook exige `migrate status` antes de promover |
| Variáveis e separação sandbox × produção | APROVADO COM EVIDÊNCIA (leitura + testes herdados) | todas as variáveis lidas pelo código estão no `.env.example`, exceto as de teste (`E2E_*`, `VITEST`, `NODE_ENV`); produção exige `ASAAS_PRODUCTION_ENABLED=1` **e** habilitação aprovada por duas pessoas (testes P13–P18) |
| Scripts de build, testes, E2E e CI | APROVADO COM EVIDÊNCIA (local) / NÃO TESTADO (CI remoto) | P19 §6; CI com jobs `check` e `docker` (YAML válido) |
| Logs, alertas, falhas, reversão | APROVADO COM EVIDÊNCIA (documental) | runbook ("Deploy e migrações", falha sem rollback automático, `down.sql` destrutivos sinalizados); staging §5. **Gaps conhecidos**: sem alerta automático para fila de webhook interrompida no Asaas nem para `UNPROCESSED_WEBHOOK` |
| Documentação repetível por outra pessoa | APROVADO COM EVIDÊNCIA | runbook e staging atualizados com as duas imagens do mesmo commit e a ordem backup → status → migração → status → health → promoção |

## 4. Fluxos críticos
Desde `10836d6` **nenhum** arquivo de `src/`, `tests/`, `e2e/`, `scripts/`, `prisma/` ou dependências mudou (`git diff --stat 10836d6 -- …` vazio). A regressão do P19 (mesma tarde) permanece válida e **não foi repetida**; o único teste relevante às mudanças do P20 (Docker) está no §2.
| Fluxo | Status | Evidência (P19) |
|---|---|---|
| Login, permissões, isolamento parceiro/motorista/equipe | APROVADO COM EVIDÊNCIA | Playwright A (5); `e2e:rotas` 700/0; `authz.test.ts` (15) |
| Cobranças simuladas, webhooks, idempotência, reconciliação | APROVADO COM EVIDÊNCIA | `payments.test.ts` (18), `asaas.test.ts` (55), `resilience.test.ts`; Playwright B |
| Estornos pendente/incerto/recusado/agendado, clique duplo, manual × automático | APROVADO COM EVIDÊNCIA | Playwright B e D; testes P16–P18 |
| Split, incluindo `REFUSED` | APROVADO COM EVIDÊNCIA (simulado) | `split.test.ts`, `asaas.test.ts`; Playwright D (conciliação). Split real: §5 |
| Recarga, telemetria, limite, parada aceita × confirmada | APROVADO COM EVIDÊNCIA (simulador) | Playwright C; `ocpp.test.ts` (15) |
| Unitários/integração, lint, TypeScript, build | APROVADO COM EVIDÊNCIA | 232 testes, 0/0, build OK |

## 5. Estorno de R$ 75,10 (29/10/2026)
**Não consultado, antecipado, cancelado nem reenviado no P20** (a janela abre 29/10 06:00 BRT; agora 28/10 tarde). Estado conhecido (P18): local `SCHEDULED` para 2026-10-29 09:00 UTC; gateway `CONFIRMED`, `refunds: []`.
**Bloqueio novo**: não há executor. A tarefa citada no P18 não existe e o servidor OCPP (que roda `retryDueRefunds`) está parado. **Ao chegar o horário, nada executará o estorno sozinho.** Agendada em 28/10 (autorizada pelo usuário) apenas a **leitura**: tarefa `wemob-estorno-7510-leitura`, 29/10 06:20 BRT — passos 1–2 abaixo e classificação, sem nenhuma escrita.
Procedimento na janela (a executar por uma pessoa ou tarefa autorizada):
1. Consultar o pagamento `pay_fzvllcs4rjfnze8h` no Asaas (`GET /payments/{id}` e estornos): já existe estorno? pendente? exige autorização (ação crítica)?
2. Conferir o estado local do estorno `cmvs5o69u0001z1lujwc501g1` (`remoteStatus`, `nextAttemptAt`, tentativas, lease).
3. Se houver execução automática em andamento (lease `RETRYING` ativo / servidor OCPP rodando), **não** clicar "Tentar agora".
4. Para executar: **ou** subir `npm run ocpp:server` (retentativa automática, consulta o gateway pelo `refundMarker` antes de reenviar), **ou** um único "Tentar agora" na tela — nunca os dois.
5. Se o Asaas exigir autorização no painel → registrar `BLOQUEADO` e aguardar o dono da conta.
6. Declarar sucesso só com o estorno `DONE` no gateway **e** o pagamento conciliado no WeMob (`reconcile()` sem divergência).

## 6. Pendências externas
| Pendência | Status | Evidência necessária | Risco | Responsável | Próxima ação |
|---|---|---|---|---|---|
| Execução do estorno de R$ 75,10 | BLOQUEADO EXTERNAMENTE (janela) + sem executor | §5 passos 1–6 | médio | operação WeMob (engenharia) | leitura agendada (tarefa `wemob-estorno-7510-leitura`, 29/10 06:20 BRT, só GET/SELECT, relatório em `docs/homologacao/estorno-75-10-2026-10-29.md`); a execução continua dependendo de decisão humana (OCPP no ar **ou** um único "Tentar agora") |
| 2ª carteira sandbox para split | BLOQUEADO EXTERNAMENTE | `walletId` de outra conta sandbox + split `DONE` num pagamento de teste | alto (repasses) | dono da conta Asaas (WAPE) | criar/convidar 2ª conta sandbox e informar o `walletId` |
| Métodos compatíveis com split | BLOQUEADO EXTERNAMENTE | resposta escrita do Asaas (Pix, cartão, pré-pago) | médio | comercial WAPE ↔ gerente Asaas | abrir chamado no Asaas |
| Rateio 50% bruto × líquido | BLOQUEADO EXTERNAMENTE | decisão assinada e versão de contrato aprovada | alto (financeiro/jurídico) | comercial + jurídico WAPE | decidir por escrito; o split do Asaas é sempre sobre o líquido |
| Permissões de estorno na conta de produção | BLOQUEADO EXTERNAMENTE | confirmação do Asaas + política de "ação crítica" | médio | dono da conta Asaas de produção | confirmar com o Asaas |
| Carregador físico (OCPP e limite financeiro) | BLOQUEADO EXTERNAMENTE | log de sessão real: Boot, Start, MeterValues, RemoteStop no limite, Stop | alto | operações WAPE / fabricante | disponibilizar carregador de bancada como estação `TEST` |
| CI remoto (`check` + `docker`) | NÃO TESTADO | execução verde no GitHub Actions | médio (imagem nunca construída) | responsável pelo repositório | autorizar push da branch |
| Staging (domínio, TLS, cofre, backup, monitoramento) | BLOQUEADO EXTERNAMENTE | ambiente criado conforme `docs/staging.md` | — | gestão WAPE + infraestrutura | autorizar e provisionar |
| Deploy e habilitação de produção (duas pessoas) | BLOQUEADO EXTERNAMENTE | autorização formal + `GatewayActivation` aprovada por duas pessoas | crítico | diretoria WAPE (dois aprovadores) | só após staging aprovado |

## 7. Decisão
**Requisitos do P20 cumpridos**: preservação e divergência registradas; Dockerfile/Compose/migração/health/env/CI/logs/reversão/documentação revisados; defeito da imagem de migração corrigido e testado em layout isolado; fluxos críticos cobertos pela regressão do P19 (sem mudança de código desde então); procedimento do estorno e pendências externas com responsável e próxima ação.
**Pendentes**: imagem Docker real e CI remoto (NÃO TESTADO); estorno de R$ 75,10 (janela 29/10 + executor a decidir); split real, regra 50/50, permissões de produção, carregador físico, staging e autorização de produção (BLOQUEADO EXTERNAMENTE).

| Dimensão | Classificação |
|---|---|
| Iniciar homologação em staging | **APROVADO COM EVIDÊNCIA**, com uma condição: o primeiro passo do staging é o CI remoto verde (job `docker`) — a imagem nunca foi construída |
| Homologação de integrações | **BLOQUEADO EXTERNAMENTE** |
| Homologação física | **BLOQUEADO EXTERNAMENTE** |
| Autorização de produção | **REPROVADO** — não autorizada |

O WeMob está **pronto para iniciar a homologação em staging**. Isso **não** é autorização para produção.


---

# Preparação para CI remoto e staging — P21 (2026-10-28)

**Ambiente**: o mesmo do P20 (macOS, Node 22.19.0, npm 10.9.3, PostgreSQL 14 local). Docker CLI presente, **daemon indisponível**. Execução 15:45–15:55 BRT. Sem push, deploy, migração em banco existente, alteração de `.env` ou contato com o estorno de R$ 75,10.

## 1. Estado do Git (verificado)
- `main`, árvore limpa no início. Sequência conferida por pai de cada commit: `0a5ba95` → `ddfdbb4` → `df97c16` → `10836d6` (P19) → `f494cf3` (P20, pai `10836d6`) → `6f2af8a` (registro do agendamento, pai `f494cf3`).
- Diff `10836d6..6f2af8a` revisado arquivo a arquivo: só `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example` e documentação; nenhuma mudança de código de aplicação, testes ou dependências.
- **O repositório não tem remote** (`git remote -v` vazio; `main` sem upstream). Não há destino para push até alguém configurar o remoto do GitHub.

## 2. Defeito encontrado e corrigido
| Defeito | Reprodução | Correção | Verificação |
|---|---|---|---|
| **O build da imagem falharia**: o `.dockerignore` (P19, `ddfdbb4`) excluía `e2e/`, mas o `next build` checa os tipos de todo `**/*.ts`, inclusive `scripts/e2e-browser.ts`, que importa `../e2e/support/seed` | contexto idêntico ao do Docker (`git archive HEAD` menos os caminhos do `.dockerignore`, sem `.env`, `env -i`): `Type error: Cannot find module '../e2e/support/seed'`, build abortado | `.dockerignore`: `e2e/` volta ao contexto; só `e2e/.fixtures.json` (senhas temporárias dos usuários de teste) fica de fora | mesmo contexto: `✓ Compiled successfully`, standalone gerado **sem `.env` e sem variáveis de ambiente**; único import de pasta excluída no projeto (busca em `src`, `scripts`, `prisma` e raiz) |

## 3. Docker
| Verificação | Status | Evidência |
|---|---|---|
| Estágio `migrate` com o CLI completo do Prisma | APROVADO COM EVIDÊNCIA (simulado) | layout do estágio a partir do contexto Docker: `migrate status` exit 1 (pendentes) → `deploy` exit 0 → `deploy` de novo "No pending migrations" → `status` "Database schema is up to date!" |
| Aplicação sem migração no startup e sem CLI na imagem | APROVADO COM EVIDÊNCIA (simulado) | layout do estágio `run` (standalone + static + `.prisma`): `node_modules/prisma` ausente; banco vazio → `/api/health` **503 `migrations_pending`**, 0 migrações aplicadas pela aplicação; após a migração explícita → **200** |
| Aplicação indisponível para tráfego com banco incompatível | **REPROVADO** (na aplicação) | banco vazio: `/` 200, `/login` 200, `/app` 307 → `/login`, mas `/modelos`, `/simulador` e `/motorista` **500**. Só o health acusa. A proteção depende do orquestrador (readiness em `/api/health`) e da ordem do runbook; a imagem não tem `HEALTHCHECK`; migração pendente num banco já existente não aparece no health (P20) |
| Execução explícita, idempotente e documentada; falha e reversão | APROVADO COM EVIDÊNCIA | acima + P19 §3 (concorrência) + runbook "Deploy e migrações" |
| Build real das imagens e teste em contêiner | **NÃO TESTADO** | daemon indisponível; as simulações acima **não** são build Docker (macOS/APFS, não Alpine) |
| Job `docker` do CI (constrói `migrate` e app, 503 → migração → 200 com Postgres temporário) | APROVADO COM EVIDÊNCIA (revisão) / NÃO TESTADO (execução) | YAML válido; usa `--network host` com o Postgres de serviço; sem secrets |

## 4. Verificações locais desta rodada
| Comando | Resultado |
|---|---|
| `npm audit` / `npm audit --omit=dev` | 0 / 0 |
| Build no contexto Docker (sem `.env`) | sucesso após a correção (falhava antes) |
| Testes, lint, TypeScript, Playwright, `e2e:rotas` | **não repetidos**: nenhum código mudou desde o P19 (232 testes, 0/0, 14 Playwright, 700/0 continuam válidos); `.dockerignore` não afeta essas verificações |

## 5. Condições para executar o CI remoto
1. Configurar o remoto do GitHub (`git remote add origin …`) — hoje inexistente.
2. Autorização explícita para o push de `main` (7 commits locais desde `4c3471d`, mais o deste registro). O workflow roda em `push` e `pull_request`.
3. Nenhum secret é necessário: o CI usa só valores literais de teste (`APP_SECRET: ci-only-secret`, Postgres de serviço); Asaas não é chamado (gateway simulado/fake).
4. Acompanhar os dois jobs: `check` (lint, tipos, testes, `npm audit`, build, Playwright) e `docker` (primeira construção real das imagens).

## 6. Riscos abertos antes do staging
| Risco | Impacto | Mitigação / próxima ação |
|---|---|---|
| Imagens nunca construídas; Prisma no Alpine (detecção de OpenSSL do motor) não verificada | job `docker` pode falhar | primeira execução do CI; se falhar por OpenSSL, avaliar `apk add openssl` com evidência |
| Aplicação responde 500 com banco incompatível | erros a usuários se o tráfego chegar antes da migração | readiness obrigatório em `/api/health` no orquestrador do staging; migração antes da promoção (runbook); melhoria futura: health comparar migrações aplicadas × esperadas |
| Sem `HEALTHCHECK` na imagem | orquestrador sem sinal padrão | configurar readiness/liveness no staging (Compose já tem `healthcheck`) |
| Sem remoto Git | CI não executável | configurar remoto (responsável pelo repositório) |
| Estorno de R$ 75,10 | ver P20 §5 | leitura agendada 29/10 06:20; execução depende de decisão humana |
| Pendências externas (split, 50/50, permissões, carregador, staging, produção) | ver P20 §6 | inalteradas |

## 7. Decisão
O repositório está **pronto para autorizar o push** que executará o CI remoto, **depois de configurado o remoto do GitHub**. A imagem Docker continua **NÃO TESTADA** até o job `docker` passar. Staging pode começar após o CI verde, com readiness em `/api/health`. Produção segue **não autorizada**.

## 8. CI remoto — primeira execução (2026-10-28, após autorização)
Remoto configurado (`origin` = `https://github.com/WIsleyoliveira/WeMob.git`, repositório **público**, vazio antes do push). Varredura dos 22 commits antes do envio: nenhum segredo (só exemplos `$aact_hmlg_…` e a senha de exemplo do Compose), nenhum `.env` versionado, nenhum CPF/telefone; e-mails apenas de teste; relatórios JSON do sandbox sem campos pessoais. Ficam públicos: o e-mail do autor dos commits e IDs de pagamentos/clientes do Asaas **sandbox**. Push de `main` (`2cf0aa9`) autorizado pelo usuário. Execução [40750195389](https://github.com/WIsleyoliveira/WeMob/actions/runs/40750195389), runner `ubuntu-26.04`:

| Job / passo | Status | Saída real |
|---|---|---|
| `docker`: `docker build --target migrate` | **APROVADO COM EVIDÊNCIA** | `npm ci` no Alpine: "found 0 vulnerabilities" |
| `docker`: `docker build` (aplicação) | **APROVADO COM EVIDÊNCIA** | "✓ Compiled successfully" |
| `docker`: aplicação sobe sem migrar | **APROVADO COM EVIDÊNCIA** | `{"status":"degraded","db":"ok","schema":"migrations_pending"}` (503) |
| `docker`: migração explícita + status | **APROVADO COM EVIDÊNCIA** | "All migrations have been successfully applied." / "Database schema is up to date!" |
| `docker`: aplicação após migração | **APROVADO COM EVIDÊNCIA** | `{"status":"ok","db":"ok",…}` (200); sem aviso de OpenSSL do Prisma no Alpine |
| `check`: `npm ci`, lint, typecheck | **APROVADO COM EVIDÊNCIA** | 0 vulnerabilidades; lint e tsc sem erros |
| `check`: `npm test` | **APROVADO COM EVIDÊNCIA** | "Test Files 21 passed (21) · Tests 232 passed (232)" |
| `check`: `npm audit --omit=dev` / `--audit-level=moderate` | **APROVADO COM EVIDÊNCIA** | 0 / 0 |
| `check`: `npm run build` | **APROVADO COM EVIDÊNCIA** | "✓ Compiled successfully" |
| `check`: `npx playwright install --with-deps chromium` | **REPROVADO** (ambiente) | "Playwright does not support chromium on ubuntu26.04-x64" — o rótulo `ubuntu-latest` migrou para o Ubuntu 26.04 |
| `check`: `e2e:build` / `e2e:browser` no CI | NÃO TESTADO | pulados pela falha anterior (locais: 14/14 no P19) |

Correção (hotfix CI-01): só o job `check` fixado em `runs-on: ubuntu-24.04` (suportado pelo Playwright 1.56.1), sem atualizar dependências nem o lockfile; o job `docker`, que passou no 26.04, continua em `ubuntu-latest`. Também corrigido o health check dos serviços Postgres: `pg_isready -U ci` sem `-d` conectava ao banco `ci` (nome do usuário), inexistente — 93 (`check`) + 35 (`docker`) linhas `FATAL: database "ci" does not exist`, a cada ~5,05 s (= `--health-interval 5s`); o serviço era considerado saudável mesmo assim (o `pg_isready` só testa se o servidor aceita conexões), então os testes não foram afetados. Agora `-d sansol_test` / `-d sansol_docker`. Os demais `ERROR` do Postgres no log são esperados: violações de unicidade provocadas pelos testes de idempotência e `AutomationRun` ausente no teste de banco não migrado.

**Atualização da decisão**: a imagem Docker passa a **APROVADO COM EVIDÊNCIA** (build real + teste integrado no CI). Pendente para fechar o CI: Playwright no CI após o push da correção.

### 8.1 CI remoto após o hotfix CI-01 — execução [40753259295](https://github.com/WIsleyoliveira/WeMob/actions/runs/40753259295) (`666a115`)
| Job | Runner | Status | Saída real |
|---|---|---|---|
| `check` | `ubuntu-24.04` | **APROVADO COM EVIDÊNCIA** | `npm ci` 0 vulnerabilidades; lint, typecheck OK; "Test Files 21 passed (21) · Tests 232 passed (232)"; `npm audit` 0 / 0; build OK; Chromium instalado; `e2e:browser` "**14 passed (40.8s)**" com banco temporário `sansol_e2e_1793215816124` criado e removido |
| `docker` | `ubuntu-latest` (26.04) | **APROVADO COM EVIDÊNCIA** | imagem `migrate` (`npm ci` 0 vulnerabilidades) e aplicação construídas; 503 `migrations_pending` → "All migrations have been successfully applied." → "Database schema is up to date!" → 200 `ok` |
| Health dos Postgres de serviço | — | **APROVADO COM EVIDÊNCIA** | 0 linhas `FATAL: database "ci" does not exist` (eram 128) |

**CI remoto: APROVADO COM EVIDÊNCIA** — os dois jobs terminaram com sucesso. Avisos não bloqueantes do GitHub: actions `@v4` em Node 20 (descontinuado, forçadas a Node 24). Produção continua **não autorizada**; staging pode começar com readiness em `/api/health`.
