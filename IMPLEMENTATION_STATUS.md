# IMPLEMENTATION_STATUS — Sansol Mob Platform

Atualizado em 2026-10-27 · Etapas concluídas: **P01**, **P02 (auditoria)**, **P03 (design system)**, **P04 (CRM)**, **P05 (motor financeiro)**, **P06 (estações e OCPP)**. Próxima: **P07 (motorista, sessões e pagamentos)**.

Classificação usada nos relatórios de etapa: **implementado** (código existe) · **testado** (teste automatizado e/ou verificação manual registrada) · **simulado** (funciona só com dublê/fake identificado) · **bloqueado** (depende de terceiro/credencial/decisão).

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
