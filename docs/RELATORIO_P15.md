# Relatório P15 — Homologação financeira, segurança e preparação para staging

Data: 2026-10-28 · Base: commit `4dc0528` · Ambiente: máquina local + **Asaas sandbox oficial** (`api-sandbox.asaas.com`). Nada foi implantado, nenhum push, produção não habilitada.

Legenda: **código** (implementado) · **simulado** (teste automatizado com servidor Asaas falso ou chamada montada por nós) · **sandbox** (resposta/evento real do Asaas sandbox) · **produção** (homologado em produção — nenhum item).

## 1. Testes executados
| Comando | Resultado |
|---|---|
| `npm test` | **18 arquivos, 210 testes passando** (eram 205; +5 de ciclo de cobrança) |
| `npm run lint` | saída 0 |
| `npm run typecheck` | saída 0 |
| `NEXT_DIST_DIR=.next-build npm run build` | **sucesso** (todas as rotas compiladas, standalone gerado, 307 MB; pasta removida depois). Build em pasta separada para não parar o servidor que atendia o webhook |
| `prisma migrate deploy` em banco **vazio** temporário | executado 2×: com as 8 existentes e, depois, com as **10** (incluindo as 2 novas do P15: índices parciais e `startRequestedAt`); `migrate diff` banco × schema = sem diferença; bancos removidos |
| `npm audit --omit=dev` | **0 vulnerabilidades** (eram 4 altas) |
| `npm run asaas:homologar` | `asaas-sandbox-20261028T1250.json`: todos os passos OK |

## 2. Cartão — evidências (sandbox)
| Etapa | Classificação | Evidência |
|---|---|---|
| Cobrança criada pelo portal do motorista (estação TEST, escolha "Cartão") | sandbox | `pay_fzvllcs4rjfnze8h`, R$ 100,00, `billingType CREDIT_CARD`, página `sandbox.asaas.com/i/…` |
| Pagamento com cartão fictício 4444… na página do Asaas (feito pelo usuário) | sandbox | status remoto `CONFIRMED` |
| Banco atualizado | sandbox | `CAPTURED`, recebido 100,00, **líquido 97,52, tarifa 2,48** |
| Origem da mudança | sandbox | auditoria `payment.status_changed` com `source: webhook:PAYMENT_CONFIRMED` |
| Autorização da recarga | sandbox | pedido → `START_REQUESTED`, 1 `REMOTE_START` enfileirado |
| Tela do pedido | verificado | "Aguardando o carregador iniciar", pagamento concluído. Observação: a verificação automática (a cada 10 s) parou às 12:42 porque o painel do navegador estava oculto e o navegador congela temporizadores; o webhook confirmou às 12:45 |
| Dados de cartão na WeMob | código | nenhum campo de cartão no schema; o cartão é digitado só na página do Asaas; o link só abre se for HTTPS `*.asaas.com` |
| Sem cobrança repetida após timeout | código + simulado | criação idempotente por `externalReference`; testes [4][5] |
| **Estorno parcial R$ 75,10 no mesmo dia** | sandbox | **recusado pelo Asaas: "Esta transação só pode ser estornada parcialmente no próximo dia."** Registro local: estorno `FAILED`/`REJECTED`, pagamento continua `CAPTURED`, nada marcado como devolvido |
| Estorno parcial no dia seguinte | **pendente** | possível a partir de 2026-10-29 |

## 3. Webhook externo — evidências
Infraestrutura temporária (autorizada): túnel **localhost.run** (SSH, porta 22 — a rede bloqueia a porta 7844 do túnel Cloudflare) → proxy local que só aceita `POST /api/payments/webhooks/asaas` (≤ 64 KB) → app. Webhook criado/atualizado/removido pela API (`npm run asaas:webhook`), `NON_SEQUENTIALLY`, token = `ASAAS_WEBHOOK_TOKEN`.

| Teste | Origem | Resultado |
|---|---|---|
| Área administrativa e outras rotas pelo túnel | chamadas nossas | `/`, `/app`, `/motorista`, `GET` do webhook, webhook de outro provedor → **404** |
| Sem token / token errado | chamadas nossas | **401**, nenhum evento gravado |
| Pagamento aprovado | **Asaas real** | `PAYMENT_CONFIRMED` 12:45:32 → 200, aplicado `CAPTURED` |
| Falha temporária | **Asaas real** | proxy desligado: Asaas registrou 4 falhas (`penalizedRequestsCount` 4), fila **não** interrompida |
| Reprocessamento | **Asaas real** | ~5 min depois o Asaas reenviou os 4 eventos (`PAYMENT_CREATED`/`PAYMENT_DELETED`) → 200; penalizações voltaram a 0 |
| Evento duplicado | chamada nossa com o token real, reenviando o id do evento real | "duplicado (já processado)", nada alterado |
| Evento fora de ordem | chamada nossa (`PAYMENT_CREATED` após `CONFIRMED`) | estado continua `CAPTURED` (vale a consulta ao Asaas); 1 único `REMOTE_START` |
| Cobrança desconhecida | chamada nossa e eventos reais das cobranças do script | registrado como pendente para a conciliação |
| Limpeza | — | webhook removido (`deleted: true`, lista vazia), túnel e proxy encerrados, sessão de teste revogada. Ficou a chave do host `localhost.run` em `~/.ssh/known_hosts` |

Observação operacional: o endereço gratuito do localhost.run **trocou 2 vezes em ~30 min**; foi preciso atualizar a URL (`PUT /v3/webhooks/{id}`, que preserva a fila). Não serve para staging.

## 4. Split
| Item | Estado |
|---|---|
| Código (política versionada, % sobre `netValue`, validação, sincronização, isolamento do parceiro) | código + simulado (P13) |
| Requisitos (docs Asaas) | cada recebedor precisa de **conta Asaas própria** e `walletId`; não usar o `walletId` da própria conta; lista de permissão só para split "fora do arranjo" |
| Pix/cartão aceitam split? | **não informado** na documentação consultada → confirmar com o Asaas |
| Teste no sandbox | **não executado**: exige `walletId` de uma segunda conta sandbox (não criamos contas) e `ASAAS_SPLIT_ENABLED=1` |
| Estorno com split | documentação: "os repasses relacionados também são estornados" |
| 50/50 | **não fixado em código** (política por versão). Pendente: base bruta × líquida (após tarifas) |

## 5. Vulnerabilidades
| Pacote | Antes | Ação | Estado |
|---|---|---|---|
| `zod` (GHSA-mrhx-c7xc-m3w5, alta) | 3.25.76 | **4.6.7**. Migração: 7 `errorMap` → `error`, 2 `z.record` com 2 argumentos, `.default({})` → `.prefault({})` (mantém os padrões internos). Mensagens padrão em português (`z.locales.pt`). Antes: todos os `z.array` já tinham `.max()` (caminho vulnerável mitigado) | **corrigida** |
| `deepmerge-ts` via `prisma`/`@prisma/config` (GHSA-ggr8-5vv4-36mx, alta ×3) | 7.1.5 | override **8.0.2** só no `@prisma/config` (mudanças incompatíveis da v8 não atingem o `deepmerge()` usado). `prisma validate/generate/migrate` OK | **corrigida** |
| `tinypool`, `@vitest/mocker` (dev, 2 críticas + 1 moderada) | vitest 3.2.4 | correção exige vitest ≥ 4.1.12; `npm install` falha com bug do npm 10.9.3 (`edgesOut`). Não forçado (`--legacy-peer-deps`/`--force`). Precondições ausentes: requer *prototype pollution* prévia / servidor Vite com plugin de mocks exposto | **pendente (só desenvolvimento)** |

Next.js: não atualizado — o `npm audit` não aponta vulnerabilidade nele após o override de `postcss` (P14).

## 6. Revisão do ciclo de cobrança — achados e correções
| # | Achado | Correção | Prova |
|---|---|---|---|
| 1 | **Prazo do carregador contado da criação do pedido**: com Pix/cartão pago após alguns minutos, o pedido era expirado logo após o pagamento e a sessão não era vinculada → **sem estorno da diferença** (encontrado no sandbox: pagamento após ~15 min) | coluna `startRequestedAt` (migration aditiva); prazos contam do pedido de início | teste falha com o código anterior (`expected 'FAILED' to be 'START_REQUESTED'`) e passa com a correção |
| 2 | **Cobrança duplicada por corrida** (dois pedidos simultâneos; dois motoristas no mesmo conector) | índices únicos parciais: 1 pedido aberto por motorista e por conector (migration aditiva) | 2 testes |
| 3 | **Recarga sem pagamento em produção** com etiqueta RFID `TEST-`/`SIM-` | bancada só fora de produção | teste |
| 4 | Consumo acima do pré-pago | mantido em **análise** (sem cobrança complementar) | — política pendente (seção 8) |

Ciclo verificado: estação → forma de pagamento → cobrança (sandbox) → confirmação (webhook real) → autorização → OCPP (`StartTransaction`/`StopTransaction` pelo mesmo handler do servidor, carregador simulado) → término → **R$ 24,90** (10 kWh × R$ 2,49) → estorno (recusado no mesmo dia para cartão). Conciliação e fechamento: cobertos pelos testes existentes; TEST/sandbox não entram em fechamento.

## 7. Infraestrutura
- Plano de staging: `docs/staging.md` (HTTPS/wss, segredos em cofre, backup diário + restauração mensal testada, logs e alertas).
- `next.config.ts`: `distDir` configurável por `NEXT_DIST_DIR` (padrão `.next`).
- Novo `npm run asaas:webhook` (listar/criar/atualizar/remover; só sandbox; token nunca impresso).
- Docker/compose/CI continuam **não executados**. Nada implantado.

## 8. Decisões comerciais/técnicas pendentes
1. **Estorno parcial no cartão só no dia seguinte**: escolher entre (a) agendar automaticamente o estorno da diferença para D+1 (recomendado; mesma chave idempotente), (b) pré-autorização (`authorizeOnly`) com captura do valor real — exige dados do cartão pela API/tokenização (escopo PCI) e confirmação de captura parcial, ou (c) cartão sempre em análise manual. Hoje: vai para **análise** com o motivo do Asaas.
2. **Estorno exige "autorização de ação crítica"** no painel (visto no Pix em P14): definir com o Asaas se estornos automáticos são possíveis na conta de produção.
3. **Consumo acima do pré-pago**: definir política (ex.: parar a recarga ao atingir o valor pago via `RemoteStop`/limite de energia) — hoje só análise.
4. Split: disponibilidade para Pix/cartão, carteiras de teste, base do 50/50 (bruto × líquido).
5. Tarifas reais de produção (sandbox: Pix R$ 0,99; cartão R$ 2,48 em R$ 100,00).

## 9. Bloqueios para produção
Webhook com domínio próprio e monitorado · decisões 1–4 acima · split homologado · carregador real homologado · deploy com TLS, cofre, backup e monitoramento · vitest (dev) · textos jurídicos e validação contábil · habilitação de produção aprovada por dois superadministradores (código já exige).
