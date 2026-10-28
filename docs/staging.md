# Plano de staging (homologação integrada) — P15

Objetivo: um ambiente público, isolado da produção, onde Asaas **sandbox**, webhook, servidor OCPP e um carregador de bancada
conversam de ponta a ponta. **Nada disto foi implantado**: é o plano a executar com autorização. Produção continua bloqueada
(`ASAAS_PRODUCTION_ENABLED` ausente + habilitação aprovada exigida pelo código).

## 1. Topologia
| Componente | Proposta | Observação |
|---|---|---|
| App Next.js | 1 instância (container `Dockerfile` do repositório) atrás de proxy reverso com TLS | `npm run build` + `next start`; `TRUST_PROXY=1` só atrás do proxy |
| Servidor OCPP | processo separado (`npm run ocpp:server`), porta 9220 atrás de TLS (**wss://**) | também roda: expiração de pedidos, retentativas de webhook e de estorno, **limites financeiros das sessões**, alertas e conciliação automática — precisa estar sempre no ar (monitorar `automation` em `/api/health`) |
| PostgreSQL 14+ | gerenciado (backup automático e PITR) | banco próprio de staging; **nunca** reutilizar o de produção |
| Domínios | `staging.<dominio>` (app) e `ocpp-staging.<dominio>` | o webhook do Asaas aponta para `https://staging.<dominio>/api/payments/webhooks/asaas` |

Não usar túnel temporário em staging: o endereço gratuito do localhost.run trocou 2 vezes em ~30 min na homologação (P15).

## 2. Segredos
- Em cofre do provedor de hospedagem (ex.: secrets do orquestrador), injetados como variáveis de ambiente; nunca no repositório nem em imagem.
- Configuração (não secreta) relevante para dinheiro: `SESSION_LIMIT_MARGIN` (margem do limite financeiro, padrão 0,10), `PIX_PAYMENT_WINDOW_MINUTES`, `ASAAS_SPLIT_ENABLED` (com split, produção exige política aprovada e recebedor de produção validado).
- Por ambiente e independentes: `APP_SECRET`, `DATA_ENCRYPTION_KEY`, `ASAAS_SANDBOX_API_KEY`, `ASAAS_WEBHOOK_TOKEN` (≥ 32, diferente da chave), senhas de estação OCPP.
- Chaves do Asaas começam com `$`: no `.env` escrever `\$…`; em cofre o valor vai literal (sem escape).
- Rotação: chave de API do Asaas expira (a gerada em 2026-10 vence 24/11/2026) e é desativada após 3 meses sem uso; registrar data e responsável.
- `DATA_ENCRYPTION_KEY` com backup separado do banco (sem ela os CPFs cifrados ficam ilegíveis).

## 3. Implantação (quando autorizada)
1. Criar banco vazio → etapa de migração explícita (`docker compose --profile migrate run --rm migrate` ou job único com `migrate deploy`); conferir `migrate status` (verificado no P19: aplicação sobe sem migrar e o health indica `migrations_pending`).
2. `npm run setup:first-admin` com `ADMIN_EMAIL`/`ADMIN_PASSWORD` do cofre.
3. Subir app e OCPP; conferir `GET /api/health`.
4. `npm run asaas:homologar` (sandbox) e `npm run asaas:webhook -- criar https://staging.<dominio>`.
5. Cadastrar a estação de bancada como **TEST**; QR Code do conector aponta para `/motorista/carregar/<identity>/<conector>`.

### Observações do P18
- ~~O contêiner roda `prisma migrate deploy` a cada subida~~ — **resolvido no P19**: o contêiner só inicia a aplicação; a migração é a etapa explícita do runbook ("Deploy e migrações"), antes de promover a versão.
- O servidor de produção é `node server.js` (saída `standalone`); `next start` emite aviso nesse modo.
- Após subir, rodar `E2E_BASE=https://staging.<dominio> npm run e2e:rotas` apontando para o banco de staging **somente se** o `DATABASE_URL` for de um banco de desenvolvimento/staging (o script recusa nomes sem `_dev`; para staging, adaptar o guarda conscientemente).

## 4. Backup e restauração
- Backup automático diário + retenção de 7–30 dias (gerenciado) e `pg_dump` semanal fora do provedor.
- **Teste de restauração mensal** obrigatório: restaurar em banco temporário, comparar contagens das tabelas principais e o número de migrations (procedimento já exercitado localmente no P14, nunca em staging).

## 5. Monitoramento e logs
- Logs JSON do app e do OCPP (já estruturados, segredos redigidos) para um agregador; retenção mínima 30 dias.
- Alertas: health check do app, conexão do OCPP, erros 5xx, `payment_webhook_rejected` em sequência, `payment_settlement_failed`, divergências da conciliação, pedidos em análise.
- Webhook do Asaas: acompanhar `penalizedRequestsCount`/`interrupted` (`npm run asaas:webhook -- listar`); a fila é interrompida após 15 falhas seguidas. **Gap:** não há alerta automático para isso nem para eventos `UNPROCESSED_WEBHOOK`.

## 6. Critérios para sair do staging
Webhook real de pagamento, estorno (incluindo cartão no dia seguinte), split com carteira de teste, ciclo OCPP com carregador de bancada,
fechamento mensal com dados de staging e restauração de backup testada — cada um com evidência registrada em `IMPLEMENTATION_STATUS.md`.
