# Roteiros de homologação — físico (carregador) e financeiro (Asaas)

**Preparado em**: 2026-11-03 · **Estado**: roteiros prontos, **nenhum executado** (sem carregador físico e sem staging).
Regra para todos os passos: registrar **data/hora, quem executou, ambiente, evidência** (log, captura, ID do gateway) e o
resultado `APROVADO` / `REPROVADO` / `BLOQUEADO`. Sem evidência = não homologado. Nada aqui autoriza produção.

## Pré-requisitos
| Item | Como verificar |
|---|---|
| Ambiente de staging no ar (domínio, TLS, banco próprio) | `docs/staging.md` §1–3; `GET /api/health` → 200 com `schema: "ok"` |
| Monitor externo ativo | alerta disparando com `GET /api/health?exigir=automacao` parado (ver `docs/staging.md` §5) |
| Backup verificado antes de começar | `npm run db:backup:verificar` com resultado `OK` e o `.verificacao.json` arquivado |
| Estação cadastrada como **TEST** (nunca PRODUCTION na homologação) | `/app/estacoes/<id>` mostra ambiente Teste |
| Gateway em **sandbox** (`ASAAS_ENVIRONMENT=sandbox`) | `/app/pagamentos/gateway` mostra Sandbox |
| Comandos de produção desligados | `OCPP_ALLOW_PRODUCTION_COMMANDS=0` |

## A. Homologação física (carregador OCPP 1.6-J de bancada)
| # | Passo | Como executar | Evidência esperada | Critério de aprovação |
|---|---|---|---|---|
| 1 | Conexão inicial | apontar o carregador para `wss://ocpp-staging.<domínio>/<identidade>` com a senha da estação | `ocpp_connected` no log com `requestId` `ocpp:<identidade>:…`; BootNotification aceito | estação "Conectada" e conectores com status real |
| 2 | Autorização | RFID/idTag de teste e idTag do app | Authorize `Accepted` só para idTag válido; `TEST-`/`SIM-` recusados em PRODUCTION | idTag inválido recusado |
| 3 | Início remoto | pedido pelo app (`/motorista/carregar/<id>/<conector>`) após pagamento sandbox | RemoteStart `Accepted` → StartTransaction com o conector e idTag do pedido | tela vai de "ordem enviada" → "aceita" → "em andamento" |
| 4 | Medição | MeterValues a cada intervalo configurado | `SessionMeasurement` crescente; tela mostra energia, custo e horário da leitura | sem saltos negativos; horário coerente |
| 5 | Limite de consumo (energia) | — | **não oferecido** (compra por kWh depende de decisão da WAPE) | registrar BLOQUEADO |
| 6 | Limite de valor | pagar valor baixo (ex.: R$ 5 no perfil de exemplo) | ao atingir valor pago − margem: **um** RemoteStop; StopTransaction | parada no limite; captura ≤ valor pago |
| 7 | Limite de tempo | — | não suportado como modalidade (só estimativa) | registrar NÃO SUPORTADO |
| 8 | Parada pelo usuário | "Encerrar recarga" no app | um REMOTE_STOP da transação certa; "encerramento solicitado" persiste até o StopTransaction | não para outro conector |
| 9 | Parada pelo operador | `/app/estacoes/<id>` → parar | RemoteStop registrado com o usuário da equipe | auditoria do comando |
| 10 | Desconexão de rede | desligar a rede do carregador durante a recarga | sessão `COMMUNICATION_LOST`; tela "Carregador sem comunicação" com horário da última leitura; alerta na equipe | nunca mostra "disponível" sem comunicação |
| 11 | Reinicialização do carregador | Reset (Soft) pela equipe ou desligar/ligar | novo BootNotification; status reaplicado pelo relógio do carregador | sem sessão duplicada |
| 12 | Recuperação de sessão | religar a rede antes do fim | sessão volta a `ACTIVE`; StopTransaction posterior fecha com o medidor real | valor final = leitura do medidor × tarifa congelada |
| 13 | Finalização financeira | após o StopTransaction | captura (pré-autorização) ou estorno da diferença (pré-pago) no sandbox | `reconcile()` sem divergência |
| 14 | Comprovante | `/motorista/recibo/<id>` | estação, transação, medidor, tarifa, valor, pagamento/estorno | confere com o log OCPP |

## B. Homologação financeira (Asaas sandbox)
| # | Caso | Passo | Evidência | Status atual |
|---|---|---|---|---|
| 1 | Pix aprovado | pagar QR no sandbox | `PAYMENT_RECEIVED` + `GET /payments/{id}` = RECEIVED; recarga inicia | aprovado no sandbox (P14–P15) |
| 2 | Pix expirado | não pagar | cobrança removida; pedido EXPIRADO sem cobrança | aprovado (P14) |
| 3 | Cartão na página do Asaas | pagar com cartão de teste | CONFIRMED; nenhum dado de cartão no WeMob | aprovado (P15) |
| 4 | Webhook duplicado/fora de ordem/token inválido | reenviar pelo painel | um processamento; 401 sem token | aprovado (P15) |
| 5 | Estorno integral | estornar pagamento inteiro | refund `DONE`; pagamento REFUNDED; conciliado | aprovado (29/10) |
| 6 | **Estorno parcial de cartão** | pagar R$ 100 no cartão, estornar R$ 20 no mesmo dia (espera-se recusa "próximo dia" → SCHEDULED) e repetir no dia seguinte | refund parcial `DONE` com `confirmedAmount` | **REPROVADO** em 28 e 29/10 — aguarda resposta oficial do Asaas (`docs/P23_ASAAS_PERGUNTAS.md`) |
| 7 | Cancelamento de estorno agendado | cancelar pela tela com motivo | nada enviado ao gateway; saldo liberado | aprovado (29/10) |
| 8 | Split | cobrança com segunda carteira sandbox | split `DONE` com o valor sobre o `netValue` | **BLOQUEADO** (falta 2ª carteira) |
| 9 | Chargeback | simular disputa (se o sandbox permitir) | pagamento DISPUTED; fechamento avisa "em disputa" e não reparte | não testado no sandbox |
| 10 | Fechamento 30/70 | período com recargas de teste em estação TEST **não** entra (só produção) — para o ensaio, usar o ambiente de staging com estação de produção de bancada e tarifas definidas | WeMob 30% / posto 70% do recebido; tarifas conforme o contrato | depende da decisão sobre tarifas (`docs/DECISOES_30_70_WAPE.md` §3.1) |
| 11 | Exportação | demonstrativo e lançamentos em Excel | arquivos abrem no Excel com valores numéricos | validado automaticamente |
| 12 | Conciliação | `Conciliar período` | nenhuma divergência não explicada | validado automaticamente; real pendente |

## C. Critérios para interromper
Qualquer cobrança diferente da medição, comando aplicado a outro conector/transação, estação mostrada como disponível
sem comunicação, estorno duplicado ou dado pessoal em log → **interromper**, registrar e não seguir para produção.
