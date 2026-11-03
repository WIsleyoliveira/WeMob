# Matriz de lacunas — WeMob (2026-11-03, atualizada na rodada de custos/Excel/observabilidade)

Base: código em `main` local (commits `5e25cdd`, `7c60aca` e as alterações desta rodada, ainda sem push), testes executados nesta rodada e documentos P15–P23. Documentação **não** foi aceita como prova: cada linha "validado" tem teste que roda.
**Status**: Não iniciado · Em andamento · Implementado, não validado · Validado automaticamente · Homologado externamente · Bloqueado · Concluído.
**Produção: NÃO AUTORIZADA** (critérios da Parte 22 abertos: Asaas parcial, split, hardware, staging, backups testados, alertas externos, contratos e autorização formal).

## Fase A — Estado real verificado
- Git: `main` 2 commits à frente de `origin/main` (sem push). Últimos testes: Vitest 321 (32 arquivos), Playwright 28, lint 0, typecheck 0, build OK, `npm audit --omit=dev` 0; `npm audit` 14 moderadas (`minimatch < 11.0.1` dentro do ESLint, só desenvolvimento).
- Diferença documentação × código encontrada nesta rodada: o fechamento já excluía pagamentos em disputa da receita, mas **não avisava** que existiam (corrigido); a regra de 14% estava no código, nos modelos semeados, no site público e no simulador (substituída).

## Fase B — Integridade financeira
| Item | Status | Evidência / pendência |
|---|---|---|
| Regra 30/70 centralizada, versionada e com vigência | **Validado automaticamente** | `settlement-1.3.0`, `ContractVersion.revenueShareRate`; `tests/unit/revenue-share.test.ts` (9), `tests/integration/revenue-share.test.ts` (7), `e2e/comercial-30-70.spec.ts` |
| Fim da cobrança de 14% | **Validado automaticamente** | modelos de 14% fora de vigência pelo seed (auditado), site público sem 14% (E2E); contratos antigos preservados (não retroativo) |
| Bruto × autorizado × recebido × estornado × elegível × partes × tarifas × tributos × custos | **Validado automaticamente** | linha do fechamento separa cada valor; autorizado/pendente/disputa fora da receita |
| Conservação de centavos | **Validado automaticamente** | teste de 715 valores + meio centavo |
| Tarifas do Asaas: quem suporta | **Bloqueado** (WAPE, decisão 1) | fechamento com tarifa "a definir" não pode ser aprovado |
| Base elegível, tributos, custos, chargeback mantido | **Bloqueado** (WAPE, decisões 2–5) | `docs/DECISOES_30_70_WAPE.md` |
| Ajustes e reversões (estorno após fechamento) | **Validado automaticamente** (P08) | lançamentos de ajuste em período aberto; participação acompanha o sinal |
| Valores bloqueados/em disputa | **Validado automaticamente** | aviso no fechamento com quantidade e total |
| Conciliação por transação e horária | **Validado automaticamente** (P16–P18) | `reconcile()`; ciclo horário |
| Conciliação diária consolidada (relatório do dia) | **Não iniciado** | hoje: por transação + horária + mensal |
| Fechamento mensal, quatro olhos, hash, bloqueio de período | **Validado automaticamente** (P08) | `closing.ts` |
| Exportação CSV | **Validado automaticamente** | demonstrativo com colunas da participação |
| Exportação Excel (.xlsx) | **Validado automaticamente** | `src/lib/xlsx.ts` (sem dependência): demonstrativo, lançamentos, extrato do parceiro e orçamento de custos; dinheiro como número; lido pelo `openpyxl`; `tests/unit/xlsx.test.ts`, E2E |
| Aprovação de repasses / pagamento ao posto | **Implementado, não validado** externamente | provisão → pago registrado manualmente; **sem integração de pagamento** (nunca transfere dinheiro) |
| Simulador com 30/70 e cenários | **Validado automaticamente** | modelo "Participação 30/70"; cenários de referência testados como ilustrativos |

## Fase C — Segurança, infraestrutura e observabilidade
| Item | Status | Evidência / pendência |
|---|---|---|
| Health detecta migração pendente/falha em banco populado | **Validado automaticamente** (nesta rodada) | `src/domain/ops/schema.ts`, `tests/unit/schema-status.test.ts`, `resilience.test.ts` |
| Health para monitor externo (`/api/health?exigir=automacao` → 503 com o ciclo parado) | **Validado automaticamente** (nesta rodada) | `resilience.test.ts` |
| Monitor externo de disponibilidade (fora da aplicação) | **Bloqueado** (infraestrutura) | precisa de serviço externo (ex.: verificação HTTP a cada minuto) apontado para a URL acima |
| Logs estruturados sem segredos | **Validado automaticamente** (P10/P17) | `log.ts` |
| IDs de correlação por requisição | **Validado automaticamente** | `src/middleware.ts` (`x-request-id`), `src/server/correlation.ts`; logs com `requestId` em ações, webhooks, mensagens OCPP e automações |
| Métricas operacionais (Prometheus) | **Validado automaticamente** | `/api/metrics` com `METRICS_TOKEN`; agregador/dashboard externo: **Bloqueado** (escolha do serviço) |
| Alertas de webhook, OCPP offline, cobrança, estorno, automação | **Validado automaticamente** (motor de alertas P09/P16) | alertas internos na tela; **sem canal de envio** (e-mail/SMS) |
| Backup verificável (dump + restauração comparada) | **Validado** em desenvolvimento | `npm run db:backup:verificar`: 69 tabelas, 15 migrações idênticas (2026-11-03) |
| Staging, TLS, cofre, backups agendados | **Bloqueado** (infraestrutura WAPE) | `docs/staging.md` §4–5 com agendamento e alertas sugeridos |
| Migrações explícitas no deploy | **Validado automaticamente** (P19, CI `docker`) | |
| Dependências | **Em andamento** | produção 0; desenvolvimento 12 moderadas (era 14): `minimatch` 11 em `@eslint/config-array` e `typescript-estree`; restam 5 cópias 3.1.5 em `eslint`, `@eslint/eslintrc` e plugins `import`/`jsx-a11y`/`react`, que exigem a API antiga (risco aceito: só lêem padrões do nosso `eslint.config.mjs`) |
| Revisão de segurança independente / pentest | **Bloqueado** (terceiro) | |

## Fase D — OCPP e confiabilidade
| Item | Status | Evidência |
|---|---|---|
| Boot, Heartbeat, Status, Authorize, Start/Stop, MeterValues | **Validado automaticamente** | `ocpp.test.ts`, Playwright C |
| RemoteStart/Stop, Reset, Unlock, ChangeAvailability | **Validado automaticamente** (simulador) | parada não usa a de outra transação (P23) |
| Perda de conexão explícita, última leitura preservada, telemetria ≠ encerramento | **Validado automaticamente** | P23 + "Comunicação atrasada" |
| Homologação com carregador físico | **Bloqueado** (hardware) | roteiro em `docs/P23_CHECKLIST_HOMOLOGACAO.md` (coluna Físico) |
| Reserva, Smart Charging, firmware, OCPP 2.0.1 | **Não iniciado** (não suportados) | não declarados como suportados |

## Fase E — Motorista
| Item | Status |
|---|---|
| Descoberta, filtros, distância, compatibilidade, favoritos, repetir última | **Validado automaticamente** |
| Mapa, busca por endereço, fotos do local | **Bloqueado** (provedor de mapas / conteúdo) |
| Pagamento Pix/cartão, recarga em tempo real, limites, parada, recibo | **Validado automaticamente**; Pix e cartão **homologados externamente** no sandbox (P14–P15) |
| Estorno **parcial** de cartão | **Bloqueado** (Asaas recusou em 28 e 29/10; resposta oficial pendente) |
| Aparelhos conectados, exportação e exclusão de dados | **Validado automaticamente** |
| Recuperação de senha do motorista, notificações, preferências | **Bloqueado** (provedor de e-mail/SMS/push) |
| PWA: manifest e ícones instaláveis | **Validado automaticamente** (nesta rodada) |
| PWA: modo offline / service worker | **Não iniciado — de propósito**: telas financeiras nunca podem vir de cache; sem rede, o navegador mostra o erro dele |

## Fases F–I
| Item | Status | Dependência |
|---|---|---|
| Totem de autoatendimento | **Não iniciado** | hardware, leitor de cartão, compra sem cadastro (CPF exigido pelo Asaas), política de comprovante |
| Painel do operador do posto (portal do parceiro) | **Validado automaticamente** (P09) para extratos e isolamento; receita diária/ocupação por posto: **Não iniciado** | |
| Painel administrativo (rede, financeiro, CRM, suporte, manutenção, alertas, auditoria) | **Validado automaticamente** | custos de infraestrutura e relatórios executivos: **Não iniciado** |
| Tema escuro completo (com preferência salva) | **Validado automaticamente** | paleta escura por escalas, `theme-fixed`, `ThemeScript` sem piscar; `e2e/redesign.spec.ts` (persistência, sistema, cores calculadas); capturas claro/escuro em `npm run e2e:browser` com `E2E_TELAS=1` |
| Redesign — administração (navegação agrupada, gaveta no celular, alertas no cabeçalho, painel com economia da WeMob e utilização por conector) | **Validado automaticamente** | `src/app/app/layout.tsx`, `nav.ts`, `page.tsx`; E2E e capturas |
| Redesign — operador do posto (portal com período, indicadores, energia, sua parte por competência, utilização/disponibilidade por conector, seções) | **Validado automaticamente** | `src/app/app/portal/page.tsx`; E2E e capturas (estação do E2E é de teste: estados vazios honestos) |
| Redesign — motorista | **Validado automaticamente** (P23 + tema) | telas do P23 com tema escuro e seletor no cabeçalho; capturas |
| Redesign — telas internas restantes (CRM, contratos, suporte, manutenção, usuários) | **Em andamento** | herdam navegação, tema e componentes; layout interno de cada tela não foi refeito nesta rodada |
| Teste de usabilidade com pessoas reais | **Não iniciado** | precisa de participantes (WAPE) |
| Marca definitiva (WeMob/WAPE × "Sansol Mob" na interface) | **Bloqueado** (decisão WAPE) | |
| Pontos, planos, carteira pré-paga | **Bloqueado** | regras comerciais aprovadas; carteira exige parecer regulatório (Banco Central) e contábil |
| Custos operacionais da plataforma e risco cambial | **Validado automaticamente** | `/app/financeiro/custos`: premissas da planilha (SHA-256 `00da01b7…`), câmbio de stress, reserva, custo por posto, cenários, sensibilidade cambial, realizado (R$/US$) × orçado com alerta, Excel; separado do fechamento (teste) |
| Orçamento versionado por competência | **Validado automaticamente** | congelar o mês (nova versão substitui a anterior, uma ativa por mês — índice parcial), realizado × versão do mês, Δ do mês anterior, histórico de alterações; `tests/integration/platform-costs.test.ts` (inclui concorrência) |
| Importação segura de nova versão da planilha | **Validado automaticamente** | `src/lib/xlsx-read.ts` (limites de tamanho/partes/descompactação, sem fórmulas, sem caminhos fora de `xl/worksheets`), `src/domain/costs/import.ts` (validação estrita), prévia com diferença → aplicar (motivo, auditado, uma vez) ou descartar; lida a planilha real recebida |

## Bloqueadores externos (resumo)
| Bloqueador | Quem resolve | Evidência de resolução | Pode avançar antes | Não ativar até |
|---|---|---|---|---|
| Estorno parcial de cartão | dono da conta Asaas | resposta oficial + teste no sandbox | código de agendamento/retentativa já pronto | homologado |
| Tarifas do Asaas (quem paga) e base elegível | WAPE | aditivo aprovado | apuração e prévia | aprovação de fechamentos 30/70 com tarifa |
| Split real | Asaas + WAPE | split `DONE` com segunda carteira sandbox | apuração | qualquer split real |
| Notificações | produto + jurídico | provedor contratado + consentimento | outbox pronto | envio a motoristas |
| Mapas | produto + jurídico | provedor escolhido + CSP | lista com distância | mapa |
| Totem e carregador físico | operações WAPE | equipamento homologado | roteiros | operação comercial |
| Staging e backups | infraestrutura | ambiente no ar + restauração ensaiada | runbook | produção |
| Fiscal, jurídico e contábil | WAPE | pareceres | — | carteira, planos, emissão fiscal |
| Pontos e planos | comercial | regras versionadas aprovadas | modelos de dados (não iniciados) | divulgação |
