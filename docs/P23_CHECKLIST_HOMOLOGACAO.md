# Checklist de homologação controlada — WeMob (P23)

**Atualizado em**: 2026-10-29. Cada linha tem quatro colunas independentes, e **nenhuma substitui as outras**:
- **Auto** = teste automatizado (Vitest/Playwright, gateway falso ou simulado, banco temporário);
- **Sandbox** = Asaas sandbox real (sem dinheiro);
- **Staging** = ambiente de homologação publicado (**ainda não existe**);
- **Físico** = carregador real de bancada (**ainda não disponível**).

Marcação: ✅ feito com evidência · ⏳ a fazer · ⛔ bloqueado (dependência indicada) · — não se aplica. Produção **NÃO AUTORIZADA**.

## 1. Recarga por valor e por kWh (B3)
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Sem faixa configurada: valor único legado; valor enviado pelo cliente é recusado | ✅ `asaas.test.ts` "B3 … sem faixa configurada" | ⏳ | ⏳ | — |
| Com faixa: valor escolhido vai ao gateway e define cobertura/limite | ✅ "B3 … o valor escolhido vai ao gateway" | ⛔ faixa da WAPE | ⛔ | ⛔ |
| Fora da faixa / >2 casas / sem valor: nada criado | ✅ servidor + ✅ Playwright `compra-valor.spec.ts` (tela) | ⛔ | ⛔ | — |
| Resumo antes de pagar coerente com tarifa e margem | ✅ unit `purchase.test.ts` + Playwright | ⛔ | ⛔ | — |
| Demonstração ignora a faixa | ✅ `payments.test.ts` "B3: na demonstração…" | — | ⏳ | — |
| Perfil EXEMPLO (R$ 5–500): funciona sem gateway de produção; recusado com gateway de produção; nunca em estação real | ✅ `purchase.test.ts`, `asaas.test.ts` "perfil de EXEMPLO…" + Playwright `compra-valor.spec.ts` | ⏳ | ⏳ | — |
| Faixa sem `CHARGE_AMOUNT_MODE` não liga o B3; produção exige `CHARGE_AMOUNT_APPROVAL_REF` | ✅ `purchase.test.ts`, `asaas.test.ts` | — | ⛔ decisão 1 | — |
| Compra por kWh | ⏳ (só regra pura) | ⛔ decisões 4 e 6 da WAPE | ⛔ | ⛔ |
| Energia real × estimada no veículo | — | — | — | ⛔ carregador físico |

## 2. Limites comerciais
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Faixa ausente/mal configurada bloqueia (sem padrão inventado) | ✅ `purchase.test.ts` | — | ⏳ | — |
| Faixa oficial aplicada | ⛔ decisão 1 da WAPE | ⛔ | ⛔ | — |
| Valor mínimo de cobrança do gateway respeitado | ⛔ pergunta A1 ao Asaas | ⛔ | ⛔ | — |

## 3. Pagamento
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Pix aprovado (webhook e consulta) | ✅ `asaas.test.ts` | ✅ P14–P15 (`docs/homologacao/`) | ⏳ | — |
| Cartão na página do Asaas | ✅ | ✅ P15 | ⏳ | — |
| Recusado | ✅ | ⏳ | ⏳ | — |
| Pendente / confirmação tardia | ✅ `payments.test.ts`, `asaas.test.ts` | ✅ | ⏳ | — |
| Pix expirado (cobrança removida) | ✅ | ✅ P14 | ⏳ | — |
| Clique duplo / pedido repetido: uma cobrança | ✅ (B3 incluso) | ⏳ | ⏳ | — |

## 4. Início e encerramento
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Ordem enviada ≠ aceita ≠ iniciada | ✅ `driver-state.test.ts`, Playwright C | — | ⏳ | ⛔ |
| Encerramento solicitado persiste; só encerrado com StopTransaction | ✅ Playwright "P23 B1" | — | ⏳ | ⛔ |
| Limite financeiro: uma parada no limite | ✅ `asaas.test.ts` limite | — | ⏳ | ⛔ |

## 5. Comando × sessão × conector
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Parada do motorista não usa a de outra transação da estação | ✅ `payments.test.ts` "dois conectores…" | — | ⏳ | ⛔ |
| Parada por limite não usa a de outra transação | ✅ `asaas.test.ts` "P23: a parada por limite…" | — | ⏳ | ⛔ |
| RemoteStart com conector/idTag do pedido; demonstração envia RemoteStart | ✅ | — | ⏳ | ⛔ |

## 6. Falhas de comunicação com o carregador
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Sem comunicação → disponibilidade desconhecida; início bloqueado | ✅ Playwright B2/C | — | ⏳ | ⛔ |
| Sem telemetria / parada não confirmada → alertas | ✅ | — | ⏳ | ⛔ |
| Carregador não inicia → pedido falha, sem nova cobrança, análise | ✅ | ✅ (pedido `cmvs3erfc…`, 29/10) | ⏳ | ⛔ |

## 7. Cancelamentos e estornos
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Cancelar pedido antes do pagamento | ✅ | ✅ P14 | ⏳ | — |
| Estorno parcial (Pix) | ✅ | ⏳ (P14 parou em ação crítica) | ⏳ | — |
| Estorno parcial (cartão) | ✅ (agendamento e retentativa) | ⛔ recusado 28/10 e 29/10 — perguntas B ao Asaas | ⛔ | — |
| Estorno integral sem `value` | ✅ | ✅ R$ 100 `DONE` (29/10) | ⏳ | — |
| Cancelar estorno agendado (só GET ao gateway) | ✅ + Playwright | ✅ (29/10) | ⏳ | — |
| Integral sem marcador vinculado sem ambiguidade | ✅ | ✅ (29/10) | ⏳ | — |

## 8. Webhooks
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Duplicados não reprocessam | ✅ | ✅ P15 (webhook real) | ⏳ | — |
| Fora de ordem / atrasados: estado vem da consulta (`GET`) | ✅ | ✅ | ⏳ | — |
| Assinatura/token inválido recusado | ✅ | ✅ | ⏳ | — |
| Retentativa com espera após falha | ✅ | ⏳ | ⏳ | — |

## 9. Reconciliação financeira
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Divergências (pagamento sem sessão, valor, provedor) | ✅ | ✅ (conciliação pela tela, P18) | ⏳ | — |
| Pago × consumido × devolvido (pré-pago) | ✅ | ⏳ ciclo completo em sandbox com recarga | ⏳ | ⛔ |
| Fechamento mensal só com PRODUCTION | ✅ | — | ⏳ | — |

## 10. Logs, auditoria e proteção de dados
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Ações financeiras auditadas (estorno, cancelamento, revisão, pedido com valor B3) | ✅ | ✅ | ⏳ | — |
| Logs sem segredos (chave do Asaas, tokens) | ✅ (redação) | ✅ | ⏳ | — |
| CPF cifrado; localização não enviada ao servidor | ✅ | — | ⏳ | — |
| Isolamento entre motoristas, parceiros e operadoras | ✅ + `e2e:rotas` (P18/P19) | — | ⏳ | — |

## 11. Carregadores físicos
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Boot, StatusNotification, StartTransaction, MeterValues, RemoteStop no limite, StopTransaction | ✅ (handler) | — | ⏳ | ⛔ equipamento de bancada |

## 11-B. Painéis de consumo e operação (P23 redesign)
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Consumo do motorista: só produção por padrão, teste sob pedido, valor confirmado, isolamento | ✅ `usage-series.test.ts`, `payments.test.ts` "consumo do motorista…", Playwright "redesign…" | — | ⏳ | — |
| Painel da equipe: uso por período, escopo da organização, dinheiro só com `payment:read` | ✅ `payments.test.ts`, Playwright "redesign…" | — | ⏳ | — |

## 12. Staging, configuração segura e rollback
| Item | Auto | Sandbox | Staging | Físico |
|---|---|---|---|---|
| Imagens Docker com migração explícita (503 → migração → 200) | ✅ CI `docker` | — | ⛔ staging inexistente | — |
| Readiness em `/api/health` no orquestrador | — | — | ⛔ | — |
| Segredos em cofre; `.env` fora da imagem | ✅ (`.dockerignore`) | — | ⛔ | — |
| `CHARGE_AMOUNT_MIN/MAX` só após a decisão da WAPE | — | — | ⛔ | — |
| Rollback: imagem anterior + migrações aditivas; `down.sql` só com backup e autorização | documentado (`docs/runbook.md`) | — | ⛔ ensaio | — |

## Pendências do projeto (preservadas)
Mapa, carteira, pontos, planos, totem, notificações, split real, carregador físico, staging e autorização de produção — responsáveis e critérios em `docs/P23_CX360_DIAGNOSTICO.md` §10–§11.
