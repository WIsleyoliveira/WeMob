# P23 · B3 — Compra da recarga por valor ou por kWh: especificação técnica (2026-10-29)

**Status (atualizado em 2026-10-29): compra por VALOR integrada e DESLIGADA por padrão** — liga só com `CHARGE_AMOUNT_MIN`/`CHARGE_AMOUNT_MAX` (decisão 1 da WAPE, `docs/P23_B3_DECISOES_WAPE.md`); sem elas o comportamento é idêntico ao anterior (`PAYMENT_PREAUTH_AMOUNT`). Compra por **kWh** só na regra pura (decisões 4 e 6). Nenhuma regra comercial inventada. Produção **NÃO AUTORIZADA**. Matriz de auditoria em §10.

Legenda: **[EM VIGOR]** já implementado e testado · **[PREPARADO]** código puro existente, não conectado · **[PROPOSTA]** desenho técnico ainda não aprovado · **[DECISÃO]** depende da WAPE/Asaas.

## 1. Telas e componentes afetados
| Tela / componente | Hoje [EM VIGOR] | B3 [PROPOSTA] |
|---|---|---|
| `src/app/motorista/start-form.tsx` (usado em `/motorista/estacoes/[identity]` e `/motorista/carregar/[identity]/[connector]`) | escolhe só Pix/cartão; valor fixo mostrado no texto da página | alternador "Por valor (R$)" / "Por energia (kWh)", campo numérico, resumo antes de pagar (§4) |
| `/motorista/estacoes/[identity]`, `/motorista/carregar/...` | texto "Antes do início cobramos R$ X (valor máximo da recarga)" | texto passa a refletir o valor escolhido; faixa mínima/máxima exibida |
| `/motorista/pedido/[id]` | mostra o valor da cobrança (`amountAuthorized`) | sem mudança estrutural; exibir o que foi escolhido (R$ ou kWh) |
| `/motorista/recarga/[id]` | barra do limite (`limitAmount`) e custo estimado | mostrar também "energia pedida" quando a compra foi por kWh (informativo) |
| `/motorista/recibo/[id]` | valor apurado, cobrado e estornado | incluir "valor escolhido" e a diferença devolvida |
| Totem (Fase F) | inexistente | reutiliza o mesmo componente/serviço |

## 2. APIs, serviços e modelos
| Peça | Hoje [EM VIGOR] | B3 [PROPOSTA] |
|---|---|---|
| `startSchema` / `startCharge` (`src/server/drivers/charging.ts`) | entrada: `identity`, `connectorId`, `method`; valor = `preauthAmount()` (`PAYMENT_PREAUTH_AMOUNT`, padrão 100) | entrada `mode: "AMOUNT" \| "ENERGY"` + `value`; servidor valida (§5) e calcula o valor a cobrar com `quoteByAmount`/`quoteByEnergy` contra a **tarifa vigente**; nunca aceita valor calculado pelo navegador |
| `createChargePayment` (`src/server/payments/charges.ts`) | recebe `amount`; idempotente por `charge:<chargeRequestId>` | sem mudança de contrato: recebe o valor calculado no servidor |
| `onSessionStarted` | congela tarifa no **início real**; `fundedAmount` = pago; `limitAmount = sessionLimit(funded, margem)` | sem mudança; ver §6 sobre tarifa alterada |
| `checkSessionLimit` / `enforceSessionLimits` | para a recarga no limite | sem mudança: o B3 só muda o valor financiado |
| `onSessionStopped` → `settleSessionPayment` | apura e devolve a diferença por estorno (pré-pago) | sem mudança (ver risco §6.5) |
| `ChargeRequest` (Prisma) | sem campo de valor escolhido | **migração aditiva** proposta: `purchaseMode` (`AMOUNT`/`ENERGY`, nulo = legado), `requestedValue Decimal(14,3)`, `quotedTariffId`, `quotedPricePerKwh Decimal(10,4)`, `quotedAt` — com `down.sql` |
| Regra pura | — | **[PREPARADO]** `src/domain/charging/purchase.ts` (`readPurchaseRange`, `validatePurchaseAmount`, `quoteByAmount`, `quoteByEnergy`) + `tests/unit/purchase.test.ts` (7 testes) |

## 3. Relação valor × energia × tarifa × arredondamento
- **[EM VIGOR]** Valor apurado = kWh × R$/kWh + minutos × R$/min, arredondado a centavos **HALF_UP** (`sessionAmount`). Limite da sessão = valor financiado × (1 − margem), arredondado **para baixo** no centavo (`sessionLimit`; margem `SESSION_LIMIT_MARGIN`, padrão 10%, faixa 2–30%).
- **[PREPARADO]** Por valor: energia máxima estimada = limite ÷ R$/kWh, arredondada **para baixo** em 0,001 kWh (nunca promete mais do que o limite cobre). Ex.: R$ 50 a R$ 2,40/kWh, margem 10% → limite R$ 45,00 → até 18,750 kWh.
- **[PREPARADO]** Por kWh: custo da energia = kWh × R$/kWh (HALF_UP, centavos); valor a cobrar = menor valor em centavos cujo limite cobre esse custo. Ex.: 10 kWh a R$ 2,40 → custo R$ 24,00 → cobra R$ 26,67 (limite R$ 24,00).
- **[PREPARADO]** Com tarifa por minuto (`pricePerMin > 0`) a energia **não** é estimável antes da recarga: compra por kWh indisponível; compra por valor sem estimativa de energia.
- **[DECISÃO]** Mostrar ao cliente o valor cobrado incluindo a margem (por kWh) — ou cobrar exatamente o custo e aceitar que a parada ocorra antes da energia pedida. A preparação segue a primeira opção porque é a única coerente com o limite em vigor.

## 4. Quando o preço é calculado e confirmado
1. **Cotação** (ao exibir o resumo): servidor calcula com a tarifa vigente e devolve valor, limite, energia estimada, data da tarifa. **[PROPOSTA]**
2. **Pedido** (`startCharge`): servidor **recalcula** com a tarifa vigente naquele instante e grava o cotado no `ChargeRequest`; valor do navegador é ignorado. **[PROPOSTA]**
3. **Pagamento**: valor recalculado vai ao gateway (idempotente). **[EM VIGOR]** para o valor fixo.
4. **Início real**: tarifa congelada na sessão (`onSessionStarted`). **[EM VIGOR]**
5. **Apuração**: pelo medidor + tarifa congelada; diferença devolvida. **[EM VIGOR]**

## 5. Validações
| Onde | Validação |
|---|---|
| Navegador (conveniência) | número positivo, até 2 casas (R$) ou 3 (kWh), dentro da faixa exibida; desabilitar envio duplo |
| **Servidor (obrigatório)** | faixa configurada (`readPurchaseRange`; ausente → **bloqueado**); `validatePurchaseAmount` sobre o valor **calculado** (inclusive na compra por kWh); tarifa vigente existe; modo suportado pela tarifa; estação com comunicação e conector disponível (já em vigor); limite de pedidos por hora e um pedido aberto por motorista/conector (já em vigor); CPF para pré-pago (já em vigor) |
| Gateway | valor mínimo de cobrança por meio de pagamento — **[DECISÃO/Asaas]** confirmar com o Asaas; não assumido |

## 6. Situações de falha e divergência
1. **Tarifa alterada entre cotação e início**: hoje vale a tarifa do **início real**. [PROPOSTA] gravar a tarifa cotada; no início, se a vigente diferir, **[DECISÃO]** honrar a cotada ou abortar antes do RemoteStart (sem cobrança nova; estorno integral se já pago).
2. **Carregador indisponível / não inicia**: [EM VIGOR] pedido `FAILED` no prazo, sem nova cobrança, pagamento em análise; estorno integral disponível pela equipe (sem `value`, aceito pelo Asaas no sandbox).
3. **Cancelamento antes do pagamento**: [EM VIGOR] cobrança removida no gateway.
4. **Falha de pagamento / Pix expirado**: [EM VIGOR] pedido `FAILED`/`EXPIRED`, nada cobrado.
5. **Energia consumida < estimada** (veículo para antes, bateria cheia): [EM VIGOR] diferença devolvida por **estorno parcial** — no cartão o Asaas recusou parciais no sandbox ("só pode ser estornada parcialmente no próximo dia") e a regra não é documentada: **risco** até confirmação do Asaas (§8-B).
6. **Consumo acima do limite** (atraso da parada): [EM VIGOR] análise, sem cobrança complementar automática.
7. **Sem telemetria / sem comunicação**: [EM VIGOR] última informação confiável, alertas, apuração no reencontro.

## 7. Testes necessários
| Tipo | Cenários |
|---|---|
| Unitários | **[FEITO]** `purchase.test.ts`: faixa ausente/mal configurada bloqueia; validação de limites e casas; energia pelo limite com arredondamento para baixo; tarifa por minuto sem estimativa; kWh → menor valor que cobre; Decimal sem ponto flutuante. **[A FAZER]** arredondamento de exibição |
| Integração | valor manipulado pelo cliente ignorado; faixa ausente bloqueia `startCharge`; valor calculado chega ao gateway (Asaas falso) e ao `fundedAmount`/`limitAmount`; compra por kWh para no limite; tarifa alterada entre cotação e início (conforme decisão); pedido idempotente com valor variável; settlement com diferença |
| Interface (Playwright) | alternar valor/kWh; resumo coerente com a tarifa; mensagens de faixa; clique duplo gera um pedido; tarifa por minuto oculta "por kWh"; 375 px e teclado |

## 8. Informações necessárias (bloqueiam a conclusão)
### A. WAPE (comercial + financeiro)
1. Valor **mínimo** e **máximo** por recarga (por meio de pagamento, se diferirem).
2. Modos oferecidos: só por valor, só por kWh, ou ambos; valores sugeridos (atalhos), se houver.
3. Se o valor fixo atual (`PAYMENT_PREAUTH_AMOUNT`) deixa de existir ou vira o padrão pré-selecionado.
4. Na compra por kWh: cobrar incluindo a margem de segurança (energia garantida até o limite) ou cobrar o custo exato (parada antes da energia pedida).
5. Arredondamento exibido ao cliente (kWh com quantas casas; R$ sempre 2).
6. Tarifa alterada entre a cotação e o início: honrar a cotada ou cancelar.
7. Comunicação da devolução da sobra (prazo no cartão × Pix) no resumo.
### B. Asaas
1. Valor mínimo de cobrança por Pix e por cartão.
2. Regra e prazo do estorno **parcial** de cartão (sandbox × produção) — condiciona a devolução da sobra no cartão.

## 9. Escopo
- **Primeira preparação (`9667972`)**: só a regra pura e esta especificação.
- **Integração por valor (atualização de 29/10)**: `startCharge`, a ação, o `StartForm` e as duas telas de início leem `CHARGE_AMOUNT_MIN`/`CHARGE_AMOUNT_MAX` (comentadas no `.env.example`, **sem valor**). Sem migração e sem mudança no contrato do pagamento. Os marcadores [PROPOSTA] das seções 1, 2 e 4 que tratam da compra **por valor** estão implementados (ver §10). Os de **kWh** e de tarifa cotada continuam como proposta.

## 10. Matriz de auditoria (2026-10-29, após a integração por valor)
| Requisito | Estado | Evidência no código | Testes | Decisão externa | Critério de aceite |
|---|---|---|---|---|---|
| Escolher por valor (R$) | **Implementado, desligado** | `startSchema.amount`, `purchaseOptions`, `chargeAmountFor` (`src/server/drivers/charging.ts`); `StartForm` com campo e resumo (`src/app/motorista/start-form.tsx`) | `asaas.test.ts` "B3 — compra por valor" (4); Playwright `compra-valor.spec.ts` | WAPE 1 (faixa), 2, 3 | faixa oficial configurada em homologação; checklist §1 verde em sandbox |
| Escolher por kWh | **Só preparação** (regra pura) | `quoteByEnergy` (`src/domain/charging/purchase.ts`); não exposto | `purchase.test.ts` | WAPE 2, 4, 6 | decisões registradas; integração + Playwright; tarifa cotada gravada (migração aditiva) |
| Validação no navegador | **Implementado** | `StartForm` desabilita envio fora da faixa / >2 casas | Playwright `compra-valor.spec.ts` | — | — |
| Validação no servidor (obrigatória) | **Implementado** | `chargeAmountFor` + `validatePurchaseAmount` antes de criar pedido/cobrança; sem faixa, valor do cliente é recusado | `asaas.test.ts` B3 (recusas sem criar nada) | — | — |
| Cálculo valor × energia × tarifa × margem | **Implementado** (por valor) | `quoteByAmount` usa `sessionLimit`; tarifa vigente da estação; sem impostos/taxas extras (não existem no `Tariff`) | `purchase.test.ts` | WAPE 5 (exibição); taxas extras (diagnóstico §4-10) | resumo = limite real da sessão (verificado: R$ 37,50 → limite R$ 33,75) |
| Precisão decimal e arredondamento | **Implementado** | Decimal; valor 2 casas; limite ROUND_DOWN; energia ROUND_DOWN 3 casas | `purchase.test.ts` | WAPE 5 | — |
| Confirmação antes do pagamento | **Implementado** (resumo) | `PurchaseSummary` (cobra/reserva agora, para em, energia estimada, tarifa confirmada no início, devolução) | Playwright | WAPE 7 (texto oficial) | texto aprovado |
| Integração com pagamento | **Implementado** | valor calculado no servidor → `createChargePayment` (idempotente por `charge:<pedido>`) | `asaas.test.ts` B3 (corpo do POST com `value` escolhido) | Asaas A1 (mínimo de cobrança) | — |
| Associação cliente/sessão/pedido/estação/conector/comando | **Em vigor** | `ChargeRequest` (driver, estação, conector, idTag, commandId, payment, session); paradas por transação | `payments.test.ts`, `asaas.test.ts` | — | — |
| Indisponível / recusado / falha / cancelamento / interrupção | **Em vigor** (inalterado) | `expireStaleChargeRequests`, `cancelChargeRequest`, `continueAfterPayment`, limite, alertas | suíte existente | — | checklist §3–§7 |
| Reconciliação pago × consumido × devolvido | **Em vigor** (inalterado) | `onSessionStopped` → `settleSessionPayment`; `reconcile` | suíte existente | Asaas B (parcial no cartão) | ciclo completo em sandbox com recarga real simulada |
| Idempotência (pedido, comando, webhook, pagamento) | **Em vigor** | índices parciais (1 pedido aberto por motorista/conector), `PaymentOperation`, `OcppMessage`, `PaymentEvent` | `asaas.test.ts` B3 "pedido repetido não gera segunda cobrança" + existentes | — | — |
| Registro do valor escolhido | **Implementado** (auditoria) | `charge.requested` com `purchase {mode, amount, pricePerKwh, pricePerMin, tariffValidFrom}`; valor cobrado em `Payment.amountAuthorized` | `asaas.test.ts` B3 | WAPE 6 (se a cotação precisar ser honrada → coluna própria) | — |
