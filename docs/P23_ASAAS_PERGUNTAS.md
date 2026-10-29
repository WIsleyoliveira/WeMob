# Perguntas técnicas ao Asaas (estorno parcial de cartão e cobrança)

**Preparado em**: 2026-10-29 · **Status**: NÃO ENVIADO. O envio cabe ao dono da conta Asaas; nenhuma mensagem externa foi enviada pela equipe técnica.
**Contexto observado no sandbox**: no pagamento de cartão `pay_fzvllcs4rjfnze8h` (R$ 100, `confirmedDate` 28/10/2026), o estorno **parcial** de R$ 75,10 (`POST /v3/payments/{id}/refund` com `value`) foi recusado em 28/10 e de novo em 29/10 com "Esta transação só pode ser estornada parcialmente no próximo dia." O estorno **integral** (mesmo endpoint **sem** `value`) foi aceito em 29/10 com HTTP 200; `refunds[0].status` ficou `DONE` e `description` veio `null`. Evidência: `docs/homologacao/estorno-75-10-2026-10-29.md`.

## O que depende da resposta (código atual)
| Ponto do sistema | Arquivo | Dependência |
|---|---|---|
| Devolução da sobra ao fim de toda recarga paga no cartão (estorno parcial) | `src/server/payments/service.ts` → `settleSessionPayment` | regra do parcial no cartão |
| Classificação "recusa temporária → agendar nova tentativa no dia seguinte" | `src/domain/payments/refund.ts` → `classifyRefundFailure` | se "próximo dia" é dia corrido, dia útil, após liquidação ou outro marco |
| Retentativa automática (máx. 5) | `retryDueRefunds` | quando tentar de novo sem desperdiçar tentativas |
| Integral sem `value` | `src/server/payments/asaas/provider.ts` | se vale igual em produção |
| Vínculo do estorno pelo marcador na descrição; integral sem marcador | `syncRefunds` | se a descrição é sempre descartada no integral |
| Valor mínimo da compra (B3) | `CHARGE_AMOUNT_MIN` | valor mínimo de cobrança por meio |

## Perguntas
### A. Cobrança
1. Qual o **valor mínimo** de cobrança por **Pix** e por **cartão de crédito**, em produção e no sandbox?

### B. Estorno parcial de cartão
1. Quais são as **condições** para o estorno parcial de uma cobrança de cartão `CONFIRMED`? A partir de quando ele é aceito: dia corrido, dia útil, após a liquidação (`creditDate`) ou outro marco?
2. A mensagem "Esta transação só pode ser estornada parcialmente no próximo dia." também ocorre em **produção**? Depende do adquirente ou da bandeira?
3. Existe **limite** de estornos parciais por cobrança, de valor mínimo por estorno ou de prazo máximo após a confirmação?
4. Um estorno parcial recusado assim pode ser **reenviado** com segurança? Há limite de tentativas ou penalidade?
5. Quais **status** um estorno parcial de cartão pode ter (`PENDING`, `DONE`, `CANCELLED`, `AWAITING_CRITICAL_ACTION_AUTHORIZATION` ou outro) e qual o **tempo típico** de cada transição?

### C. Estorno integral e identificação
1. O estorno **sem `value`** (integral) vale igual em produção para cartão confirmado no mesmo dia e no dia seguinte?
2. No integral, o campo `description` informado é **descartado** (veio `null` no sandbox)? Há algum campo nosso preservado no item de `refunds` (identificador próprio, `externalReference`) para conciliar sem depender do valor?
3. Existe **idempotência** no `POST /payments/{id}/refund`: o que acontece se a mesma requisição for enviada duas vezes por timeout? Há cabeçalho ou chave de idempotência?

### D. Eventos e conciliação
1. Quais **webhooks** são emitidos para estornos parciais e integrais (`PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_REFUND_IN_PROGRESS`, outros) e em que ordem? Podem chegar fora de ordem ou duplicados?
2. A soma de `refunds[].value` com `status = DONE` é a fonte oficial do valor devolvido? O status da cobrança (`REFUNDED` / `CONFIRMED`) é atualizado para estornos parciais?

### E. Sandbox × produção
1. Quais diferenças conhecidas existem entre sandbox e produção para estornos de cartão: regras de prazo, ação crítica no painel, descrição, webhooks?

## Registro da resposta
| Pergunta | Resposta oficial | Canal / protocolo | Data | Quem recebeu |
|---|---|---|---|---|
| | | | | |

Enquanto não houver resposta, o estorno **parcial** de cartão não deve ser considerado confiável para produção, que **não está autorizada**.
