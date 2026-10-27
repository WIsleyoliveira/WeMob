# Integração Asaas — guia de configuração e homologação

Referências oficiais (consultadas em 2026-10-27): [visão geral](https://docs.asaas.com/docs/visao-geral), [split](https://docs.asaas.com/docs/split-de-pagamentos), [portal](https://docs.asaas.com/).
Revalide endpoints, eventos e regras na documentação vigente antes de cada homologação.

## Arquitetura (resumo)
| Responsabilidade | Onde |
|---|---|
| Contrato de gateway (`PaymentProvider`, fluxo `PREPAID` para Pix) | `src/server/payments/provider.ts` |
| Configuração por ambiente (sem segredos na interface) | `src/server/payments/asaas/config.ts` |
| Único cliente HTTP do Asaas (`access_token`, `User-Agent`, timeout = resultado desconhecido) | `src/server/payments/asaas/client.ts` |
| Adapter: cobrança Pix, QR Code, remoção, estorno, consulta, busca por `externalReference` | `src/server/payments/asaas/provider.ts` |
| Mapeamento de status Asaas → local e tabela evento → transição (pura) | `src/domain/payments/asaas.ts` |
| Cliente do pagador (sem duplicar em retry; documento cifrado) | `src/server/payments/customers.ts` |
| Cobrança de recarga idempotente (`charge:<pedido>`, operação `PaymentOperation`) | `src/server/payments/charges.ts` |
| Webhook, máquina de estados, estorno, acerto, conciliação | `src/server/payments/service.ts` |
| Split: recebedores, política versionada, cópia por cobrança | `src/server/payments/split.ts`, `src/domain/payments/split.ts` |
| Habilitação de produção (Etapa E) | `src/server/payments/activation.ts` |

Regras invariantes: status local só muda pela consulta autenticada ao Asaas (o webhook apenas avisa); nenhuma rota pública altera status; timeout nunca gera nova cobrança sem antes procurar pela chave; estorno só é "concluído" com `refunds[].status = DONE`.

## Fluxo de uma recarga paga (Pix)
1. Motorista informa CPF/CNPJ em **Minha conta** (validado, cifrado com `DATA_ENCRYPTION_KEY`).
2. Pede a recarga → cobrança Pix do valor máximo (`PAYMENT_PREAUTH_AMOUNT`), com split se aplicável → QR Code e copia e cola.
3. Webhook `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` → consulta ao Asaas → pago → comando RemoteStart.
4. Fim da sessão → valor apurado; a diferença não consumida é **estornada uma única vez**; consumo acima do pago abre **análise** (sem cobrança complementar automática).
5. Pix não pago na janela (`PIX_PAYMENT_WINDOW_MINUTES`) → cobrança removida (`DELETE /payments/{id}`) e pedido `EXPIRED`. Pago mas carregador não iniciou → **análise** (sem estorno automático).

## Configurar credenciais sem expô-las
1. Crie uma conta no **ambiente de sandbox** do Asaas (cadastro separado da conta de produção, pelo link indicado em [Autenticação](https://docs.asaas.com/docs/autenticação-1)) e gere uma chave de API nessa conta (ver [Chaves de API](https://docs.asaas.com/docs/chaves-de-api)). Chaves de sandbox começam com `$aact_hmlg_`; as de produção com `$aact_prod_` — usar a chave no ambiente errado retorna 401. Guarde-a num cofre (1Password, Vault, segredo do provedor de hospedagem) — nunca no repositório, em logs ou em chats.
2. No servidor (não no navegador), defina:
   `PAYMENT_PROVIDER=asaas`, `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_SANDBOX_API_KEY=…`, `ASAAS_WEBHOOK_TOKEN=$(openssl rand -hex 32)`, `DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)`, `ASAAS_USER_AGENT=…`.
3. Cadastre o webhook (aplicação web ou API do Asaas) apontando para `https://<domínio>/api/payments/webhooks/asaas`, com o **mesmo** `ASAAS_WEBHOOK_TOKEN` como token de autenticação (chega no header `asaas-access-token`; nunca use a chave de API como token), e eventos de cobrança (incluindo `PAYMENT_SPLIT_*` se usar split). Ver a seção **Webhook** abaixo.
4. Abra **Pagamentos → Gateway e homologação**: a tela mostra se a configuração está completa (sem exibir valores).
5. Produção exige **três** condições de ambiente (`ASAAS_ENVIRONMENT=production`, `ASAAS_PRODUCTION_API_KEY`, `ASAAS_PRODUCTION_ENABLED=1`) **e** habilitação aprovada na plataforma por dois superadministradores distintos. A chave de produção é recusada em testes automatizados.

## Webhook: configuração e limites (docs consultadas em 2026-10-27)
- **Endereço público:** o Asaas precisa alcançar a URL. Em homologação local, use um túnel HTTPS temporário (ex.: Cloudflare Tunnel ou ngrok) apontando para a porta do `npm run dev`; em produção, o domínio com TLS. Não exponha o servidor de desenvolvimento por mais tempo que o teste.
- **Tipo de envio:** a WeMob consulta o estado real (`GET /payments/{id}`) a cada evento, então a ordem não importa → **não sequencial** (`NON_SEQUENTIALLY`, maior vazão). Sequencial também funciona, mas um evento lento atrasa os seguintes.
- **Entrega "pelo menos uma vez":** duplicatas são esperadas; tratadas pelo `id` do evento (`PaymentEvent` único por provedor+id).
- **Falhas:** o Asaas reenvia; após **15 falhas consecutivas** a fila pode ser **interrompida** (eventos continuam sendo gerados, mas não enviados até a reativação) e eventos ficam retidos por **14 dias**. Por isso a rota responde 200 após persistir o evento (`ackWebhookBeforeProcessing`) e reprocessa pendências pelo ciclo do servidor OCPP.
- **Lacuna conhecida:** evento persistido mas não processado aparece na conciliação (`UNPROCESSED_WEBHOOK`), mas **não gera alerta automático**; a interrupção da fila no Asaas só é percebida pela ausência de eventos. Até haver monitoramento, verifique o estado do webhook no painel do Asaas diariamente durante a operação assistida.
- **Até 10 webhooks por conta**, cada um com URL e eventos próprios.

## Cadastrar e validar postos recebedores (split)
- O cadastro do posto na WeMob **não** cria conta financeira. O posto precisa ter conta própria no Asaas (ou subconta, se a conta WeMob for elegível — verificar com o Asaas antes).
- O `walletId` é devolvido na criação de subconta ou pode ser recuperado pela API por quem tem acesso à conta de destino. Para conta própria do parceiro, ele informa o `walletId` (UUID). Em **Pagamentos → Split e recebedores**, uma pessoa cadastra (registrando a origem da informação) e **outra** valida. A plataforma nunca gera `walletId`.
- O `walletId` da própria WeMob (`ASAAS_OWN_WALLET_ID`) é recusado como recebedor (o resíduo do split fica na conta emissora).
- Recebedores são por ambiente: o `walletId` do sandbox não vale em produção.
- **A confirmar com o Asaas:** carteiras que recebem split fora do arranjo precisam estar numa **lista de carteiras autorizadas**; a remoção dessa lista cancela splits pendentes. Cobranças usadas como garantia em operações de crédito não podem ter split.
- Estorno de cobrança com split estorna também os repasses correspondentes (documentação oficial) — o parceiro deve conciliar esse efeito.

## Configurar e homologar o split
1. Confirme com o Asaas (Etapa C) a elegibilidade do split para recarga de VE, tarifas e regras de liquidação/estorno.
2. Crie a política (padrão da rede ou por unidade): participantes com **% do valor líquido** e/ou valor fixo, vigência, tratamento de tarifas e base contratual. Outra pessoa aprova. Versões aprovadas são imutáveis; cada cobrança guarda a versão aplicada.
3. **Atenção:** o percentual incide sobre o `netValue` (após tarifas). 50% no split ≠ 50% do valor cobrado. Se o contrato exigir divisão do bruto, documente a diferença e trate-a no fechamento mensal (P08).
4. Só então defina `ASAAS_SPLIT_ENABLED=1`. Qualquer impedimento (sem política, recebedor não validado, fixo maior que o valor) → cobrança **sem** split, com motivo registrado.
5. Eventos tratados: `PAYMENT_SPLIT_DONE` (liquidado), `PAYMENT_SPLIT_CANCELLED`, `PAYMENT_SPLIT_DIVERGENCE_BLOCK` e `…_BLOCK_FINISHED` (abrem análise).

## Homologação (etapas A–E)
| Etapa | Como verificar | Situação |
|---|---|---|
| A — Desenvolvimento | `npm test` (servidor Asaas falso em `tests/support/fake-asaas.ts`), lint, tipos, build | concluída — ver IMPLEMENTATION_STATUS |
| B — Sandbox oficial | `npm run asaas:homologar` (cliente, Pix, idempotência, QR, remoção); `-- --aguardar-pagamento=10` + confirmar no painel do sandbox para pagamento e estorno; webhook exige URL pública (ex.: túnel temporário) | **bloqueada: `ASAAS_SANDBOX_API_KEY` não configurada (P14, 2026-10-27). Nenhuma chamada real feita.** |
| C — Comercial | contato formal com o Asaas (elegibilidade, tarifas, liquidação, split, estornos, limites) | **pendente** |
| D — Infraestrutura | HTTPS, cofre de segredos, webhook público, backup/restauração, monitoramento, CI | **pendente** |
| E — Autorização final | solicitação + aprovação por superadministradores distintos em Gateway e homologação | **pendente** |

O relatório de cada execução de `asaas:homologar` fica em `docs/homologacao/` (sem chaves e sem documento completo). O servidor falso dos testes **não** prova compatibilidade com a API real.

## Situação da homologação (P14 — 2026-10-27)
| Item | Situação | Evidência |
|---|---|---|
| Código do adapter, webhook, estorno, split, conciliação | implementado | commit `a252e71` |
| Ciclo completo com servidor Asaas **falso** (30 cenários + extras) | testado (simulado) | 197 testes passando |
| Recusa do script sem configuração e em produção | verificado | saída do script, sem chamada de rede |
| Autenticação, cliente, Pix, QR, consulta, pagamento, webhook, idempotência, estorno no **sandbox oficial** | **não executado** | sem `ASAAS_SANDBOX_API_KEY` |
| Split no sandbox | **não executado** | sem chave, sem carteiras de teste, `ASAAS_SPLIT_ENABLED` desligado |
| Elegibilidade comercial, tarifas, liquidação, lista de carteiras autorizadas | **pendente** (Asaas) | — |

### Para destravar a Etapa B (passo a passo)
1. Crie a conta de sandbox e a chave (`$aact_hmlg_…`) conforme a seção de credenciais. **Não cole a chave no chat.**
2. No `.env` local, defina: `PAYMENT_PROVIDER=asaas`, `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_SANDBOX_API_KEY`, `ASAAS_WEBHOOK_TOKEN` (`openssl rand -hex 32`), `ASAAS_USER_AGENT`.
3. `npm run asaas:homologar` → confere autenticação, cliente, Pix, idempotência, QR e remove a cobrança.
4. `npm run asaas:homologar -- --aguardar-pagamento=10` → confirme o pagamento da cobrança indicada no painel do sandbox; o script consulta a cada 15 s (no máximo 10 min, sem criar nova cobrança) e faz estorno parcial de R$ 1,00.
5. Para webhook: túnel HTTPS + webhook cadastrado com o mesmo token; inicie uma recarga numa estação **TEST** pelo portal do motorista, pague no sandbox e confira em Pagamentos → detalhe: evento recebido, estado aplicado, reentrega sem reprocessamento.
6. Anexe o relatório de `docs/homologacao/` e os ids no IMPLEMENTATION_STATUS.

## Checklist de liberação para produção
- [ ] Etapa B concluída no sandbox oficial (itens acima, com ids registrados)
- [ ] Webhook público com TLS, token próprio, tipo de envio definido e monitoramento de falhas/interrupção da fila
- [ ] Etapa C: elegibilidade da recarga de VE, tarifas Pix, prazos de liquidação, estornos, split (disponibilidade, lista de carteiras autorizadas, efeito dos estornos) — confirmados por escrito
- [ ] Decisão contratual: base do 50/50 (bruto × líquido após tarifas) e tratamento da diferença no fechamento
- [ ] Recebedores de produção cadastrados e validados por duas pessoas
- [ ] Segredos em cofre; `DATA_ENCRYPTION_KEY` com backup próprio (sem ela, os CPFs cifrados ficam ilegíveis)
- [ ] Backup automatizado do banco e restauração testada no ambiente real
- [ ] Vulnerabilidades altas restantes tratadas ou com risco aceito formalmente
- [ ] `ASAAS_ENVIRONMENT=production`, chave de produção, `ASAAS_PRODUCTION_ENABLED=1`
- [ ] Habilitação aprovada na plataforma por dois superadministradores distintos
