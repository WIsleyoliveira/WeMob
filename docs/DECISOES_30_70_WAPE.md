# Regra comercial 30/70 — o que foi implementado e o que a WAPE precisa decidir

**Preparado em**: 2026-11-03 · **Para**: comercial + financeiro + jurídico WAPE · **Status das decisões abaixo: PENDENTE**.
Este documento registra decisões; não é proposta comercial nem compromisso da empresa.

## 1. Regra informada (oficial)
- WeMob: **30%** do faturamento bruto total mensal de cada posto. Operador do posto: **70%**.
- A antiga "taxa de sistema + gateway de 14%" foi **substituída**. Os 30% **não são lucro**: tarifas reais do gateway, tributos e custos ficam registrados à parte.

## 2. O que o sistema faz hoje (verificado por testes)
| Ponto | Comportamento | Onde |
|---|---|---|
| Cálculo | WeMob = bruto elegível × 30% (centavos arredondados meio para cima); posto = bruto − parte da WeMob → as partes **sempre somam o bruto** | `splitGross`, `src/domain/finance/settlement.ts` (motor `settlement-1.3.0`) |
| Bruto elegível | capturado − estornado de sessões de **produção** encerradas no mês + receita de recarga lançada externamente + outras receitas lançadas na unidade. Valor só autorizado, pendente ou **em disputa (chargeback)** não entra | `computeClosing`, `src/server/modules/finance/closing.ts` |
| Tarifas do gateway | descontadas conforme o contrato: WeMob, posto ou proporcional (30/70). **"A definir" + tarifa > 0 bloqueia a aprovação do fechamento** | `gatewayFeeBearer` em `ContractVersion` |
| Tributos e custos da unidade | exibidos à parte, **não** descontados de nenhuma das partes | `revenueShareLine` |
| Estorno depois do fechamento | o período fechado não muda; a correção entra como lançamento de **ajuste** no período aberto, e a participação acompanha o sinal (ajuste negativo reduz as duas partes) | política de ajustes já existente (P08) |
| Split já liquidado no Asaas | abatido do saldo a repassar ao posto | `partnerBalance` |
| Contratos antigos | continuam no cálculo antigo; a regra nova vale só a partir da vigência de um **aditivo aprovado por outra pessoa** (nada retroativo) | `ContractVersion.revenueShareRate` nulo = modelo antigo |
| Modelos comerciais de 14% | retirados de vigência pelo `npm run db:seed` (histórico preservado e auditado); o site público e o simulador mostram só a participação 30/70 | `retireLegacy14Models`, `src/server/bootstrap.ts` |
| Contrato novo | já nasce com 30% e tarifas "a definir" | `/app/contratos/novo` |
| Cenários de referência | Conservador R$ 17.928,00 → R$ 5.378,40 / R$ 12.549,60; Moderado 26.892,00 → 8.067,60 / 18.824,40; Realista 35.856,00 → 10.756,80 / 25.099,20; Otimista 53.784,00 → 16.135,20 / 37.648,80; Personalizado 8.964,00 → 2.689,20 / 6.274,80 — **ilustrativos, não faturamento realizado** | `tests/unit/revenue-share.test.ts` |

Nenhum dado real foi alterado: contratos existentes no banco de desenvolvimento continuam como estavam. Não existe integração de repasse (pagamento ao posto); o sistema só apura e registra.

## 3. Decisões necessárias
| # | Decisão | Por que é necessária | Se não decidir | Evidência de conclusão |
|---|---|---|---|---|
| 1 | **Quem suporta as tarifas do Asaas**: WeMob, posto ou proporcional | muda quanto cada parte recebe; o fechamento com tarifas fica **bloqueado** até haver resposta | nenhum fechamento de contrato 30/70 com tarifa pode ser aprovado | aditivo aprovado com `gatewayFeeBearer` preenchido |
| 2 | **Base elegível**: entram "outras receitas" lançadas na unidade (ex.: estacionamento)? Taxas de ociosidade? Recargas de demonstração/teste nunca entram (já garantido) | define o que é "faturamento bruto" | hoje entram recarga + outras receitas lançadas na unidade | redação do contrato + teste ajustado |
| 3 | **Tributos**: a WeMob recolhe tributos sobre o bruto todo ou só sobre os 30%? O posto recebe repasse ou fatura direto? | define a base tributária e se o fluxo é "cobrança pela WeMob + repasse" | o sistema mostra tributos estimados à parte, sem descontar | parecer contábil |
| 4 | **Custos da unidade** (energia, aluguel, manutenção): sempre do posto? | hoje aparecem à parte, sem desconto de ninguém | sem desconto | contrato |
| 5 | **Chargeback mantido** (cliente vence a disputa): sai das duas partes, só da parte do posto ou só da WeMob? | a disputa pode terminar depois do fechamento | o valor fica fora da receita enquanto está em disputa; perdido = ajuste negativo nas duas partes (regra técnica atual) | política assinada |
| 6 | **Modelos "compra integral" e "parceria 50/50"** (investimento e royalty de 5%/8%) continuam existindo com a participação 30/70, ou foram extintos? | o simulador e o site exibem só o 30/70; a divisão do investimento no 30/70 não foi informada | investimento de referência do portfólio (R$ 150.000, 100% do posto) só como premissa editável do simulador | definição comercial escrita |
| 7 | **Contratos já firmados com 14%**: migrar por aditivo (data de início) ou manter até o vencimento? | não aplicamos nada retroativo sem aprovação | continuam no modelo antigo | aditivos aprovados |
| 8 | **Prazo de repasse** ao posto (hoje padrão de 10 dias após o mês, editável por contrato) | prazo contratual | 10 dias | contrato |

## 4. O que não pode ser ativado até a decisão
- Aprovação de fechamento de contrato 30/70 com tarifas "a definir" (bloqueada pelo sistema).
- Qualquer repasse real ao posto (não há integração de pagamento ao posto; e o split real do Asaas ainda não foi validado — ver `docs/RELATORIO_FINAL_TECNICO.md`).
