# IMPLEMENTATION_STATUS — Sansol Mob Platform

Atualizado em 2026-10-28 (P21) · Etapas concluídas: **P01**, **P02 (auditoria)**, **P03 (design system)**, **P04 (CRM)**, **P05 (motor financeiro)**, **P06 (estações e OCPP)**, **P07 (motorista e pagamentos)**, **P08 (financeiro, contratos e repasses)**, **P09 (suporte, manutenção e alertas)**, **P10 (auditoria final)**, **P13 (integração Asaas — implementada)**, **P14 (homologação Asaas — sandbox: Pix, QR, pagamento e pedido de estorno confirmados; webhook e split pendentes; segurança revisada)**, **Pagamentos 2 (cartão, confirmação automática, telas do motorista)**, **P15 (cartão e webhook reais no sandbox, vulnerabilidades, build, revisão do ciclo)**, **P16 (estornos com retentativa, limite financeiro por sessão, webhooks com espera, conciliação automática)**, **P17 (auditoria final de aceitação)**, **P18 (homologação final — apto para staging; não apto para produção)**, **P19 (migrações explícitas, Playwright, Vitest 4 — 0 vulnerabilidades)**, **P20 (gate de staging — apto a iniciar staging; produção não autorizada)**, **P21 (preparação do CI remoto)**. Relatório final: `docs/RELATORIO_FINAL.md`. **Não pronto para produção** (ver checklist).

Classificação usada nos relatórios de etapa: **implementado** (código existe) · **testado** (teste automatizado e/ou verificação manual registrada) · **simulado** (funciona só com dublê/fake identificado) · **bloqueado** (depende de terceiro/credencial/decisão).

## P21 — Preparação para CI remoto e staging (2026-10-28)

Relatório: `docs/RELATORIO_FINAL_TECNICO.md` (seção P21). Sem push/deploy.

- Defeito corrigido: o build da imagem falharia (`.dockerignore` excluía `e2e/`, importado por `scripts/e2e-browser.ts` na checagem de tipos do `next build`). Verificado em contexto idêntico ao Docker, sem `.env`: falhava, agora compila; layouts `run`/`migrate` testados com banco temporário (503 → migração idempotente → 200).
- Achado: com banco incompatível, páginas que leem o banco respondem 500 — o tráfego só é barrado por readiness em `/api/health` (runbook atualizado). Sem `HEALTHCHECK` na imagem.
- `npm audit` 0/0. Testes não repetidos (nenhum código mudou desde o P19). Imagem real **não testada** (sem daemon).
- O repositório não tem remoto Git: CI remoto depende de configurar o remoto e autorizar o push. CI não exige secrets.
- CI remoto (execução 40750195389, após push autorizado para `WIsleyoliveira/WeMob`, público): job `docker` **verde** (imagens reais construídas; 503 → migração → 200); `check` com 232/232 testes, lint, tipos, auditoria 0 e build verdes, mas o Playwright falhou porque o `ubuntu-latest` virou 26.04 → hotfix CI-01: só o `check` em `ubuntu-24.04`; health dos Postgres de serviço com `-d` (eliminava `FATAL: database "ci" does not exist`).

## P20 — Homologação em staging e gate de produção (2026-10-28)

Relatório: `docs/RELATORIO_FINAL_TECNICO.md` (seção P20). Sem push/deploy.

- Defeito corrigido: a imagem final não migrava (`Cannot find module '@prisma/engines'`, reproduzido em layout isolado). Novo estágio `migrate` no Dockerfile (Compose usa `target: migrate`); verificado em layout isolado: app 503 `migrations_pending` → migração OK → 200. Imagem real **não construída** (sem Docker daemon); novo job `docker` no CI, não executado.
- Sem mudança de código desde o P19: regressão do P19 vale (232 testes, 14 Playwright, 700 rotas).
- Divergência: a tarefa agendada do estorno de R$ 75,10 citada no P18 não existe e o `ocpp:server` está parado — nada executará o estorno sozinho em 29/10. Não consultado nem antecipado.
- Limitação registrada: o health só detecta banco sem tabelas (migração pendente em banco existente exige `migrate status`).
- Decisão: apto a **iniciar** staging (primeiro passo: CI remoto verde); integrações e física bloqueadas externamente; produção não autorizada.

## P19 — Fechamento técnico, E2E real e preparação de deploy (2026-10-28)

Relatório: `docs/RELATORIO_FINAL_TECNICO.md` (seção P19). Commits locais: `0a5ba95` (migrações), `ddfdbb4` (Playwright), `df97c16` (dependências) e o registro de documentação. Sem push/deploy.

- Migrações fora do startup: contêiner roda só `node server.js`; serviço `migrate` (perfil) no Compose; health 503 `migrations_pending`. Verificado em banco temporário: app sobe sem criar tabelas; `migrate deploy` aplica 12 e é idempotente; 2 execuções simultâneas → 1 aplica, a outra "No pending". Imagem Docker **não testada** (sem daemon).
- Playwright 1.56.1: `npm run e2e:build && npm run e2e:browser` → **14 passed** no build de produção, banco temporário e gateway simulado (auth/isolamento, estorno com clique duplo, estados, recarga com limite/parada/sem comunicação, regressões P16–P18). Achou e corrigiu `loading.tsx` que travava server actions.
- Vitest 3.2.7 → 4.1.12: `npm audit` **0** (eram 2 moderadas de dev); lockfile do npm 10.9.3 (idempotente, 158/158 pacotes de plataforma); npm 11 rejeitado (remove 4 opcionais `@emnapi/*`).
- Regressão: `npm test` → 21 arquivos, **232 testes**; lint 0; typecheck 0; build OK; `e2e:rotas` 700/0 (produção); CI agora exige `npm audit --omit=dev` 0 e dev < moderada.
- Não testado: imagem/Compose em execução, CI no GitHub, instalação limpa em Linux/Windows. Estorno de R$ 75,10 não consultado nem modificado.
- Decisão: código aprovado; integrações e homologação física bloqueadas por terceiros; produção não autorizada.

## P18 — Homologação final e preparação para produção (2026-10-28)

Relatório: `docs/RELATORIO_FINAL_TECNICO.md` (seção P18), com matriz A–F, plano de reversão, checklist de produção e tabela de decisão. Commit local `f558e88` (autorizado após revisão).

- Defeitos corrigidos com regressão: "Tentar agora" antecipando estorno agendado pelo gateway (6 cliques → FAILED; agora recusado); split `REFUSED` sem análise imediata (agora análise + `SPLIT_REFUSED`).
- Testes novos: parada aceita sem `StopTransaction` não conta como parada; unitários de split.
- E2E de rotas/permissões versionado: `npm run e2e:rotas` (HTTP real, só banco de desenvolvimento) — 700 verificações, 0 falhas contra o build de produção.
- Verificação: `npm test` → 20 arquivos, **231 testes**; lint 0; typecheck 0; build OK (76 rotas); 12 migrations do zero; `npm audit --omit=dev` 0; dev: 2 moderadas (vitest).
- Asaas (leitura): cartão `pay_fzvllcs4rjfnze8h` `CONFIRMED`, sem estornos; estorno local `SCHEDULED` para 29/10 06:00 BRT — não antecipado.
- Decisão: apto para homologação externa em staging; não apto para produção.

## P17 — Auditoria final de aceitação (2026-10-28)

Relatório: `docs/RELATORIO_FINAL_TECNICO.md` (seção P17). Conclusão: **escopo de código completo para homologação; não pronto para produção** (dependências externas listadas).

- Defeitos corrigidos com regressão: (1) estorno enviado duas vezes com "Tentar agora" durante a retentativa automática — reproduzido (3 envios), corrigido com reserva única e atualização condicional; (2) alerta para estorno parado em `AWAITING_CRITICAL_ACTION_AUTHORIZATION`; (3) 404 em vez de tela de erro nas páginas de OS, chamado, contrato e fechamento com id inexistente (teste estático de proteção).
- Sandbox (somente leitura): `refunds[].description` volta íntegro (marcador funciona); cartão `pay_fzvllcs4rjfnze8h` sem estornos no Asaas, coerente com o local (`SCHEDULED` para 29/10 06:00 BRT). Janela não aberta: nenhuma tentativa antecipada.
- Navegador: barra de limite verificada com recarga de teste controlada (sem cobrança). Varredura de 70 rotas × 10 perfis: 0 erros 500.
- Verificação: `npm test` → 19 arquivos, **225 testes passando**; lint 0; typecheck 0; build OK (76 rotas); 12 migrations do zero sem diferença; `npm audit --omit=dev` 0; `npm audit` 2 moderadas (vitest; npm 11 resolveria, mas reescreve o lockfile — não aplicado).

## P16 — Finalização técnica (2026-10-28)

Relatório com evidências, inventário P0–P3 e dependências externas: `docs/RELATORIO_FINAL_TECNICO.md`.

| Categoria | Itens |
|---|---|
| **Sandbox oficialmente validado** | estorno parcial de cartão recusado ("próximo dia") agora registrado como **AGENDADO** para 2026-10-29 06:00 BRT (`pay_fzvllcs4rjfnze8h`), sem marcar devolução |
| **Teste automatizado** | estorno agendado/incerto/limite de tentativas/concorrência; acerto do cartão agendado; limite financeiro (aviso, parada única, varredura por tempo, contingência, repetição até 5×, excedente em análise); webhook com espera crescente e fila sem bloqueio; conciliação horária; trava de split em produção |
| **Código** | migrations `20261028150000_refund_retry_session_limit` e `20261028160000_payment_event_retry_backoff` (aditivas, `down.sql` testado); limites de requisição em pedir recarga, chamado e login de motorista por IP; saldo estornável correto na tela; base do repasse sem pré-seleção; `vitest` 3.2.7 + `tinypool` 2.1.2 |
| **Produção homologada** | **nada** |
| **Pendente / externo** | conclusão do estorno parcial no dia 29; split no sandbox (segunda carteira); permissões de estorno em produção; base do 50/50; carregador físico; deploy; `@vitest/mocker` (npm 10.9.3); E2E |

### Verificação (saída real)
- `npm test` → 18 arquivos, **222 testes passando**; `npm run lint` → 0; `npm run typecheck` → 0.
- `NEXT_DIST_DIR=.next-build npm run build` → sucesso, 76 rotas (pasta removida, `tsconfig.json` restaurado).
- Migrations do zero: 12 aplicadas, sem diferença com o schema; `down.sql` do P16 revertido com sucesso em banco temporário.
- `npm audit --omit=dev` → 0; `npm audit` → 2 moderadas (`@vitest/mocker`/`vitest`), 0 críticas/altas.

## P15 — Homologação financeira, segurança e preparação para staging (2026-10-28)

Relatório completo com evidências: `docs/RELATORIO_P15.md`. Plano de staging: `docs/staging.md`.

| Categoria | Itens |
|---|---|
| **Sandbox oficialmente validado** | Cartão: criação pelo portal, pagamento (cartão fictício), `CONFIRMED` → `CAPTURED`, líquido 97,52 / tarifa 2,48; **webhook real** `PAYMENT_CONFIRMED` aplicado; falha temporária real (4 penalizações) e **reenvio automático** do Asaas (~5 min); recusa real de estorno parcial no cartão no mesmo dia, registrada corretamente |
| **Simulado** (chamadas nossas ou servidor falso) | evento duplicado, fora de ordem, cobrança desconhecida, sem token/token errado (401), exposição do túnel (404); 210 testes automatizados |
| **Código** | índices únicos (1 pedido aberto por motorista/conector); `startRequestedAt` (prazos do carregador após o pagamento); bancada TEST-/SIM- recusada em produção; Zod 4; `deepmerge-ts` 8; `npm run asaas:webhook`; `distDir` configurável |
| **Produção homologada** | **nada** |
| **Pendente** | estorno parcial do cartão em D+1; split no sandbox (falta carteira de teste); decisões: estorno do cartão, autorização de ação crítica, consumo acima do pré-pago, base do 50/50; vitest (dev) |

### Verificação (saída real)
- `npm test` → 18 arquivos, **210 testes passando**; `npm run lint` → 0; `npm run typecheck` → 0.
- `NEXT_DIST_DIR=.next-build npm run build` → sucesso (pasta removida após o build; `tsconfig.json` restaurado, o Next o altera ao usar outro `distDir`).
- Migrations do zero em banco temporário: 10 aplicadas, sem diferença com o schema.
- `npm audit --omit=dev` → 0 vulnerabilidades (eram 4 altas). `npm audit` (dev) → 3 (vitest/tinypool), pendentes.

## Pagamentos 2 — cartão, confirmação automática e telas do motorista (2026-10-28)

### O que mudou
| Item | Situação | Evidência |
|---|---|---|
| **Confirmação automática** do pagamento na página do pedido, sem webhook (`syncPendingPayment`): no máximo 1 consulta ao Asaas a cada 10 s por pagamento, só do próprio pedido; falha de rede só é registrada | implementado e testado | teste de integração; no navegador, logs com `GET /payments/{id}` a cada ~10 s |
| **Cartão de crédito** pela página de pagamento do Asaas (`billingType: CREDIT_CARD`, `invoiceUrl`): a WeMob não recebe dados de cartão; mesmo fluxo pré-pago do Pix (cobra o máximo, estorna a diferença) | implementado; testado com servidor falso; **criação confirmada no sandbox oficial** | `asaas-sandbox-20261028T1123.json` (`pay_kx3n7m7tlszrms69`, página em `sandbox.asaas.com`, removida); pedido real pela tela em estação TEST (cobrança criada e cancelada) |
| Pagamento com cartão concluído (aprovação, estorno no cartão) | **não testado** no sandbox | depende de pagar na página do Asaas com cartão de teste |
| Link da página de pagamento só é exibido se for HTTPS do domínio `asaas.com` (`safeInvoiceUrl`) | implementado e testado | teste unitário |
| Escolha Pix/Cartão na tela da estação e do QR Code; textos corrigidos (antes falavam em "reserva/pré-autorização" mesmo no Pix) | implementado; verificado no navegador | — |
| **Correção:** estações de TESTE davam 404 no portal do motorista (a busca exigia estar na lista, que só tem produção) — agora abrem pelo link/QR direto, sem aparecer na lista | corrigido e testado | teste de integração |
| **Correção:** prazo do Pix mostrava a validade do QR do Asaas (1 ano); agora mostra o prazo real (janela da WeMob, 15 min) | corrigido; verificado no navegador | — |
| Página do pedido: barra de andamento (pagamento → carregador → recarga), estados de cancelado/expirado/falha, "nada foi cobrado" | implementado; verificado no navegador | — |
| Ajuda do motorista: perguntas sobre pagamento e estorno; status do chamado com rótulo em português | implementado | — |
| Equipe: coluna "Forma" na lista de pagamentos; rótulos por forma (Pix/Cartão/Pré-autorização) | implementado | — |
| Scripts carregam o `.env` com `scripts/load-env.mjs` (`@next/env`), mesma regra do app (escape `\$`) | implementado | comparação por hash: só a chave do Asaas difere entre os carregadores |
| `asaas:homologar`: tolera falhas de rede durante a espera e mostra mudanças de status | implementado | execução de 2026-10-28 11:03 |

### Verificação
- `npm run lint` → 0 problemas; `npm run typecheck` → 0 erros; `npm test` → **18 arquivos, 204 testes passando** (antes da inclusão do teste de estação TEST; +1 depois, executado isoladamente: passou).
- `npm run build` **não executado** nesta etapa (pouco espaço em disco: ~2,6 GB livres).
- Postgres local estava parado por trava antiga (`postmaster.pid` de antes de reiniciar o Mac, PID reaproveitado por outro processo); arquivo renomeado para `postmaster.pid.stale` e serviço reiniciado.

## P14 — Homologação real do Asaas e validação financeira (2026-10-27)

Base: commit `a252e71` (P13). Guia atualizado: `docs/asaas.md` (credenciais, webhook, split, situação da homologação e checklist de produção).

### Classificação
| Categoria | Itens |
|---|---|
| **Código implementado** | Adapter Asaas (Pix pré-pago), cliente HTTP, webhook com token e idempotência, estorno, split versionado, conciliação, habilitação de produção, telas de motorista/equipe/parceiro (P13) |
| **Testado com simulação** | 30 cenários do P13 + troca de CPF + isolamento do parceiro, contra o servidor Asaas falso (`tests/support/fake-asaas.ts`) |
| **Confirmado no sandbox oficial** | Autenticação, cliente, cobrança Pix, QR Code, idempotência, remoção, pagamento e pedido de estorno (2026-10-27/28, ver Etapa 2b). Conclusão do estorno, webhook e split **não** |
| **Pendente para produção** | Etapas B (sandbox), C (comercial), D (infraestrutura) e E (autorização); decisão do 50/50; vulnerabilidades restantes |

### Etapa 1 — Configuração do sandbox
- Variáveis no `.env` (verificadas só por presença, sem imprimir valores): `PAYMENT_PROVIDER`, `ASAAS_ENVIRONMENT`, `ASAAS_SANDBOX_API_KEY`, `ASAAS_WEBHOOK_TOKEN` **ausentes**; `DATA_ENCRYPTION_KEY` definida; nenhuma variável `ASAAS_*` no ambiente do shell.
- **Parada antes das chamadas autenticadas**, conforme a regra. Nenhum valor fictício foi gravado no `.env`.
- Necessário: criar a conta de sandbox do Asaas, gerar a chave (`$aact_hmlg_…`) e configurar localmente `PAYMENT_PROVIDER=asaas`, `ASAAS_ENVIRONMENT=sandbox`, `ASAAS_SANDBOX_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_USER_AGENT` (passo a passo em `docs/asaas.md`).

### Etapa 2 — Execução
- `npm run asaas:homologar` sem configuração → recusa: "Configuração do Asaas incompleta…" (sem chamada de rede).
- Com `ASAAS_ENVIRONMENT=production` e chave fictícia **apenas no processo** → recusa: "a homologação só roda com ASAAS_ENVIRONMENT=sandbox".
- Autenticação, cliente, cobrança Pix, QR/copia e cola, valor, vencimento, consulta, pagamento, atualização local, webhook, idempotência, conciliação e estorno no sandbox: **não executados** (bloqueio acima). Nenhum relatório em `docs/homologacao/`.

### Etapa 2b — Execução real no sandbox (2026-10-27, 21:09 UTC)
- Chave de sandbox configurada no `.env` local (git-ignorado) com escape `\$` — sem ele o Next.js lia a chave vazia; scripts passaram a carregar o `.env` por `scripts/load-env.mjs` (`@next/env`), mesma regra do app. Comparação por hash: só a chave do Asaas mudou entre os carregadores.
- `npm run asaas:homologar` → relatório `docs/homologacao/asaas-sandbox-20261027T2109.json` (sem chave/token; varredura: 0 ocorrências):
  - ✓ `GET /customers` 200 (autenticação)
  - ✓ `POST /customers` 200 → `cus_000009707289` (CPF de teste gerado, mascarado)
  - ✓ `POST /payments` 200 → `pay_ufafa2et0w7xmuh2`, PIX R$ 5,00, `PENDING`
  - ✓ `GET /payments?externalReference=…` → 1 cobrança (idempotência)
  - ✗ `GET /payments/{id}/pixQrCode` 400: "Você não possui uma chave Pix cadastrada para recebimentos de cobranças via Pix."
  - ✓ `DELETE /payments/{id}` 200 → remoto `DELETED`, local `CANCELLED`
- Após cadastrar chave Pix na conta de sandbox — `--aguardar-pagamento=10`:
  - 2026-10-27 21:10 (`asaas-sandbox-20261027T2110.json`): ✓ autenticação, cliente, Pix `pay_dkgac0vidqu7k2iu`, idempotência, **QR Code** (payload `000201…`). Espera interrompida por `UNAVAILABLE` (rede caiu, máquina em repouso); remoção também falhou → essa cobrança ficou `PENDING` no sandbox. Script corrigido: falhas de rede temporárias não encerram mais a espera.
  - 2026-10-28 10:50 (`asaas-sandbox-20261028T1050.json`): ✓ autenticação, cliente, Pix `pay_omba8dxf4tctxhpb`, idempotência, QR Code; ✗ pagamento não confirmado em 10 min (todas as consultas 200, status permaneceu `PENDING`); ✓ remoção (`DELETED`).
  - 2026-10-28 11:03 (`asaas-sandbox-20261028T1103.json`, **todos os passos OK**): Pix `pay_aksy7ycwtemzpz5r` confirmado no painel → status `PENDING` → `RECEIVED`, `netValue` 4,01 (tarifa de R$ 0,99 sobre R$ 5,00 no sandbox); estorno parcial de R$ 1,00 aceito (`POST /refund` 200) com status **`AWAITING_CRITICAL_ACTION_AUTHORIZATION`** — o Asaas exige autorização de ação crítica no painel; local permaneceu `CAPTURED` (estorno só conta quando `DONE`), como previsto em `mapAsaasPayment`.
- **Confirmado no sandbox:** autenticação, cliente, cobrança Pix, QR Code/copia e cola, consulta, idempotência, remoção, pagamento (`RECEIVED`), pedido de estorno. **Não confirmado:** conclusão do estorno (`DONE`, depende da autorização no painel), webhook, split.
- Ponto operacional: estornos via API podem ficar aguardando autorização de ação crítica no painel do Asaas; a operação precisa autorizá-los (ou ajustar os mecanismos de segurança da conta) para o motorista receber a devolução.

### Etapa 3 — Webhooks
- Sem URL pública HTTPS no ambiente. Documentado em `docs/asaas.md`: túnel temporário para homologação, token no header `asaas-access-token`, tipo de envio não sequencial (a WeMob sempre consulta o estado real), entrega "pelo menos uma vez", interrupção da fila após 15 falhas consecutivas e retenção de 14 dias.
- Duplicados, fora de ordem, retry e falha de consulta: cobertos **somente** pelos testes com servidor falso. **Não homologados.**
- **Lacuna encontrada:** falhas persistentes de processamento aparecem na conciliação (`UNPROCESSED_WEBHOOK`), mas não há alerta automático; a interrupção da fila do lado do Asaas não é detectada pela plataforma.

### Etapa 4 — Split e validação comercial
- Split **não homologado** (sem chave, sem carteiras de teste, `ASAAS_SPLIT_ENABLED` desligado).
- Confirmado na documentação oficial: percentual incide sobre o `netValue`; fixo (2 casas) e percentual (4 casas) combináveis sem prioridade; soma não pode exceder o líquido; bloqueio por divergência com prazo de 2 dias úteis; estorno da cobrança estorna os repasses. A página de split **não informa** se o split vale para Pix.
- **Novo item a confirmar:** carteiras que recebem split fora do arranjo exigem **lista de carteiras autorizadas** (a remoção cancela splits pendentes).
- A confirmar com o Asaas: elegibilidade da recarga de VE; cadastro/habilitação dos recebedores (conta própria × subconta); disponibilidade do split para a conta e para Pix; tarifas e prazos de liquidação; regras de estorno e efeitos no split.
- **Decisão pendente:** base do acordo 50/50 — valor bruto ou líquido após tarifas.

### Etapa 5 — Segurança e produção
| Vulnerabilidade | Situação | Ação |
|---|---|---|
| postcss (cópia interna do Next 8.4.31) — 4 avisos altos | **corrigida** | `overrides.next.postcss = 8.5.32` (mesma versão principal); some também o aviso moderado do Next |
| effect (CLI do Prisma) | **corrigida** | `overrides["@prisma/config"].effect = 3.22.4` (mesma versão principal) |
| deepmerge-ts / @prisma/config / prisma | mantida | correção só no Prisma 7 (migração com mudanças incompatíveis); afeta a CLI (migrate/generate), sem entrada externa |
| zod | mantida | correção só no Zod 4 (API `errorMap` muda); mitigação: tamanhos máximos nos schemas |

`npm audit --omit=dev`: **7 → 4** (0 moderadas). Após as mudanças: `prisma generate` e `migrate status` OK, typecheck 0, lint 0, **197/197 testes**, build compilado (CSS gerado com os tokens).

- **Segredos:** nenhuma chave `$aact_` no histórico nem na árvore; só `.env.example` versionado.
- **Bloqueio de produção:** coberto por testes (configuração incompleta, chave de produção recusada em testes, `productionReadiness` exige habilitação aprovada); início de recarga e autorização OCPP em estação de produção bloqueados no servidor.
- **Autorização por duas pessoas:** habilitação, políticas de split e validação de recebedores exigem pessoa diferente (testado).
- **Isolamento:** testes de acesso entre operadoras e do portal do parceiro passando.
- **Backup/restauração (ensaio local):** `pg_dump` do banco de dev (192 KB) → restauração em banco temporário → contagens idênticas em 6 tabelas e 8 migrações aplicadas (4 s); banco e arquivo temporários removidos em seguida. **Não é** backup de produção: a automação e o teste no ambiente real seguem pendentes. Atenção: `DATA_ENCRYPTION_KEY` precisa de backup próprio (sem ela, CPFs cifrados ficam ilegíveis após a restauração).
- Produção **não** foi habilitada.

### Disco
1,6 GB livres no início e 1,5 GB ao final (um único build). Nada do usuário foi apagado; a lista de limpeza segura está no P13.

### Arquivos alterados nesta etapa
`package.json` (overrides), `package-lock.json` (remoção da entrada fixa `node_modules/next/node_modules/postcss`), `docs/asaas.md`, `IMPLEMENTATION_STATUS.md`. **Sem commit** (aguardando autorização).

## P13 — Integração Asaas: Pix, split, estornos e homologação (2026-10-27)

Guia completo: `docs/asaas.md`. **Produção bloqueada** até as etapas B–E (sandbox oficial, validação comercial, infraestrutura e autorização).

### Fase zero (diagnóstico)
- **Disco:** 2,0 GB livres no início (volume de dados 100%); 1,6 GB após o único build. Nada foi apagado. Pode ser liberado **pelo usuário**, com segurança: `~/.npm/_cacache` (2,6 GB, `npm cache clean --force`), `~/Library/Caches/com.microsoft.VSCode.ShipIt` (1,4 GB, instaladores antigos do VS Code), `~/Library/Caches/pnpm` (679 MB), `~/Library/Caches/pip` (496 MB), `.next` deste projeto (323 MB, recriado no build). `~/Downloads` (7,3 GB) e `~/Library/Developer` (5,0 GB) exigem revisão manual.
- **Git:** branch `main`, último commit `5dff453` (P07–P10). Encontrado trabalho de Asaas **não commitado e não registrado** neste arquivo (~2.500 linhas: adapter, cobranças, clientes, split, ativação, migração `20261027170000_asaas_gateway`, 25 testes). Foi auditado e preservado; esta etapa o completou.
- **Banco:** 8 migrações, dev em dia (`prisma migrate status`). Sem reset.
- **Tipos:** 2 erros encontrados (estado `EXPIRED` ausente na tela do pedido; casts de ambiente no teste) — corrigidos.
- **Testes na retomada:** 17 arquivos, 195 testes passando antes das mudanças desta etapa.

### Defeitos encontrados e corrigidos
| Defeito | Evidência | Correção |
|---|---|---|
| Ao trocar o CPF, o cliente do Asaas era reaproveitado pela `externalReference` **com o documento antigo** | Teste novo falhou com o código anterior e passou após a correção | Referência inclui hash curto do documento (`wemob:driver:<id>:<sha256[0..12]>`) |
| Mensagem "Reembolso confirmado pelo provedor" exibida mesmo com estorno **pendente** no Asaas | Revisão de código | Mensagem conforme o status real (concluído × aguardando gateway) |
| `DATA_ENCRYPTION_KEY` ausente no `.env` de dev: salvar CPF falharia | Revisão de configuração | Chave gerada no `.env` local (fora do Git); documentada no `.env.example` |
| Perfis do banco de dev sem as permissões `payment:*` novas | Telas sem formulários no navegador | `npm run db:seed` (idempotente) |
| Script `asaas:homologar` citado no código mas inexistente | Revisão | `scripts/asaas-homologar.ts` criado |

### Implementado nesta etapa (sobre a base encontrada)
- **Motorista:** CPF/CNPJ em Minha conta (validação de dígitos, cifrado AES-256-GCM, exibição mascarada); painel Pix no pedido (QR gerado a partir do copia e cola do gateway, botão copiar, valor, validade, aviso de sandbox); "Já paguei — verificar" (consulta autenticada só do próprio pedido, limitada a 6/min); estado "Pagamento expirado".
- **Equipe:** `Pagamentos → Gateway e homologação` (configuração sem segredos, motivos do bloqueio de produção, checklist A–E, solicitar/aprovar/recusar/revogar habilitação com quatro olhos); `Pagamentos → Split e recebedores` (cadastro/validação/desativação de `walletId`, políticas versionadas com aprovação); detalhe do pagamento com método, líquido, tarifa, status no gateway, chave idempotente, split por participante e análise financeira (encerramento auditado).
- **Parceiro:** portal com as parcelas de split **somente da própria organização** (liquidado só com `DONE`; sandbox separado de produção).
- **Configuração:** bloco Asaas completo no `.env.example`; `npm run asaas:homologar` (recusa produção; relatório sem segredos em `docs/homologacao/`).

### Testes (resultado real)
`npx vitest run` → **17 arquivos, 197 testes passando** (inclui 27 do Asaas: os 30 cenários do prompt + troca de CPF + isolamento do painel do parceiro). `npm run lint` 0 · `npm run typecheck` 0 · `npm run build` compilado.
Os testes do Asaas usam um **servidor falso** (`tests/support/fake-asaas.ts`) que reproduz o formato documentado — **não** provam compatibilidade com a API real.

Navegador (localhost): telas de gateway, split e pagamentos renderizam o estado real ("não configurado", produção bloqueada); CPF inválido recusado; CPF válido gravado cifrado (`v1:…`, sem o número em claro) com dica `•••.•••.•••-09`; 375 px sem rolagem horizontal. **Não verificado no navegador:** painel Pix com cobrança real (exige credenciais de sandbox).

### Simulado / bloqueado / pendente
- **Bloqueado — Etapa B:** nenhuma credencial de sandbox no ambiente; `npm run asaas:homologar` recusa por configuração incompleta (verificado). Nenhuma chamada à API real foi feita.
- **Pendente — Etapa C (comercial):** elegibilidade da recarga de VE, tarifas por método, liquidação, disponibilidade do split, regras de estorno e de cadastro de recebedores.
- **Pendente — Etapa D (infraestrutura) e E (autorização final).**
- **Decisão comercial pendente:** base do 50/50 (bruto × líquido após tarifas). O split do Asaas incide sobre o líquido.
- **Limitações:** só Pix (cartão não implementado); sem cobrança complementar automática (consumo acima do pago → análise); RLS no Postgres não aplicado (isolamento na aplicação, testado); chargeback apenas sinalizado; `npm audit --omit=dev` mantém 6 altas + 1 moderada (Next, Prisma, Zod — upgrade major).

### Próxima sessão
1. Obter chave do sandbox do Asaas, configurar o `.env` local e rodar `npm run asaas:homologar`, depois `-- --aguardar-pagamento=10` confirmando no painel do sandbox.
2. Expor o webhook (túnel temporário) e validar entrega, token e reentrega; registrar ids em `docs/homologacao/`.
3. Com carteiras de teste, homologar o split (`PAYMENT_SPLIT_DONE`) e a divergência.
4. Levar a lista da Etapa C ao Asaas e registrar as respostas.

## P10 — Auditoria final de segurança, qualidade e prontidão (2026-10-27)

### Achados comprovados e correções
| # | Achado | Como foi comprovado | Correção | Status |
|---|---|---|---|---|
| F1 | Pagamentos (lista, detalhe, reembolso, conciliação) sem escopo por operadora: outra operadora veria/reembolsaria pagamentos alheios | Teste de isolamento **falhou** com o código anterior | `operatorPaymentScope` (estações da operadora via sessão ou pedido) | testado |
| F2 | Portal do motorista sem acesso/eliminação de dados (LGPD) | Revisão | Exportação JSON e exclusão por anonimização (registros fiscais retidos sem identificação) | testado |
| F3 | Sem Content-Security-Policy | Revisão | CSP `default-src 'self'` (+ `'unsafe-inline'` em script; `'unsafe-eval'` só em dev) | navegador |
| F4 | Sem procedimento para o 1º administrador em produção | Revisão (seed recusa produção) | `npm run setup:first-admin` | banco descartável |
| F5 | Health check não indicava automações paradas | Revisão | campo `automation` (ok/stale/failing/never) | testado |
| F6 | Arrays de entrada sem limite (advisory de memória do Zod) | `npm audit` + varredura | `.max()` em todos os arrays de entrada | revisão |
| F7 | Página do motorista acessava o banco direto | Varredura | `getMyChargeRequest` no serviço | typecheck |

Verificado sem defeito: autorização em todo serviço que recebe contexto (varredura automática + revisão das 2 exceções), sem SQL cru inseguro, `dangerouslySetInnerHTML` só no SVG do QR gerado pela biblioteca, cookies `httpOnly`/`sameSite=lax`/`secure` em produção, sem CORS, logs com redação de campos sensíveis, downloads com `CSP: sandbox` + `nosniff`.

### Comandos e resultados (P10)
`npx vitest run` → **16 arquivos, 170 testes passando** (180,8 s) · lint 0 · typecheck 0 · `npm run build` OK (74 rotas) · `npm audit --omit=dev` → 6 altas + 1 moderada, 0 críticas (Next/postcss, Zod, deps do Prisma; exigem upgrade major — **não resolvido**).

### Pendente / bloqueado
E2E (Playwright) e axe automatizados não executados; Docker/CI não executados; deploy, TLS, backup/restauração e monitoramento não executados; MFA; RLS. Checklist completo em `docs/RELATORIO_FINAL.md`.

## P09 — Suporte, SLA, manutenção, alertas e automações (2026-10-27)

### Implementado e testado
| Requisito | Teste |
|---|---|
| Tickets: categoria, prioridade, origem, responsável, estação/unidade, comentários, anexos, histórico; transições validadas | integração + navegador |
| SLA por prioridade (ou contrato), 24×7 ou horário útil (America/Belem), cópia no ticket, pausas com motivo descontadas | unit (sexta 17h → segunda 9h = 120 min) + integração + navegador |
| Solicitação do motorista → ticket (uma única vez) | integração |
| OS: diagnóstico, técnico, agendamento, checklist, peças, custo, evidência obrigatória; custo vira despesa de manutenção (2 × 125,56 + 200 = 451,12) | integração |
| Preventiva por tempo/kWh/sessões; uso só com telemetria confiável; 1 OS aberta por plano (índice parcial; execução concorrente gera 1) | unit + integração |
| Alertas: offline, falhas repetidas, queda de disponibilidade, sessão interrompida, divergência de pagamento; teste/simulação fora por padrão | integração |
| Deduplicação (índice único parcial; avaliação concorrente cria 1), cooldown reabre sem novo ticket/notificação, ocorrência tratada manualmente não é recriada, escalonamento único eleva ticket | integração |
| Notificações: canal não configurado e falta de consentimento registrados; retentativa exponencial até 5; reenvio não duplica; falha não gera alerta | integração (adaptadores falsos) |
| Execuções de automação com sucesso/falha/tentativa | integração + navegador |
| Painel: disponibilidade, indisponibilidade, MTTR, SLA de resposta/solução com fórmulas | integração (MTTR 7 h; SLA 50%) + navegador |

### Defeito encontrado e corrigido
Estação offline gerava também "queda de disponibilidade" (dois alertas para a mesma causa) — detectado por teste; a regra de disponibilidade agora ignora estações sem comunicação.

### Simulado / bloqueado
Nenhum provedor de e-mail/SMS/WhatsApp: envio real **não testado** e exibido como "NÃO configurado". Feriados fora do SLA. Ciclo de automações roda dentro de `npm run ocpp:server` (não executado continuamente nesta verificação).

### Migração
`20261027145414_finance_support_alerts` (aditiva, 18 tabelas + 4 índices únicos parciais) + `down.sql`.

## P08 — Financeiro, contratos, parceiros e repasses (2026-10-27)

### Implementado e testado
| Requisito | Teste |
|---|---|
| Contratos com parceiro, unidades (vinculadas ao parceiro, uma por contrato ativo), status com motivo, anexos | integração + navegador |
| Versões imutáveis (original + aditivos) com autor, data e motivo; aprovação por pessoa ≠ autor; vigência por versão aprovada | integração + navegador |
| Contas a pagar/receber: provisionado × baixado (baixa manual com referência, sem transferência), cancelamento com motivo | integração + navegador |
| Tributos configuráveis por vigência | integração + navegador |
| Royalties e repasses só com versão de contrato APROVADA; bases bruto/líquida/resultado; prejuízo rateado ou compensado | unit (10) + integração |
| Fechamento: prévia → validações → solicitação → aprovação por outra pessoa com recálculo e hash; pedido superado se os dados mudarem; 1 aprovado/pendente por período; aprovações concorrentes: 1 vence | integração + navegador |
| Período fechado bloqueia lançamento, cancelamento e novas vigências; correção por ajuste sem alterar o fechamento | integração |
| Demonstrativo rede/parceiro/unidade/estação; provisionado × pago | integração + navegador |
| Portal do parceiro: indicadores, contratos, documentos visíveis, extratos só próprios, CSV auditado | integração + navegador |
| Exportações com permissão e auditoria; downloads de anexos auditados | integração + navegador |
| Transferência bancária nunca iniciada sem provedor | integração |

### Exemplo reproduzível (teste e navegador)
Bruto 1.000,00 · tributo 6% = 60,00 · taxa de sistema 10% = 100,00 · líquida 840,00 · royalty 8% s/ líquida = 67,20 · energia 300,00 · resultado 472,80 · repasse 50% = **236,40** (vencimento = fim do mês + 10 dias).

### Defeito encontrado e corrigido
Receita de recarga lançada de sistema externo aparecia como "outras receitas" no demonstrativo (total correto) — detectado no CSV pelo navegador; motor `settlement-1.1.0` + teste. Fechamentos já aprovados mantêm o snapshot da versão com que foram calculados.

### Limitações
Sem rateio por dia (troca de condição/tributo no meio do mês bloqueia o fechamento); reembolso após o fechamento exige ajuste manual; despesas sem unidade não são rateadas; resultados gerenciais — **não substituem contabilidade nem orientação fiscal**; assinatura eletrônica e nota fiscal não implementadas.


## P02 — Auditoria e correção da fundação (2026-10-27)

### Achados comprovados e correções
| # | Achado | Como foi comprovado | Correção | Status |
|---|---|---|---|---|
| A1 | Aprovar versão com vigência futura encerrava a versão atual imediatamente → modelo ficava **sem condição vigente** até a data | Teste `audit-findings.test.ts` falhou antes da correção | Versão atual permanece até `effectiveFrom` da nova; consultas usam janela `effectiveFrom ≤ agora < effectiveTo`; bloqueio de 2 versões agendadas; UI mostra Rascunho/Agendada/Vigente/Encerrada | testado |
| A2 | Administrador podia **revogar o próprio acesso** (lock-out) | Teste falhou antes da correção | Bloqueio de auto-revogação, de revogação duplicada e do último administrador | testado |
| A3 | **Não havia recuperação de senha** nem troca de senha | Revisão de código | Link de uso único (1 h, só hash persistido) gerado pelo admin; troca de senha com senha atual; ambos encerram sessões; solicitação pública neutra | testado |
| A4 | Admin de uma organização poderia redefinir senha de usuário que **também pertence a outro tenant** (tomada de conta entre tenants) | Revisão de código (risco de design ao criar A3) | Bloqueado quando o usuário tem vínculos em outras organizações | testado |
| A5 | `X-Forwarded-For` aceito sem proxy confiável → limite por IP contornável forjando o cabeçalho | Revisão de código | IP só é lido com `TRUST_PROXY=1`; teto global de 300 leads/h sempre ativo | implementado (sem teste automatizado: depende de cabeçalhos HTTP) |
| A6 | Tabela de rate limit crescia indefinidamente | Revisão de código | Limpeza oportunista de janelas > 24 h | implementado |
| A7 | Logs sem redação de campos sensíveis | Revisão de código | `src/server/log.ts` com redação recursiva (password, token, secret, cookie, card…) | testado |
| A8 | Página de auditoria consultava o banco direto (fora da camada de serviço) | Revisão de código | `modules/audit/service.ts` com `requirePermission` | implementado |
| A9 | Após nova migração, o servidor **de desenvolvimento** continua com Prisma Client antigo em memória (`globalThis`) e falha com erro genérico | Reproduzido no navegador (`Cannot read properties of undefined (reading 'findUnique')`) | Documentado: reiniciar `npm run dev` após `prisma migrate dev`. Produção não é afetada (processo novo a cada deploy) | documentado |

### Verificado sem defeito
Sessões revogáveis e revalidadas a cada requisição; RBAC no servidor em todos os serviços; isolamento de leads, unidades e modelos por organização; validação Zod em toda entrada; erros internos não vazam para o cliente; `.env` fora do git; nenhuma credencial no código; seed recusa produção; migrações apenas aditivas.

### Migração
`20261027*_password_reset_tokens` (aditiva) com `down.sql` de reversão manual no mesmo diretório.

### Comandos e resultados reais (P02)
```
npx vitest run tests/integration/audit-findings.test.ts   → 2 failed (antes das correções)
npx vitest run                                             → Test Files 5 passed · Tests 52 passed
npm run lint                                               → 0 problemas
npm run typecheck                                          → 0 erros
npm run build                                              → Compiled successfully
```
Navegador (localhost): /recuperar-senha → mensagem neutra "envio de e-mails não configurado"; /redefinir-senha com token inválido → "Link inválido ou expirado".

### Simulado / bloqueado
- **Simulado:** envio de e-mail de redefinição — testado só com adaptador *fake* dentro do teste.
- **Bloqueado:** envio real de e-mail, convite de usuários e MFA (sem provedor de e-mail).


Legenda: ✅ implementado e testado · 🟡 parcial · ⏳ pendente · ⛔ bloqueado por dependência externa

## P07 — Portal do motorista, sessões e pagamentos (2026-10-27)

### Arquitetura
- **Motoristas** com autenticação SEPARADA da equipe (`Driver`, `DriverSession`, cookie `sm_driver`); o token de motorista não abre o backoffice (testado).
- **Fluxo de recarga** (`src/server/drivers/charging.ts`): pedido → pré-autorização → RemoteStart → StartTransaction (vincula motorista, pedido, pagamento e **congela a tarifa**) → medições → StopTransaction → **valor apurado** → captura até o valor reservado.
- **Pagamentos** (`src/server/payments/*`): contrato `PaymentProvider`; status local só muda pelo provedor (consulta ou webhook verificado); máquina de estados PENDING → AUTHORIZED → CAPTURED → PARTIALLY_REFUNDED/REFUNDED, + FAILED, CANCELLED, DISPUTED; eventos fora de ordem ignorados.
- **Webhook** `POST /api/payments/webhooks/{provedor}`: assinatura verificada (HMAC-SHA256 com comparação de tempo constante), evento único por (provedor, id), consulta à fonte de verdade antes de aplicar; falha de rede → 503 e retentativa (`retryPendingWebhookEvents`, também no ciclo do servidor OCPP).
- **Ambientes**: SIMULATED = demonstração sem cobrança; TEST = exige provedor (sandbox aceito); PRODUCTION = exige gateway real de produção → **bloqueado** (nenhum implementado).
- Nenhum dado de cartão é armazenado; o adaptador real deve usar checkout/tokenização do provedor.

### Implementado e testado
| Requisito | Teste |
|---|---|
| Cadastro/login (senha forte, consentimento LGPD, limite de tentativas), perfil, veículos, identificador de recarga (idTag ≤ 20) | integração + navegador |
| Busca de estações (rede pública × demonstração), status com horário de atualização, tarifa, instruções, link de rota | navegador |
| Início por app e por **QR Code** (validação de estação/conector/comunicação/tarifa no servidor); QR gerado por conector na tela da equipe | navegador |
| Status da sessão, energia, duração, custo **estimado** (em andamento) × **apurado** (encerrada) × **pago** (capturado) — rótulos distintos | integração + navegador |
| Tarifa congelada no início: mudança de tarifa durante a sessão não altera o valor | integração |
| Encerramento pelo app (somente a própria sessão), histórico, recibo imprimível, avaliação, suporte | integração + navegador |
| Webhook duplicado não reprocessa; assinatura inválida → 401 sem efeito | integração + curl |
| Confirmação tardia do gateway: recarga só inicia após autorização | integração |
| Falha de rede no webhook → 503, evento pendente, retentativa aplica | integração |
| Falha de rede na captura → pagamento segue autorizado; conciliação acusa "sessão sem pagamento" | integração |
| Pagamento aprovado sem sessão → conciliação acusa; expiração (3 min) cancela a reserva | integração |
| Valor acima da reserva → captura o reservado e acusa divergência de valor | integração |
| Início local sem pedido pago em estação de teste → idTag recusado | integração |
| Pagamento recusado → pedido falha, nenhum comando | integração |
| Reembolso parcial/total: permissão `payment:refund`, limite ao capturado, confirmado pelo provedor, auditado | integração |
| Conciliação marca pagamentos que conferem e lista divergências | integração |
| Isolamento entre motoristas (ver, encerrar, cancelar) | integração |

### Verificação manual (localhost, 375 px)
Cadastro de motorista → aba Demonstração → estação simulada "Disponível" com tarifa → **Iniciar recarga** → pedido → RemoteStart **ACCEPTED** → simulador interativo inicia transação → custo estimado ao vivo (2 kWh = R$ 4,80) → **Encerrar** → RemoteStop **ACCEPTED** → "Valor apurado R$ 16,80" (7 kWh × 2,40), marcado como demonstração → recibo, histórico, conta e página do QR sem rolagem horizontal. Tela de pagamentos da equipe mostra "Provedor: não configurado". Webhook sem assinatura → HTTP 401.

### Defeito/risco corrigido nesta etapa
- Listener pagamento → início de recarga poderia não estar registrado no processo do webhook ou duplicar com recarga de módulo em dev → registro por chave em `globalThis` e import explícito na rota.
- `ws` 8.18.0 com vulnerabilidade alta (DoS/memória) → atualizado para 8.21.3 (mesma versão principal); testes OCPP repetidos.

### Simulado / bloqueado
- **Simulado:** gateway **sandbox** (`PAYMENT_PROVIDER=sandbox`) — sem dinheiro real, só para estações TEST; o fluxo pago foi validado apenas em testes automatizados com o sandbox (não no navegador, pois o ambiente de dev está sem provedor).
- **Bloqueado:** pagamentos reais (Pix/cartão) — exige contratação de gateway, credenciais e homologação; recarga em estações de produção pelo app fica bloqueada até lá. Cartões RFID, nota fiscal, notificações por e-mail/push e mapa interativo: não configurados.
- **Limitação:** contestação (DISPUTED) é aceita na máquina de estados, mas não há fluxo de tratamento de chargeback.

### Comandos e resultados (P07)
`npx vitest run` → 11 arquivos, **127 testes passando** · lint 0 · typecheck 0 · build OK · `npm audit --omit=dev`: 6 altas + 1 moderada restantes (Next/Prisma/Zod, exigem upgrade major — já registrado).

## P06 — Estações, carregadores e OCPP (2026-10-27)

### Arquitetura
- **Servidor OCPP 1.6-J** em processo separado (`npm run ocpp:server`, `src/server/ocpp/ws-server.ts`): WebSocket `/ocpp/{identidade}`, subprotocolo `ocpp1.6`, HTTP Basic com senha por estação (só hash bcrypt no banco).
- **Protocolo** (`protocol.ts`): enquadramento CALL/CALLRESULT/CALLERROR e validação Zod de BootNotification, Heartbeat, StatusNotification, Authorize, StartTransaction, StopTransaction, MeterValues. Outras ações → `NotImplemented`.
- **Processador** (`handler.ts`): idempotência por UniqueId, ordenação por relógio do carregador, detecção de relógio adiantado, sessões e medições.
- **Comandos remotos** (`modules/stations/commands.ts`): fila durável no banco; o servidor OCPP entrega e registra resposta/timeout. Reset, RemoteStart, RemoteStop, UnlockConnector, ChangeAvailability.
- **Simulador** (`simulator.ts`, `npm run ocpp:simulate`): cliente OCPP real; o script recusa estações que não sejam `SIMULATED`.
- **Ambientes**: `PRODUCTION`, `TEST`, `SIMULATED` por estação; sessões herdam o ambiente; indicadores padrão só usam produção.

### Implementado e testado
| Requisito | Teste |
|---|---|
| Cadastro de unidades (endereço, coordenadas, horário, pública, parceiro), estações (identidade, fabricante, modelo, série, firmware via Boot), conectores (tipo, potência) e tarifas versionadas por vigência | navegador + integração |
| Status nunca assume disponibilidade: sem comunicação (> 2 × heartbeat + 60 s, relógio do servidor) → `UNKNOWN` | unit + integração |
| Mensagem duplicada (mesmo UniqueId) → mesma resposta, sem reprocessar | integração + WebSocket |
| Retentativa de StartTransaction com novo UniqueId → mesma transação | integração |
| Evento fora de ordem → histórico (`applied=false`), não sobrescreve | integração |
| Relógio do carregador adiantado → `clockSkewMs` + alerta | integração |
| Medições fora de ordem → última leitura pelo horário da medição; MeterValues deduplicado por horário | integração |
| StopTransaction repetido/ desconhecido → aceito, idempotente, anomalia registrada | integração |
| Perda de comunicação → estação `DISCONNECTED`, conectores `UNKNOWN`, sessão `COMMUNICATION_LOST`; reconexão reativa e StopTransaction acumulado encerra | integração |
| Produção sem cadastro de cartões → idTag `Invalid`, sessão encerrada sem fornecimento | integração |
| Comandos: permissão `station:command`, estação comunicando, estado válido (sessão ativa, conector livre), confirmação de reset; tentativas bloqueadas ficam registradas | integração |
| Produção: exige `station:command_production` (só superadmin) **e** `OCPP_ALLOW_PRODUCTION_COMMANDS=1` **e** confirmação | integração |
| Isolamento: outra operadora não lê/comanda; parceiro vê só estações das suas unidades, sem comandos, log OCPP nem hash de senha | integração |
| Indicadores: utilização, disponibilidade e tempo sem evidência por conector (fórmulas na tela); simulado/teste só com opção explícita e aviso | unit + integração |
| Ciclo real por WebSocket: senha errada → 401; boot, status, sessão, medição, duplicata, comando RemoteStop entregue e aceito, desconexão registrada | integração (servidor + simulador reais, porta efêmera) |

### Verificação manual (localhost)
Unidade e estação simulada cadastradas pela interface → `npm run ocpp:server` + `npm run ocpp:simulate` → boot, 5 status, sessão de **15 kWh** (`SIMULATED`), 3 medições → comando "Destravar conector" pela interface → **ACCEPTED** (`Unlocked`) → simulador desconecta → estação `DISCONNECTED`, conector `UNKNOWN`. Conector reportado antes do cadastro aparece como "cadastro incompleto". Painel de operação sem a opção mostra "Nenhuma estação de produção". 375 px sem overflow em estação, unidade e operação.

### Defeitos encontrados e corrigidos nesta etapa
- Script do simulador falhava (await no topo em CJS) — detectado ao rodar; corrigido com `main()`.
- Tipo do parâmetro `id` do simulador restringia a UUID — detectado pelo typecheck.

### O que NÃO foi validado / limitações
- **Nenhum hardware real** foi testado. Compatibilidade declarada apenas para o subconjunto implementado de OCPP 1.6-J; **sem teste de conformidade (OCTT)**. Cada fabricante/modelo precisa de homologação em bancada.
- **OCPP 2.0.1: não implementado** (cadastrável, sem adaptador). Firmware update, reservas, Smart Charging, Local Auth List, DataTransfer e Security Extensions: não implementados.
- Autorização de idTag: só simulado/teste (`SIM-`/`TEST-`); produção recusa até existir cadastro de motoristas/cartões (P07).
- Status do conector 0 (estação) fica no log, sem efeito nos conectores.
- Mapa: serviço não configurado; coordenadas em lista.
- Docker do serviço `ocpp` escrito mas não executado (daemon parado).

### Comandos e resultados (P06)
`npx vitest run` → 10 arquivos, **111 testes passando** · lint 0 · typecheck 0 · build OK.

## P05 — Motor financeiro e simulador econômico (2026-10-27)

Motor `viability-2.0.0` (`src/domain/viability/engine.ts`), regressão total com o 1.0 (os 22 testes originais passam sem alteração).

### Implementado e testado
| Requisito | Como | Testes |
|---|---|---|
| Utilização por horas equivalentes **ou** por ocupação × fator médio de potência (exatamente uma) | `occupancyRate`, `averagePowerFactor` | 2 |
| kWh por sessão → nº de sessões | `kwhPerSession` | 1 |
| **Sem dupla contagem sistema × gateway**: termo contratual `platformFeeIncludesGateway`; gateway à parte (% e R$/transação) só quando a taxa de sistema não o inclui; recusa no motor e ao salvar | versão do modelo + validação | 5 (unit + integração) |
| Receita bruta, tributos, **receita líquida**, custos variáveis/fixos, margem de contribuição, **EBITDA estimado** (= resultado operacional, sem depreciação) | `MonthRow`, KPIs | 2 |
| Fluxo mensal e **visão anual** | `years[]` | 1 |
| **Capital de giro** aportado no mês 0 na proporção do capital, devolvido no último mês (opcional) | `workingCapital` | 2 |
| **Partilha 50/50 explícita**: base = resultado operacional mensal; termo `lossTreatment` = rateio mensal do prejuízo **ou** compensação antes de novas distribuições; alerta quando o prejuízo acumulado supera o capital de giro | versão do modelo | 2 |
| Ponto de equilíbrio, payback, ROI, VPL (com taxa), TIR (bisseção; validada contra fluxos conhecidos) | — | 3 |
| **Limiares de viabilidade**: preço mínimo, custo máximo de energia, utilização mínima, custos fixos máximos; conferidos contra o próprio motor (resultado ≈ 0 no limiar) | `viabilityThresholds` | 2 |
| Sinalização de inviabilidade e **ranking de sensibilidade** por impacto | `viabilityFlags`, `sensitivityRanking` | 1 |
| Arredondamento ROUND_HALF_UP por linha; extremos (24 h, preço 0 recusado, sem investimento, opcionais ausentes sem NaN) | — | 5 |
| **Revisões de simulação**: autor, data, nº de revisão, versão do motor e do modelo, lista de premissas alteradas; origem de outra organização recusada | `Simulation.parentId/revision/changes`, `diff.ts` | 3 integração + 2 unit |
| **Relatório** da simulação (premissas, termos aplicados, histórico, resultados) com impressão/PDF do navegador | `/app/simulador/[id]` | navegador |
| Compatibilidade: simulações do motor 1.0 são lidas com padrões equivalentes à semântica antiga, sem alterar o registro | `normalizeStoredInput` | 1 |

### Exemplos de cálculo reproduzíveis (todos em `tests/unit/financial-engine.test.ts`)
Base: 1 × 60 kW, 4 h/dia, 30 dias, R$ 2,40/kWh, energia R$ 1,00/kWh, fixo R$ 150, compra integral (royalty 5%, sistema 14% c/ gateway, tributos 6%), investimento R$ 150.000.
1. Energia 7.200 kWh · bruto **17.280,00** · tributos 1.036,80 · receita líquida **16.243,20** · resultado operacional/EBITDA **5.610,00**.
2. Gateway à parte (sistema 10%, gateway 3% + R$ 0,50/sessão, 30 kWh/sessão): 240 sessões · sistema 1.728,00 · gateway **638,40** · margem de contribuição **R$ 0,8073/kWh**.
3. Capital de giro R$ 10.000 (36 meses): aporte 160.000 · ROI = (201.960 + 10.000 − 160.000) ÷ 160.000 = **32,475%** · payback **28,5 meses**.
4. 50/50 com mês 1 sem demanda: rateio → parceiro −75,00 e +2.545,80; compensação → 0,00 e +2.470,80 (mesmo total, momento diferente).
5. Limiares (mês 1): preço mínimo **R$ 1,3611/kWh** = (150/7.200 + 1,00) ÷ 0,75 · energia máxima **R$ 1,7792/kWh** · fixos máximos **R$ 5.760,00**.
6. TIR: [−100, 110] → 10%; [−100, 60, 60] → 13,066%.

### Defeitos encontrados e corrigidos nesta etapa
- Relatório de simulação antiga (motor 1.0) quebrava por falta de termos novos → normalização na leitura (detectado no navegador).
- Simulador abria por padrão uma versão **em rascunho** → versões vigentes primeiro (detectado no navegador).
- Dois erros meus em testes (conta do ROI; nome curto que fazia um teste passar pelo motivo errado) — corrigidos e documentados.

### Migração
`*_financial_terms_and_revisions` (aditiva) + `down.sql`.

### Comandos e resultados (P05)
`npx vitest run` → 8 arquivos, **90 testes passando** · lint 0 · typecheck 0 · build OK.
Navegador: simulação por ocupação + capital de giro salva → relatório; revisão alterando preço mostra só "Preço de venda 2,4 → 2,6"; simulação antiga abre com aviso; 375 px sem overflow (relatório, simulador público, modelos).

### Limitações
- Resultados são **gerenciais e projetados**; não há receitas reais na plataforma ainda (P07/P08). Tributos são percentual sobre a receita — não modelam IRPJ/CSLL nem regimes específicos; validar com contador.
- Sem depreciação/amortização: EBITDA ≈ resultado operacional por definição.
- Sazonalidade suportada no motor, sem campo na interface.
- Relatório exportável via impressão/PDF do navegador (não há geração de PDF no servidor).

## P04 — CRM e máquina de vendas (2026-10-27)

### Implementado e testado
| Funcionalidade | Onde | Testes |
|---|---|---|
| Empresas e contatos; vínculo de lead reaproveitando empresa por CNPJ/CPF ou nome normalizado; contato sem duplicar e-mail | `modules/crm/details.ts`, `/app/crm/empresas` | "reaproveita empresa…" |
| Qualificação: prioridade, valor estimado, previsão de fechamento, próximo passo | detalhe do lead | "valida qualificação…" |
| Tarefas/lembretes com responsável (só da organização), vencidas destacadas, "minhas" × equipe | `modules/crm/tasks.ts`, `/app/crm/tarefas` | 2 testes |
| Propostas numeradas (`PROP-AAAA-NNNN`, sem colisão concorrente), itens com total em Decimal, validade, condições, vínculo a versão de modelo; **versões imutáveis**; máquina de estados (rascunho → enviada → aceita/recusada; cancelada) com atualização condicional contra corrida | `modules/crm/proposals.ts`, `/app/crm/propostas*` | 5 testes |
| Versão para impressão / "Salvar como PDF" do navegador (sem gerador de PDF no servidor) | `/app/crm/propostas/[id]/imprimir` | verificado no navegador |
| Conversão de lead ganho em organização parceira/investidora, idempotente (inclusive concorrente) e reaproveitando organização com mesmo documento | `convertLeadToPartner` | "converte só lead ganho, uma única vez" |
| Funil configurável: nome e probabilidade por etapa, nova etapa antes de "Ganho"; Ganho=100%/Perdido=0% fixos; permissão `crm:configure` | `modules/crm/stages.ts`, `/app/crm/configurar` | "configuração do funil exige permissão…" |
| Lista paginada (25/página) e ordenável (nome, prioridade, valor, previsão, criação) | `listLeadsPage` | "valida qualificação e ordena/pagina" |
| Exportação CSV com permissão `lead:export` (admin), mesmos filtros da lista, proteção contra injeção de fórmulas, BOM UTF-8 e auditoria | `/api/crm/leads-csv` | "exportação exige permissão…" + navegador (200, text/csv) |
| Métricas com fórmulas explícitas: leads por origem, alcance e conversão por etapa, taxa de ganho, tempo médio até ganho, propostas em aberto, pipeline ponderado (selo "Projeção") | `modules/crm/metrics.ts`, `/app/crm/metricas` | "calcula conversão…" |
| Isolamento: outra organização não lê/altera propostas, não cria proposta em lead alheio, não recebe tarefa | — | "outra organização…", "não atribui tarefa…" |
| Auditoria: proposta criada/revisada/status, lead convertido/exportado, empresa vinculada, etapa criada/alterada | `AuditEvent` | parcial (exportação) |

### Exemplo reproduzível (teste "calcula conversão…")
Lead A: Novo → Qualificação → Perdido. Lead B (R$ 100.000): Novo → Proposta (50%).
Alcance: Novo 2, Qualificação 2 (B pulou etapas e conta como alcançado), Proposta 1. Taxa de ganho = 0 ÷ 1 = 0%. Pipeline ponderado = 100.000 × 0,50 = **R$ 50.000,00**.

### Migração
`*_crm_expansion` (aditiva: 4 tabelas, colunas novas anuláveis/com default, probabilidades iniciais) + `down.sql`.

### Defeitos encontrados e corrigidos nesta etapa
- Ordenação com `nulls: last` em coluna não anulável quebrava a lista (detectado por teste).
- Indicador "Propostas em aberto" estourava o card (detectado por captura).

### Comandos e resultados (P04)
`npx vitest run` → 6 arquivos, **65 testes passando** · `npm run lint` 0 · `npm run typecheck` 0 · `npm run build` OK.
Navegador (localhost): proposta criada → marcada como enviada → ações "aceite/recusa/cancelar" com confirmação; impressão renderizada; métricas; CSV; 375 px sem overflow em métricas, proposta, lead, lista e configuração.

### Simulado / bloqueado / pendente
- **Bloqueado:** envio de proposta por e-mail/WhatsApp e lembretes externos (adaptadores "não configurado"; a proposta mostra isso explicitamente).
- **Bloqueado:** assinatura eletrônica (P08, depende de provedor).
- **Pendente:** importação de leads (CSV) — não implementada nesta etapa; arrastar-e-soltar no kanban (mudança de etapa é por seletor).
- **Pendente:** perfil comercial não exporta CSV por padrão (decisão de privacidade; ajustável em perfis).

## P03 — Design system premium e experiência (2026-10-27)

### Implementado
- Tokens revisados por **contraste medido** (WCAG 2.1): `navy-400` #6a7f9e → #5c7190 (3,87–4,08 → 4,55–4,98:1); `tiffany-600` #0b8f8b → #0a7c78 (3,95 → 5,04:1); textos `navy-400/500` sobre fundo escuro → `navy-300` (2,96 → 8,23:1); destaque "50/50" da home → `tiffany-600` (axe: 2,59 → corrigido). Tokens semânticos `success/danger/warning/info`.
- Novos componentes: `Breadcrumbs`, `Skeleton`/`PageSkeleton`, `StateMessage` (vazio, erro, sem permissão, integração indisponível), `ConfirmDialog` (`<dialog>` nativo, substitui `window.confirm`).
- Fronteiras de rota: `app/loading.tsx`, `app/error.tsx`, `error.tsx` global, `not-found.tsx`, página `/app/sem-permissao` (antes: redirecionamento com alerta).
- Navegação com ícones `lucide-react` (único conjunto), "Pular para o conteúdo" no backoffice, breadcrumbs nas páginas internas, link "Minha conta".
- Painel: funil em barras com **unidade, período, fonte e horário**; barras clicáveis abrem a lista filtrada.
- Documentação: `docs/design-system.md`.

### Defeitos encontrados e corrigidos nesta etapa
| Defeito | Evidência | Correção |
|---|---|---|
| Server actions devolviam registros Prisma inteiros ao cliente (com `Decimal`) → erro de serialização e exposição desnecessária de dados | 8 erros no console ao criar rascunho de versão | Actions retornam apenas o necessário (nada ou `id`) |
| `<dialog>` sem fundo (reset do Tailwind) | Inspeção do estilo computado | `bg-white` explícito; verificado por captura |
| Troca em massa de cor atingiu texto em fundo branco no cabeçalho do backoffice (regressão introduzida e corrigida nesta etapa) | Captura de tela | Restaurado `navy-500` |

### Testado
- Navegador (localhost): diálogo de aprovação abre, Esc fecha, confirmar envia → servidor aplica a regra dos quatro olhos ("usuário diferente de quem criou").
- 375 px sem rolagem horizontal: `/app`, `/app/modelos`, `/app/conta`, `/app/sem-permissao`, `/recuperar-senha`, 404.
- axe-core 4.10.2 (WCAG 2 A/AA) na home: 1 violação de contraste → corrigida.
- `npm run lint` 0 · `npm run typecheck` 0 · `npm run build` OK · `npx vitest run` 52/52.

### Pendente / bloqueado
- **Pendente:** axe nas demais páginas — a injeção do script em lote no navegador foi bloqueada pela política de segurança do ambiente; planejado como teste automatizado (Playwright + @axe-core/playwright) no P10.
- **Pendente:** modo escuro para monitoramento (fará sentido com dados de telemetria, P06); portal do motorista ainda não existe (P07).
- **Observação:** rascunho "v2 — Compra integral" criado no banco de **desenvolvimento** durante o teste do diálogo (sem efeito em condições vigentes).

## 1. Diagnóstico inicial (Fase 1)
- Repositório **vazio** em 2026-10-27: nenhum código, banco, rota ou teste preexistente. Nada a preservar.
- Ambiente: Node 22.19, npm 10.9, PostgreSQL 14.19 local, Docker instalado com daemon parado, sem Redis.
- Fonte de negócio: `Portfolio_Comercial_Sansol_Mob.pptx` (14 slides). Inconsistências encontradas — **precisam de decisão comercial**:

| # | Slide | Achado | Tratamento |
|---|---|---|---|
| 1 | 8 e 10 | Faturamento de R$ 17.928 com 60 kW × 4 h × R$ 2,40 implica **31,125 dias/mês** (7.470 kWh). | Simulador usa 365/12 = 30,42 dias, editável e exibido. |
| 2 | 8 e 10 | Custo operacional = 65,16% do bruto + R$ 150 fixo em todas as colunas → energia implícita ≈ 40,2% do bruto (≈ R$ 0,96/kWh). O custo de energia não está declarado. | Valor 0,96 usado só como premissa inicial editável, com aviso para usar a tarifa real. |
| 3 | 10 | Tabela do modelo 50/50 repete os custos do modelo 100% (royalty 5% em vez de 8%) e mostra **"Retorno anual R$ 73.152"**, mas 50% × R$ 6.096 × 12 = **R$ 36.576**. | Motor calcula com 8% e divide resultado; não replica o erro. |
| 4 | 12 × 13 | Manutenção no 50/50: "Sansol Mob" (slide 12) × "quando houver" (slide 13). | Campo `maintenancePolicy` por versão; texto atual "cobrada quando houver, conforme contrato". |
| 5 | 13 | Royalty 50/50 "sobre o faturamento bruto **recebido**" — base exata não definida. | Base configurável por versão (bruto ou bruto após taxa de sistema). Seed usa bruto. |
| 6 | 3 e 7 | "Frota +200% na região Norte" e "redução de até 20% na energia" sem fonte. | **Não publicados** no site. Usina citada apenas como possibilidade sujeita a análise. |

## 2. Fundação (Fase 2)

| Requisito | Status | Evidência |
|---|---|---|
| Stack TypeScript/Next.js/Prisma/Postgres | ✅ | `docs/adr/0001-stack.md`; `npm run build` OK |
| Migrações versionadas | ✅ | `prisma/migrations/*_init` |
| Seed apenas de desenvolvimento, sem dados operacionais fictícios | ✅ | `prisma/seed.ts` (recusa `NODE_ENV=production`) |
| Organizações (operadora / investidor / parceiro) e vínculos | ✅ | `Organization`, `Membership` |
| Autenticação com sessões revogáveis (hash do token em banco, cookie httpOnly) | ✅ | `src/server/auth/session.ts`; testes "logout revoga", "perde acesso após revogação" |
| RBAC recurso:ação + 9 perfis de sistema + perfis por organização | ✅ | `src/server/auth/permissions.ts`, `Role` |
| Autorização no backend em todo serviço | ✅ | `requirePermission` em todos os serviços; testes de autorização |
| Isolamento entre organizações | ✅ | testes "outra organização não lê leads", "parceiro vê somente as próprias unidades" |
| Rate limit (login e formulários) | ✅ | `src/server/rate-limit.ts` (upsert atômico); teste "limita envios por IP" |
| Auditoria de ações críticas | ✅ | `AuditEvent`; tela `/app/auditoria` |
| Cabeçalhos de segurança, CSRF (Origin check das server actions) | ✅ | `next.config.ts` |
| Health check | ✅ | `GET /api/health` → `{"status":"ok","db":"ok"}` verificado |
| Design system (tokens, botões, campos, cards, badges, alertas, tabelas, estados vazios, KPI com fonte) | ✅ | `src/app/globals.css`, `src/components/ui/*` |
| Docker / compose / CI | 🟡 | Arquivos criados; **não executados** aqui (daemon Docker parado; CI depende de push ao GitHub) |
| Recuperação de senha por e-mail, convite de usuários, MFA | ⏳ | Depende de provedor de e-mail |
| RLS no Postgres | ⏳ | Isolamento hoje na camada de serviço (testado) |
| Logs estruturados completos, métricas, correlation IDs | 🟡 | Erros de action em JSON; restante pendente |

## 3. Núcleo comercial (Fase 3) — primeira fatia

| Requisito | Status | Evidência |
|---|---|---|
| Modelos comerciais A e B cadastrados a partir do portfólio | ✅ | `src/domain/commercial/reference.ts`; seed v1 com nota de origem |
| Versionamento, vigência, aprovação por 2º administrador, imutabilidade | ✅ | `approveVersion`; teste "nova taxa vale para novas simulações sem alterar as já registradas" |
| Base de cálculo de cada taxa configurável; sem base circular | ✅ | `FeeBase`; teste "rejeita base circular" |
| Simulador: energia limitada por potência/disponibilidade/limite de conexão, eficiência | ✅ | 22 testes unitários (`tests/unit/viability-engine.test.ts`) |
| Receita, taxas, tributos, royalty, energia, fixos, resultado operacional, parte de cada sócio | ✅ | idem |
| Fluxo mensal, payback, ROI, retorno 1º ano, VPL (com taxa), TIR, ponto de equilíbrio | ✅ | idem (inclui VPL na TIR ≈ 0) |
| Sensibilidade (utilização, preço, energia, fixos ±10/20%), cenários e comparação de modelos | ✅ | idem + UI |
| Projeções identificadas, com premissas, fórmulas, data e versão do motor | ✅ | `SimulatorResults` |
| Simulação salva recalculada no servidor com termos do banco (ignora termos do cliente) | ✅ | teste "ignora termos enviados pelo cliente"; E2E no navegador |
| Sazonalidade (12 multiplicadores) | 🟡 | Suportada no motor; sem campo na interface |
| Portal institucional (home, segmentos, jornada, modelos, simulador, FAQ, contato, privacidade, termos, SEO) | ✅ | `src/app/(public)/*`, `robots.ts`, `sitemap.ts` |
| Formulário de viabilidade → CRM (validação, honeypot, tempo mínimo, limite por IP, consentimento LGPD, dedupe concorrente) | ✅ | 5 testes de integração + E2E no navegador |
| CRM: kanban, lista, filtros, busca, detalhe, histórico, notas/ligações/reuniões, responsável, motivo de perda, leads parados | ✅ | `/app/crm*`; teste "exige motivo de perda" |
| CRM: tarefas/lembretes, propostas, anexos, exportação, etapas editáveis na UI, conversão em contrato | ⏳ | Próxima fatia |
| Agendamento de reunião | ⏳ | Depende de integração de calendário |
| Mapa de unidades públicas | ⏳ | Não há dados reais de unidades |
| Textos legais | 🟡 | Minutas marcadas para revisão jurídica/DPO |
| Portal do investidor/parceiro | 🟡 | Login e `/app/unidades` com escopo por organização; demonstrativos dependem da Fase 5 |
| Contratos, documentos, assinatura eletrônica | ⏳ ⛔ | Assinatura depende de provedor real |

## 4. Fases seguintes
| Fase | Status | Bloqueios externos |
|---|---|---|
| 4 — Unidades, carregadores, OCPP, telemetria, manutenção | ⏳ (só `Site` mínimo) | Modelos/fabricantes dos carregadores e versão OCPP suportada |
| 5 — Pagamentos, conciliação, royalties, repasses, fechamento | ⏳ | Escolha do gateway e credenciais de sandbox |
| 6 — Portal do motorista | ⏳ | Depende das Fases 4 e 5 |
| 7 — Analytics, notificações | ⏳ | Provedores de e-mail/SMS/WhatsApp |
| 8 — Homologação | ⏳ | — |

O painel executivo mostra hoje **apenas** indicadores comerciais reais; receita de recarga, kWh, sessões e pagamentos
aparecem como "indisponíveis" até existir integração.

## 5. Testes executados (resultado real)
Comando: `npx vitest run` — 2026-10-27 10:16 (horário local)
```
✓ tests/integration/authz.test.ts      (15 tests)
✓ tests/unit/viability-engine.test.ts  (22 tests)
✓ tests/integration/commercial.test.ts (3 tests)
Test Files 3 passed (3) · Tests 40 passed (40)
```
Também: `npm run lint` (0 problemas), `npm run typecheck` (0 erros), `npm run build` (OK, 20 rotas).

Verificação manual no navegador (dev, localhost):
- Formulário `/contato` → lead gravado com consentimento e evento `lead.created`.
- Login do superadmin → painel exibindo o lead real.
- `/app/crm/[id]`: mover para "Perdido" sem motivo é bloqueado; mover para "Qualificação" funciona.
- `/app/simulador`: salvar simulação → recalculada no servidor e listada.
- Largura 375 px: sem rolagem horizontal em `/`, `/simulador`, `/modelos`, `/app/crm` (overflow corrigido em tabelas do simulador).

Não executados: build Docker, pipeline de CI, testes E2E automatizados (Playwright), auditoria de acessibilidade automatizada.

## 6. Riscos conhecidos
- `npm audit --omit=dev`: 6 altas e 1 moderada que só se resolvem com upgrades major (Next 16, Prisma 7, Zod 4).
  Mitigação parcial: limites de tamanho nas entradas validadas. CI falha apenas em vulnerabilidade crítica até o upgrade.
- Fórmulas tributárias e contábeis são gerenciais; precisam de validação por contador habilitado antes de uso oficial.
- Aprovação de versões exige dois administradores: com um único admin cadastrado não é possível aprovar novas versões (intencional).

## 7. Próxima etapa concreta
1. CRM: tarefas e lembretes, propostas vinculadas a simulações, etapas configuráveis, exportação autorizada, notificações internas de leads parados.
2. Fase 4: cadastro completo de unidades/equipamentos/conectores com histórico de status e simulador OCPP 1.6J isolado (marcado como simulado).
3. Testes E2E com Playwright nos fluxos validados manualmente.
