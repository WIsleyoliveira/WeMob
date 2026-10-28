# Runbook operacional

> Estado: procedimentos escritos e parcialmente executados em desenvolvimento local. **Nenhum deploy, backup real, restauração em produção ou integração externa foi executado.** Ver checklist de produção em `docs/RELATORIO_FINAL.md`.

## Ambientes
| Ambiente | Banco | Pagamentos | Carregadores | Observação |
|---|---|---|---|---|
| Desenvolvimento | `DATABASE_URL` local | vazio ou `sandbox` | estações `SIMULATED`/`TEST` | `npm run db:seed` cria superadmin de dev; `npm run dev:users` cria usuários de teste (senha em `.env.dev-users`, ignorado pelo git) |
| Teste automatizado | `TEST_DATABASE_URL` (≠ `DATABASE_URL`, verificado) | sandbox dentro dos testes | simulador | truncado a cada arquivo de teste |
| Homologação/sandbox | banco próprio | `sandbox` | `TEST` | nunca apontar para o banco de produção |
| Produção | banco próprio, backup diário | **bloqueado** até existir adaptador de gateway real | `PRODUCTION`; comandos só com `OCPP_ALLOW_PRODUCTION_COMMANDS=1` + superadmin | seed de desenvolvimento recusa `NODE_ENV=production` |

Dados de estações `TEST`/`SIMULATED` nunca entram em fechamento financeiro nem, por padrão, em indicadores e alertas.

## Variáveis de ambiente (sem valores)
`DATABASE_URL`, `TEST_DATABASE_URL` (só CI/dev), `APP_SECRET` (≥ 32 bytes aleatórios), `SEED_ADMIN_PASSWORD` (só dev), `TRUST_PROXY` (1 apenas atrás de proxy que sobrescreve X-Forwarded-For), `PUBLIC_SITE_URL`, `OCPP_PORT`, `OCPP_PUBLIC_URL` (wss:// em produção), `OCPP_ALLOW_PRODUCTION_COMMANDS` (0 por padrão), `PAYMENT_PROVIDER` (vazio em produção até haver gateway real), `PAYMENT_SANDBOX_WEBHOOK_SECRET`, `PAYMENT_PREAUTH_AMOUNT`. Implantação inicial: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `OPERATOR_NAME` (só durante `npm run setup:first-admin`). Segredos devem vir de cofre/variáveis do provedor, nunca de arquivo versionado.

## Primeira implantação
1. Criar banco vazio e definir variáveis.
2. `npm run db:deploy` (aplica migrações; não destrutivo).
3. `ADMIN_EMAIL=… ADMIN_PASSWORD=… OPERATOR_NAME="Sansol Mob" npm run setup:first-admin` — cria perfis, operadora, funil, regras de alerta e SLA padrão e o **primeiro superadministrador**. Recusa-se se já houver superadmin. Não cria modelos comerciais aprovados (cadastrar e aprovar pela tela, com dois administradores).
4. Entrar, criar o segundo administrador (aprovações exigem duas pessoas) e trocar a senha inicial.
5. Subir o processo OCPP (`npm run ocpp:server`): além dos carregadores, ele executa o ciclo de automações (alertas, preventiva, tickets de motoristas, notificações) a cada minuto.

## Saúde e monitoramento
`GET /api/health` → 200 `{status:"ok", db:"ok", automation:"ok|stale|failing|never"}` ou 503 se o banco estiver inacessível (sem detalhes internos).
- Alarme recomendado: HTTP ≠ 200 por 2 min; `automation` ≠ `ok` por 5 min (processo OCPP/automações parado ou falhando).
- Execuções de automação (início, fim, erro, tentativa) em /app/alertas; falhas também em log `automation_failed`.
- Logs: JSON em stdout (`level`, `msg`, `time`); campos com nome de senha/token/segredo/cartão são mascarados. Não há agregador de logs nem métricas configurados (pendente).

## Deploy (procedimento — não executado)
1. `npm run check` verde no CI e `npm run build` sem erros.
2. Backup do banco (`pg_dump -Fc`).
3. `prisma migrate deploy` (executado no start do container). Nunca usar `migrate reset` fora do banco de teste.
4. Rollback de aplicação: reimplantar a imagem anterior. Migrações são somente aditivas; reversão de esquema exige migração nova.

## Backup e restauração
- Diário: `pg_dump -Fc "$DATABASE_URL" > sansol-$(date +%F).dump` com retenção de 30 dias em storage externo.
- Teste mensal: `pg_restore -d sansol_restore_test sansol-AAAA-MM-DD.dump` e `npm run db:deploy` contra a cópia.
- **Pendente:** automação e evidência do primeiro teste de restauração (ver IMPLEMENTATION_STATUS.md).

## Incidentes
- Acesso indevido suspeito: revogar vínculos em /app/usuarios (encerra sessões); consultar /app/auditoria.
- Pico de spam no formulário: limite por IP já ativo (5/h); ajustar em `submitPublicLead`.
- Logs: JSON em stdout (`level`, `msg`); nunca registrar senhas, tokens ou dados de cartão.

## Servidor OCPP (carregadores)
- Processo separado: `npm run ocpp:server` (porta `OCPP_PORT`, padrão 9220). URL do carregador: `wss://<host>/ocpp/<identidade>` com subprotocolo `ocpp1.6` e HTTP Basic (usuário = identidade, senha gerada no cadastro da estação).
- **TLS obrigatório em produção** (proxy reverso). Basic sem TLS expõe a senha.
- Comandos remotos ficam numa fila no banco; o servidor OCPP entrega os pendentes das estações conectadas a cada 1 s e marca TIMEOUT após 30 s sem resposta.
- Estação sem mensagens por mais de 2 × heartbeat + 60 s → `DISCONNECTED`, conectores `UNKNOWN`, sessões `COMMUNICATION_LOST` (varredura a cada 30 s e ao fechar o WebSocket).
- Comandos em equipamentos de produção: desligados por padrão (`OCPP_ALLOW_PRODUCTION_COMMANDS=0`) e restritos a superadministrador.
- Senha de carregador vazada: "Gerar nova senha" na página da estação e reconfigurar o equipamento.

## Pagamentos
- Provedor ativo por `PAYMENT_PROVIDER`: `sandbox` (gateway local simulado, só estações TEST) ou `asaas` (sandbox oficial ou produção — ver `docs/asaas.md`). Produção exige `ASAAS_PRODUCTION_ENABLED=1` **e** habilitação aprovada por duas pessoas.
- Webhooks: `POST /api/payments/webhooks/<provedor>`; 401 = token/assinatura inválidos (nada gravado); evento é gravado antes de processar; falha na consulta ao provedor → evento pendente com **espera crescente** (1, 2, 4… até 60 min) reprocessado pelo ciclo do servidor OCPP. Pendente > 30 min → alerta.
- Conciliação: automática a cada 1 h (job `payments.reconcile`, últimos 7 dias, resumo em Automações) e manual em /app/pagamentos. Só aponta divergências; nada é ajustado sozinho.
- Reembolso: /app/pagamentos/<id> (perfil financeiro/admin). Estados: *aguardando gateway* → *concluído*; *agendado* (recusa temporária, ex.: cartão só aceita estorno parcial no dia seguinte — nova tentativa 06:00 de Brasília); *resultado incerto* (timeout/5xx: consulta o gateway pelo marcador antes de reenviar); *falhou* (recusa definitiva ou 5 tentativas → pagamento em análise). Botão "Tentar agora" para resultado incerto ou agendado já vencido (não antecipa um agendamento do gateway — seria recusado de novo e consumiria tentativas). Split `REFUSED` abre análise imediata.
- **O servidor OCPP precisa estar no ar** para: retentativas de estorno e webhook, limites financeiros das sessões, expiração de pedidos, alertas e conciliação automática. `GET /api/health` mostra `automation: stale` se o ciclo parou.

## Limite financeiro das sessões
- Cada sessão paga recebe cobertura (pago − estornado, ou reservado) e limite = cobertura × (1 − `SESSION_LIMIT_MARGIN`).
- Verificado a cada MeterValues e a cada 30 s (preço por minuto cresce sem leitura). 90% → alerta "perto do limite"; 100% → `RemoteStopTransaction` automático (um só; repetido até 5× se expirar/falhar).
- **Contingência**: alerta "Limite atingido e parada NÃO confirmada" após 3 min → parar a recarga no equipamento/painel do fabricante. Consumo acima do pago fica em análise do pagamento; **não há cobrança complementar automática**.
- Sem MeterValues por 15 min → alerta de telemetria (limite só pelo tempo).

## Financeiro e contratos
- **Fechamento mensal**: /app/financeiro/fechamento → prévia do mês encerrado → resolver impedimentos (contrato aprovado vigente, tributo com vigência integral, ordem dos períodos) → "Solicitar" → **outra pessoa** com `finance:approve` aprova. A aprovação recalcula: se algo mudou desde a solicitação, o pedido vira "superado" e é preciso nova prévia.
- Período fechado não aceita lançamento, cancelamento nem nova vigência de contrato/tributo. Correção = **ajuste** (tela do fechamento), lançado no período aberto e ligado ao período corrigido.
- Repasse: provisionado na aprovação; após pagar **pelo banco**, registrar a baixa em Contas a pagar e receber (com referência do comprovante). A plataforma não inicia transferências (nenhum provedor configurado).
- Integridade: a tela do fechamento recalcula o SHA-256 do resultado gravado ("Registro íntegro"). Divergência = alteração fora da aplicação → tratar como incidente.
- Os valores são gerenciais; não substituem escrituração contábil nem apuração fiscal.

## Suporte, alertas e notificações
- Regras de alerta em /app/alertas (padrão criado na implantação; notificações desligadas até configurar canal). E-mail/SMS/WhatsApp: **nenhum adaptador configurado** — notificações ficam registradas como "não enviada — canal não configurado".
- Usuários recebem alertas só após consentir em Minha conta (opt-in revogável).
- Notificação com falha: até 5 tentativas com espera exponencial (1, 2, 4, 8 min); depois "falhou". Falha de notificação nunca gera alerta (sem laço).
- SLA em /app/suporte/configurar; mudar política não altera tickets já abertos.

## Rollback
1. Aplicação: reimplantar a imagem/versão anterior (migrações são aditivas, a versão anterior continua compatível com o esquema novo).
2. Esquema: **não** usar `migrate reset`. Reversão manual pelo `down.sql` da migração, somente com backup recente, janela de manutenção e autorização — os `down.sql` de P08/P09 apagam contratos, financeiro, tickets e alertas.
3. Dados financeiros: nunca editar fechamentos no banco; corrigir por ajuste.

## LGPD (titular motorista)
- "Baixar meus dados" (JSON) e "Excluir minha conta" em /motorista/conta. Exclusão anonimiza nome, e-mail, telefone, veículos, comentários e mensagens; encerra sessões e identificadores. Sessões e pagamentos ficam sem identificação direta para obrigações fiscais — **prazo de retenção a definir com jurídico/DPO**.
- Pedidos de titulares da equipe (usuários internos) e de leads: atendimento manual pelo administrador (sem tela dedicada).
