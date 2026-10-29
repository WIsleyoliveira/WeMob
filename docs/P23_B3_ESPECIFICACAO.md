# P23 · B3 — Compra da recarga por valor ou por kWh: especificação técnica (2026-10-29)

**Status: PREPARADO, NÃO IMPLEMENTADO NO FLUXO.** Bloqueado pela definição da WAPE (§8). Nenhuma regra comercial foi inventada; o fluxo de pagamento em vigor não foi alterado. Produção continua **NÃO AUTORIZADA**.

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

## 9. Fora do escopo desta preparação
Nenhuma tela, ação, migração ou mudança de contrato foi feita; o valor cobrado continua sendo `PAYMENT_PREAUTH_AMOUNT`. As variáveis `CHARGE_AMOUNT_MIN`/`CHARGE_AMOUNT_MAX` são **propostas** e não estão no `.env.example` nem são lidas por nenhum fluxo.
