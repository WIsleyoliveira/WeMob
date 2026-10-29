# Auditoria de prontidão para homologação — WeMob (2026-10-29)

**Commit analisado**: `b4778c3` (= `origin/main`, árvore limpa), CI 40948646848 verde (`check` + `docker`). Alterações desta auditoria: commit seguinte. **Produção NÃO AUTORIZADA.**
Fontes conferidas no código: `src/server/drivers/charging.ts`, `src/server/payments/service.ts`, `src/server/payments/asaas/provider.ts`, `src/domain/charging/{purchase,limit,driver-state}.ts`, `src/server/ocpp/*`, `src/app/api/**/route.ts`, `src/server/log.ts`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, testes em `tests/` e `e2e/`.

## 1. Matriz requisito × evidência
| Requisito | Evidência no código | Teste associado | Resultado (29/10) | Risco residual |
|---|---|---|---|---|
| Seleção de estação/conector; disponibilidade honesta | `listDriverStations`, `effectiveStatus` (sem comunicação → `UNKNOWN`) | Playwright B2, C | ✅ | dados de equipamento real não validados |
| Compatibilidade | `compatibleVehicles` (só tipo de conector) | `discovery.test.ts`, Playwright B2 | ✅ | potência do veículo não cadastrada |
| Compra por valor (B3) | `chargeAmountFor`, `parseAmount`, `validatePurchaseAmount`, `StartForm` | `purchase.test.ts`, `asaas.test.ts` B3, `compra-valor.spec.ts` | ✅ **desligada** (sem faixa) | faixa da WAPE |
| Compra por kWh | `quoteByEnergy` (regra pura) | `purchase.test.ts` | ⛔ **não oferecida** | decisões 4 e 6 da WAPE |
| Confirmação de preço antes do pagamento | `PurchaseSummary` | Playwright B3 | ✅ | texto oficial (decisão 7) |
| Pedido ↔ sessão ↔ conector ↔ comando | `ChargeRequest` (driver, estação, conector, idTag, commandId, payment, session); paradas por transação (`pendingStopWhere`) | `payments.test.ts` B1, `asaas.test.ts` limite | ✅ | hardware |
| Estados de início/encerramento | `driver-state.ts` | unit + Playwright B1/C | ✅ | hardware |
| Pagamento aprovado/recusado/pendente/expirado | `continueAfterPayment`, `expireStaleChargeRequests` | `asaas.test.ts`, `payments.test.ts` | ✅ auto; sandbox P14–P15 | depende do OCPP no ar para expirar |
| Timeout/indisponibilidade do provedor | `PaymentOperation` UNKNOWN, busca por `externalReference` | `asaas.test.ts` [4][26] | ✅ | — |
| Webhook duplicado/fora de ordem | `PaymentEvent` único; estado só por `GET` | `asaas.test.ts`, `payments.test.ts` | ✅ auto + sandbox | — |
| Reconciliação | `reconcile()`, ciclo horário | `asaas.test.ts` [10], Playwright P18 | ✅ | relatório (sem correção automática) |
| Estorno integral sem `value` | `provider.refund({full})` | `asaas.test.ts` P23 | ✅ auto + **sandbox `DONE`** | produção não confirmada |
| Cancelar estorno agendado | `cancelScheduledRefund` | `asaas.test.ts` P23 (3), Playwright | ✅ auto + sandbox | cancelado conta como `FAILED` em indicadores |
| Integral sem marcador | `syncRefunds` (vínculo sem ambiguidade) | `asaas.test.ts` P23 (3) | ✅ auto + sandbox | estorno manual de mesmo valor feito no painel pode ser vinculado |
| Estorno parcial no cartão | agendamento + retentativa (`classifyRefundFailure`, `retryDueRefunds`) | `asaas.test.ts` P16–P18 | ⛔ recusado no sandbox 28 e 29/10 | **principal risco financeiro** (Asaas) |
| Permissões das rotas de API | rotas usam `getCurrentContext`/`getDriver` e os serviços checam permissão; webhook verifica token/assinatura | `authz.test.ts`, `e2e:rotas` (P18/P19) | ✅ (rotas inalteradas desde então) | `e2e:rotas` não repetido nesta rodada |
| Logs sem segredos | `log.ts` remove campos por nome (senha, token, segredo, cartão, chave) | — | ✅ (nenhum log grava CPF/e-mail/telefone) | **valores** em mensagens de erro não são filtrados |
| Migrações explícitas | `Dockerfile` alvo `migrate`; app não migra | CI `docker`; banco isolado nesta rodada | ✅ | health não detecta migração pendente em banco **já existente** |
| Dependências | `npm audit` 0 / 0 | CI | ✅ | auditoria não substitui revisão de segurança |

## 2. Achados desta auditoria
| # | Severidade | Achado | Evidência / reprodução | Correção | Teste de regressão |
|---|---|---|---|---|---|
| F1 | **Baixa** | A leitura do valor do B3 aceitava formatos que não são reais: `"0x10"` → R$ 16, `"0b11"` → R$ 3, `"1e2"`/`"5e1"` → R$ 100/50, `"1_000"`, `"+50"`. Não furava a faixa, mas por chamada direta à ação o servidor cobraria um valor diferente do que alguém leria; mensagens mostravam "R$ 1.00" | sondagem de `validatePurchaseAmount` com esses textos: aceitos | `parseAmount` estrito (`^\d{1,6}([.,]\d{1,2})?$`) usado pelo servidor e pela tela; mensagens em pt-BR ("R$ 1,00") | `purchase.test.ts` "só aceita reais escritos como número decimal simples…" (falhava antes); `asaas.test.ts` B3 com `0x10`, `1e2`, `+50` recusados sem criar pedido |
| F2 | Baixa (documentação) | `CLAUDE.md` dizia que Docker/CI "nunca foram executados"; `docs/staging.md` dizia "sem remoto Git" | leitura dos arquivos | textos atualizados | — |
| F3 | Média (operação) | Com o servidor OCPP parado, pedidos não expiram, estornos não são retentados e alertas não rodam; o health só mostra `automation: stale` com HTTP 200 | observado em 28–29/10 (pedido parado por um dia) | **documentado** no runbook ("Diagnóstico rápido" e "Verificação pós-deploy"): monitorar `automation` | — (operacional) |
| F4 | Média (operação) | Health não acusa migração **pendente ou com falha** num banco já populado | código de `/api/health` | **não corrigido**: testar exigiria gravar uma migração falsa no banco de teste, com risco de travar o `migrate deploy` das próximas execuções. Mitigação: `migrate status` obrigatório no runbook | — |
| — | Premissa do pedido | "Modo por kWh funcionando conforme regras aprovadas": **não procede**; o kWh não é oferecido, por falta das decisões 4 e 6 | `docs/P23_B3_DECISOES_WAPE.md` | nenhuma | — |

Nenhum achado de severidade alta ou crítica foi reproduzido nesta rodada. Isso **não** equivale a afirmar que o sistema é seguro: não houve teste de intrusão, revisão de infraestrutura de staging (que não existe) nem teste em hardware.

## 3. B3 — estado de ativação (verificado)
| Garantia | Estado | Evidência |
|---|---|---|
| Backend impõe a ativação (não só a tela) | ✅ | `chargeAmountFor`: sem faixa, um valor enviado é recusado; com faixa, a ausência de valor é recusada |
| Configuração ausente ou inválida falha de forma segura | ✅ | `readPurchaseRange` → `UNDEFINED` (sem padrão) |
| `.env.example` sem valores comerciais | ✅ | `# CHARGE_AMOUNT_MIN=""` e `# CHARGE_AMOUNT_MAX=""` comentados |
| Limites não contornáveis por chamada direta | ✅ | validação no servidor antes de criar pedido/cobrança; F1 corrigido |
| Testes de ausência, inválido, abaixo, acima e válido | ✅ | `purchase.test.ts` (8), `asaas.test.ts` B3 (4) |
| Modo kWh | ⛔ não oferecido (decisões 4 e 6) | — |
| Ativação não altera sessões existentes | ✅ por construção | o valor só é lido em `startCharge`; sessões existentes guardam `fundedAmount`/`limitAmount` e tarifa congelada |
| Ativado em algum ambiente | **Não** (só no servidor de E2E, com faixa de teste) | `scripts/e2e-browser.ts` |

## 4. Pendências organizadas
### Dependências externas
| Item | Responsável | Evidência exigida |
|---|---|---|
| Decisões 1–7 do B3 (prioridade: mínimo e máximo) | comercial + financeiro WAPE | `docs/P23_B3_DECISOES_WAPE.md` preenchido e assinado |
| Respostas oficiais do Asaas (A1 mínimo de cobrança; B estorno parcial; C integral/idempotência; D webhooks; E sandbox × produção) | dono da conta Asaas | registro em `docs/P23_ASAAS_PERGUNTAS.md` (canal, data, texto) |
| Staging: domínio, TLS, cofre, banco gerenciado, backup, monitoramento | gestão WAPE + infraestrutura | ambiente no ar; runbook ensaiado |
| Carregador físico de bancada (estação `TEST`) | operações WAPE / fabricante | log de sessão real |
| Split real, mapa, carteira, pontos, planos, totem, notificações | ver diagnóstico §10 | ver diagnóstico §10 |
### Validações técnicas internas
| Item | Estado |
|---|---|
| Testes automatizados (271) e Playwright (21) | ✅ local; CI após o push desta rodada |
| Integração sandbox: ciclo completo pago → recarga simulada → devolução | ⏳ (feito em partes: pagamento, estorno integral, cancelamento) |
| Reconciliação financeira em staging | ⏳ (sem staging) |
| Observabilidade: alerta sobre `automation: stale` e fila de webhook interrompida | ⏳ (não há agregador/alerta externo) |
| Recuperação e rollback ensaiados | ⏳ (documentados no runbook; não ensaiados) |
| Revisão de segurança independente | ⏳ |
### Decisões de liberação
| Liberação | Critério de aceite | Quem aprova | Impede |
|---|---|---|---|
| Ligar B3 em homologação | decisão 1 assinada; checklist §1–§2 verde em sandbox | WAPE (comercial + financeiro) | faixa ausente; mínimo abaixo do mínimo do Asaas |
| Entrar em staging | ambiente provisionado; CI verde; migração explícita executada; verificação pós-deploy ok | responsável técnico + infraestrutura | qualquer critério de interrupção (runbook) |
| Produção | todos os itens aplicáveis concluídos com evidência; `GatewayActivation` aprovada por duas pessoas; Asaas confirmado; hardware homologado | diretoria WAPE (dois aprovadores) | **hoje: não autorizada** |

## 5. Checklist de homologação (`docs/P23_CHECKLIST_HOMOLOGACAO.md`) — situação
- **Aprovados com evidência**: todas as linhas da coluna **Auto**, exceto a compra por kWh. Na coluna **Sandbox**: Pix e cartão, pendente/expirado, webhooks duplicados, fora de ordem e com token inválido, estorno integral, cancelamento de estorno agendado, integral sem marcador e carregador que não inicia.
- **Reprovado no sandbox**: estorno **parcial de cartão** (recusado em 28 e 29/10).
- **Bloqueados**: B3 com faixa oficial (WAPE); compra por kWh (WAPE); mínimo de cobrança (Asaas); toda a coluna **Staging** (ambiente inexistente); toda a coluna **Físico** (sem carregador).

## 6. Operação e deploy
Procedimentos em `docs/runbook.md`: pré-requisitos e variáveis (sem valores), primeira implantação, saúde, **Deploy e migrações** (backup verificado → status → migração única pelo alvo `migrate` → status → health → promover; falha sem rollback automático), backup e restauração, rollback, e nesta rodada **Verificação pós-deploy**, **Diagnóstico rápido** e **Critérios para interromper uma homologação**.
Verificado nesta rodada: migrações em banco isolado (12 aplicadas, reaplicação sem efeito, 0 registros incompletos, banco removido). Docker local: daemon indisponível — imagens verificadas só no CI.

## 7. Testes executados nesta rodada (saída real)
| Comando | Resultado |
|---|---|
| `npm test` | 25 arquivos, **271/271** (os 270 de antes mais 1: leitura estrita do valor) |
| `npm run lint` / `npm run typecheck` | 0 / 0 |
| `node scripts/build-dist.mjs .next-build` | OK |
| `npm run e2e:build && npm run e2e:browser` | **21/21** |
| `npm audit` / `--omit=dev` | 0 / 0 |
| Migrações em banco temporário | OK (acima) |
| Docker local | **não executado** (daemon indisponível) |
| `npm run e2e:rotas` | **não executado** (grava sessões e usuários de teste no banco de desenvolvimento, que o servidor da porta 3001 usa) |
