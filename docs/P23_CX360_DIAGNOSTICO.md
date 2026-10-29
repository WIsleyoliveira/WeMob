# P23 — WeMob Customer Experience 360 · Fase A (auditoria e desenho)

**Data**: 2026-10-28/29 · **Base auditada**: `main` publicado em `666a115` (CI remoto verde, execução 40753259295) + commit local `11fa3cd` (só documentação). Nenhum código alterado nesta fase.
**Método**: leitura das 11 telas do motorista, rotas públicas, 7 rotas de API, serviços `src/server/drivers/*`, `payments/*`, schema Prisma (todos os modelos), design system e relatórios P13–P21. Nada aqui é conclusão de teste novo: as evidências citadas são as do P19–P21.

## 1. O que existe hoje (inventário)

### Telas do motorista (`/motorista`, PWA não instalável — sem manifest)
| Tela | O que faz de verdade |
|---|---|
| `/motorista` | lista de estações públicas (abas Rede / Demonstração), tarifa R$/kWh, conectores com status, "sem comunicação recente: disponibilidade desconhecida"; cartão de sessão ativa no topo |
| `/motorista/estacoes/[identity]` | endereço, horário, link externo "abrir rota" (Google Maps por coordenada), tarifa vigente (kWh + min), texto do pré-pago, conectores com status e horário do status, início bloqueado sem comunicação/tarifa |
| `/motorista/carregar/[identity]/[connector]` | destino do QR do carregador: valida estação/conector e oferece o início |
| `start-form` | escolha Pix/cartão; valor **fixo** cobrado antes (`PAYMENT_PREAUTH_AMOUNT`) |
| `/motorista/pedido/[id]` | progresso Pagamento → Carregador → Recarga; Pix (QR/copia e cola), cartão (página do Asaas), conferência automática no gateway, cancelar, expirado/cancelado sem cobrança |
| `/motorista/recarga/[id]` | kWh, minutos, custo estimado × apurado, tarifa congelada, barra do limite e aviso de parada por limite, "carregador sem comunicação", botão encerrar, avaliação 1–5 |
| `/motorista/recibo/[id]` | comprovante (estação, transação, medidor, tarifa, valor, pagamento/estorno); "não é documento fiscal"; imprimir |
| `/motorista/historico` | lista de sessões (sem filtros) |
| `/motorista/ajuda` | FAQ (Pix/cartão, estorno, não iniciou, "paguei e não mudou") + chamado |
| `/motorista/conta` | perfil, veículos (rótulo, tipos de conector, bateria), CPF/CNPJ cifrado, identificador de recarga, exportar dados e excluir conta (LGPD) |
| `/motorista/entrar`, `cadastro` | login/cadastro com consentimento e limite de tentativas |

Navegação inferior atual: **Estações · Recargas · Ajuda · Conta**.

### Serviços e regras reaproveitáveis
`startCharge` (pedido idempotente, 1 pedido aberto por motorista e por conector — índices parciais), `driverAwareAuthorizer`, `onSessionStarted/Stopped` (tarifa congelada, captura, estorno da diferença), `checkSessionLimit`/`enforceSessionLimits` (limite financeiro, margem, até 5 tentativas de parada), `expireStaleChargeRequests`, `stopCharge` (1 `REMOTE_STOP` pendente por estação), `syncPendingPayment`, máquina `PAYMENT_TRANSITIONS`, webhooks verificados com espera, `retryDueRefunds` com lease, `reconcile()`, `effectiveStatus` (sem comunicação → `UNKNOWN`), `hit()` (limites de requisição), `audit()`, outbox de notificações (só equipe), `exportMyData`/`deleteMyAccount`.

### Modelos relevantes
`Driver`, `DriverSession`, `Vehicle` (`connectorTypes[]`, `batteryKwh`), `DriverIdTag`, `ChargeRequest` (`AWAITING_PAYMENT → START_REQUESTED → STARTED | FAILED | CANCELLED | EXPIRED`), `ChargingSession` (`fundedAmount`, `limitAmount`, `limitStopRequestedAt`), `RemoteCommand` (`PENDING/SENT/ACCEPTED/REJECTED/TIMEOUT/…`), `Tariff` (`pricePerKwh`, `pricePerMin`, `validFrom`), `Site` (lat/long, horário, `isPublic`), `Connector` (`type`, `maxPowerKw`, status), `Payment/Refund/PaymentEvent/PaymentOperation`, `SessionRating`, `SupportRequest` (com `sessionId`), `Notification/NotificationRecipient` (destinatário = usuário da **equipe**).
**Inexistentes**: favoritos, carteira/razão de créditos, pontos, regras de fidelidade, recompensas, resgates, planos/assinaturas, campanhas, preferências de notificação do motorista, recuperação de senha do motorista, totem/quiosque.

## 2. Matriz de funcionalidades

Legenda: **V** já implementada e validada · **P** parcial · **S** só em simulação · **E** necessita integração externa · **C** necessita decisão comercial/jurídica · **D** precisa ser desenvolvida.

### Recarga central (Partes 4 e 16)
| Funcionalidade | Estado | Evidência / lacuna |
|---|---|---|
| Lista de estações com tarifa e status honesto ("desconhecida" sem comunicação) | **V** | telas + `effectiveStatus`; Playwright C (sem comunicação) |
| Detalhe da estação, conectores, horário do status | **V** | — |
| QR do carregador → conector certo | **V** | `/motorista/carregar/...` |
| Pagamento pré-pago Pix/cartão (página segura), sem dados de cartão no WeMob | **V** (sandbox) | P14–P18 + Playwright B; produção bloqueada por `productionReadiness` |
| Idempotência de cobrança, webhook, clique duplo | **V** | testes P16–P18, Playwright B |
| Início só com confirmação do carregador; falha ao iniciar sem nova cobrança | **V** | `START_TIMEOUT_MS`, estorno/análise; testes de ciclo |
| Limite financeiro, aviso e parada no limite | **V** (simulador) | Playwright C; hardware **E** |
| Recibo digital (não fiscal) | **V** | tela + Playwright |
| Histórico de sessões | **P** | sem filtros por período/estação/estado; sem referência ao pedido/pagamento na lista |
| **Escolha da recarga por valor** | **D** | hoje o valor cobrado antes é fixo por ambiente; o limite da sessão já usa `fundedAmount`, então o backend suporta valores diferentes com mudança pequena e testável |
| **Por energia (kWh)** | **D** | conversão kWh → valor pela tarifa congelada é cálculo puro; a parada é pelo limite de valor (já existe) |
| **Por duração** | **D** (só estimativa) | não há parada por tempo no backend nem potência efetiva confiável; oferecer só como **estimativa** do tempo para o valor escolhido, nunca como modalidade |
| Taxa de início / ociosidade / estacionamento | **C** | `Tariff` só tem kWh e minuto; nada a exibir até existir política |
| Estados detalhados: "ordem aceita" × "iniciada" | **P** | `RemoteCommand.ACCEPTED` existe, a tela mostra só "Aguardando o carregador" |
| **"Solicitação de encerramento enviada"** persistente | **P** | `stopCharge` cria o `REMOTE_STOP`, mas a tela de recarga não mostra o pedido após recarregar a página (volta a "Recarga em andamento" + botão); só a parada por limite é persistida |
| Última leitura confiável + horário durante perda de comunicação | **P** | mostra "valores parciais", sem horário da última medição |
| Saldo não consumido e prazo de estorno no final | **V** | recibo/recarga + FAQ |
| Avaliação opcional, sem bloquear recibo | **V** | — |

### Descoberta e conveniência (Partes 3 e 5–7)
| Funcionalidade | Estado | Evidência / lacuna |
|---|---|---|
| Mapa dentro do app | **E** | não há provedor de mapas; exige escolha (OSM/Leaflet × Google/Mapbox), custo, CSP (`connect-src 'self'` bloqueia tiles) e termos |
| Distância / "mais próxima" | **D** | coordenadas existem; geolocalização do navegador com consentimento e cálculo no cliente, sem armazenar posição |
| Busca por endereço/CEP | **E** | exige geocodificação externa; sem ela, só filtro por cidade/nome |
| "Como chegar" | **V** (externo) | link para Google Maps por coordenada |
| Filtros (conector, potência, disponibilidade, preço) | **D** | dados existem |
| Filtros por rede/operador, plano aceito | **C** | uma rede só; planos inexistentes |
| Compatibilidade com o veículo | **P** | `Vehicle.connectorTypes` existe mas não é usado nas telas; potência AC/DC do veículo não é guardada |
| Favoritos, repetir última escolha | **D** | — |
| Planejamento de viagem/rota | **E** | depende de mapas/rotas; fora da Fase B |
| Reserva | não fazer | sem suporte operacional nem OCPP `ReserveNow` implementado |
| Pagamento tokenizado salvo | **E** | tokenização do Asaas não integrada; hoje cartão sempre na página do Asaas |
| PWA instalável | **D** | sem `manifest`/ícones; service worker exige cuidado (dados financeiros não podem vir de cache) |

### Carteira, pontos, recompensas, planos (Partes 5–7, 13)
| Funcionalidade | Estado | Evidência / lacuna |
|---|---|---|
| Carteira de créditos pré-pagos em dinheiro | **C** | saldo em reais guardado para uso futuro pode caracterizar arranjo de pagamento/moeda eletrônica (regulação do Banco Central) e tem tratamento contábil/fiscal próprio — exige parecer jurídico e contábil antes de qualquer código |
| Crédito promocional (não resgatável) | **C** + **D** | tecnicamente simples sobre um razão auditável; precisa de política (validade, custo máximo) |
| Pontos de fidelidade (razão, regras versionadas, idempotência por sessão) | **C** + **D** | sem regra comercial definida; motor e razão podem ser construídos com regra em rascunho, nunca publicada sem aprovação |
| Catálogo e resgate de recompensas | **C** + **D** | valores, limites e estações participantes indefinidos; parceiros: nenhum contrato |
| Recarga gratuita limitada | **C** + **D** | precisa de kWh/valor/potência/validade definidos; integra-se ao limite financeiro existente (gratuidade = cobertura até X, depois cobrança só se informada antes) |
| Níveis (Prata/Ouro…) | **C** | só preparar o modelo |
| Planos mensais / assinaturas | **C** + **E** + **D** | definição de "100% de recargas no mês" pendente; cobrança recorrente do Asaas (`/subscriptions`) **não integrada nem testada no sandbox** |
| Painel administrativo de pontos/planos com versões e quatro olhos | **D** | padrão já existe (`CommercialModelVersion`, `ContractVersion`, `GatewayActivation`) — reaproveitar |

### Suporte, notificações, conta (Partes 9–11)
| Funcionalidade | Estado | Evidência / lacuna |
|---|---|---|
| FAQ e chamado com sessão associada | **V** | `SupportRequest.sessionId`; limite por hora |
| Fluxos críticos guiados (cobrança sem recarga, duplicada, pontos não creditados…) | **P** | só texto da FAQ + chamado genérico; categoria e preenchimento automático não existem |
| Ajuda contextual nas telas de pagamento/recarga | **P** | textos inline em algumas telas; sem link "precisa de ajuda com esta recarga" |
| Notificações ao motorista (início, fim, estorno…) | **E** | outbox só para equipe e **nenhum canal configurado** (e-mail/SMS/push); exige provedor e consentimento |
| Preferências de comunicação (operacional × marketing) | **D** (depende de **E**) | — |
| Login, logout, limite de tentativas | **V** | `auth.ts` |
| **Recuperação de senha do motorista** | **D** | só existe para a equipe; também depende de e-mail (**E**) para enviar o link |
| Revogação de dispositivos/sessões | **P** | logout encerra a sessão atual; sem lista de dispositivos |
| Exportar dados / excluir conta | **V** (com limitações) | `exportMyData`, `deleteMyAccount`; textos ainda sem revisão jurídica (**C**) |

### Totem (Parte 2, Fase F)
| Funcionalidade | Estado | Evidência / lacuna |
|---|---|---|
| Interface de quiosque (tela grande, toque, limpeza por inatividade) | **D** | nada existe |
| Compra como visitante | **C** + **E** | hoje toda recarga exige conta de motorista; o Asaas exige CPF/CNPJ do pagador — visitante precisa de decisão (CPF no totem? Pix sem cadastro?) e de avaliação de privacidade em tela pública |
| Hardware/navegador do totem | **E** | modelo não definido; nada pode ser declarado compatível |

### Identidade visual
| Item | Estado | Observação |
|---|---|---|
| Verde (energia/ação), azul muito escuro (base) | **V** | tokens `brand-*` e `navy-*` |
| Tiffany como destaque | **V** | tokens `tiffany-*` existem (foco dos campos); uso como destaque pontual a definir no redesenho |
| Nome da marca na interface | **C** | a UI diz **"Sansol Mob"** (layout, metadados, recibo); o P23 fala em **WeMob/WAPE**. Decidir o nome exibido ao cliente antes de redesenhar telas |

## 3. Jornada do cliente: hoje × alvo
| Passo do P23 | Hoje | Falta |
|---|---|---|
| 1. Encontrar o carregador | lista + QR | distância, filtros, favoritos; mapa (**E**) |
| 2. Conferir compatibilidade | não | usar o veículo cadastrado |
| 3. Conhecer o preço | tarifa kWh/min | estimativa para o valor/kWh escolhido; taxas só se existirem (**C**) |
| 4. Escolher como pagar | Pix/cartão, valor fixo | escolha por valor / kWh com resumo antes de pagar |
| 5. Receber confirmação | sim (gateway) | — |
| 6. Conectar | instrução genérica | instruções por equipamento (dados inexistentes) |
| 7. Acompanhar | sim | "ordem aceita", horário da última medição |
| 8. Encerrar | botão | estado "encerramento solicitado" persistente |
| 9. Resultado | recibo | link do recibo/QR para o celular (totem) |
| 10. Pontos e histórico | histórico sem filtros; pontos inexistentes | filtros; pontos (**C**) |

## 4. Decisões e dependências externas (bloqueiam fases C, D, F)
| # | Decisão / dependência | Quem decide | Bloqueia |
|---|---|---|---|
| 1 | Nome exibido ao cliente (Sansol Mob × WeMob × WAPE) e uso do Tiffany | marketing WAPE | redesenho visual |
| 2 | Faixa de valores que o cliente pode escolher (mínimo/máximo por recarga) e se o máximo atual (`PAYMENT_PREAUTH_AMOUNT`) continua como padrão | comercial + financeiro | Fase B (escolha por valor) |
| 3 | Provedor de mapas e geocodificação (custo, termos, privacidade) | produto + jurídico | mapa, busca por endereço, rotas |
| 4 | Carteira pré-paga em dinheiro: parecer regulatório (Banco Central), contábil e fiscal | jurídico + contabilidade | Fase C (dinheiro) |
| 5 | Regras de pontos, catálogo, custo máximo, validade, níveis | comercial + financeiro | Fase C (pontos) |
| 6 | Definição de "100% de recargas no mês", preços, limites, cancelamento, reajuste | comercial + jurídico | Fase D |
| 7 | Cobrança recorrente no Asaas sandbox (assinaturas) | engenharia + conta Asaas | Fase D |
| 8 | Canal de notificação (provedor de e-mail/SMS/push) e textos de consentimento | produto + jurídico | notificações, recuperação de senha |
| 9 | Totem: hardware, navegador, local, compra como visitante e CPF | operações + jurídico | Fase F |
| 10 | Taxas de início/ociosidade/estacionamento (se existirem) | comercial | exibição de tarifas extras |
| 11 | Revisão jurídica de termos, privacidade e retenção | jurídico | publicação |

## 5. Riscos
| Risco | Impacto | Mitigação no desenho |
|---|---|---|
| Escolha de valor pelo cliente alterar o fluxo financeiro validado | cobrança errada ou limite incoerente | valor vira **entrada validada no servidor** (faixa configurável, Decimal), gravada no `ChargeRequest`; o limite continua derivado de `fundedAmount`; testes de integração + Playwright para manipulação do valor pelo cliente |
| "Duração" interpretada como tempo garantido | reclamação/cobrança inesperada | só estimativa, com potência nominal e ressalva; nunca modalidade de cobrança |
| Mapa ou disponibilidade "bonitos" sem dado confiável | promessa falsa | manter "disponibilidade desconhecida" e horário da última atualização; sem mapa até o provedor ser decidido |
| Carteira em dinheiro sem enquadramento regulatório | risco legal | não implementar antes do parecer (decisão 4) |
| Pontos/resgates duplicados por reentrega de eventos | prejuízo e auditoria | razão append-only com chave única por (motorista, origem, referência), como `PaymentOperation` |
| Assinatura cobrando sessão já coberta | cobrança dupla | decisão de cobertura calculada **antes** do pedido e gravada nele; nenhuma cobrança avulsa para sessão totalmente coberta (teste obrigatório) |
| Totem expondo dados pessoais | privacidade | sessão visual de convidado, limpeza por inatividade, nada de nome/CPF na tela |
| Service worker servindo saldo/estado em cache | informação financeira falsa | PWA só com manifest e cache de estáticos; rotas de sessão/pagamento sempre na rede |
| Crescimento de escopo misturando produto e infraestrutura | regressão no CI verde | uma fase por vez, commits separados, suíte completa + Playwright a cada fase |

## 6. Plano priorizado

### Fase B — experiência central de recarga (sem dependência comercial, exceto a decisão 2)
Incrementos, cada um com testes e commit próprio:
1. **B1 · Estados honestos na recarga** (sem migração): mostrar "ordem aceita pelo carregador" (`RemoteCommand.ACCEPTED`) no pedido; na recarga, **"Solicitação de encerramento enviada"** enquanto houver `REMOTE_STOP` pendente/aceito da sessão; horário da última medição durante perda de comunicação. Playwright: encerrar → recarregar a página → estado preservado.
2. **B2 · Descoberta** (sem migração): filtros (conector, potência mínima, só com comunicação, preço máximo) e ordenação por distância com geolocalização opcional (permissão no momento do uso, cálculo no cliente, nada gravado); destaque de compatibilidade com o veículo cadastrado ("compatível pelo conector"; nunca por marca).
3. **B3 · Escolha da recarga por valor e por kWh** (migração aditiva: valor escolhido no `ChargeRequest`): faixa configurável validada no servidor; resumo antes de pagar (preço/kWh, kWh estimados, valor cobrado agora, devolução da diferença e prazo, estimativa de tempo pela potência nominal com ressalva). **Depende da decisão 2**; até lá, mantém o valor único atual.
4. **B4 · Histórico e recibo**: filtros por período/estação/estado, referência do pedido/pagamento, QR/link do recibo; ajuda contextual "problema com esta recarga" pré-preenchendo o chamado com a sessão.
5. **B5 · Conta**: recuperação de senha do motorista (token com hash e expiração, como o da equipe) — **o envio depende do canal de e-mail (decisão 8)**; sem canal, fica pronto e desligado. Manifest PWA (sem cache de dados).

Critérios de aceite da Fase B: Playwright de ponta a ponta (encontrar estação → filtrar → selecionar conector → escolher valor → pagar no gateway simulado → acompanhar → encerrar com estado intermediário → recibo), testes de manipulação de valor, rede lenta/recarga da página durante a sessão, 375 px e teclado; CI remoto verde.

### Fases seguintes (após as decisões)
- **C — Fidelidade**: razão de pontos append-only, regras versionadas (rascunho → aprovação por outra pessoa → vigência, sem retroatividade), catálogo/resgate idempotente, painel na área da equipe. Carteira em dinheiro **só** após a decisão 4.
- **D — Planos**: modelos de plano configuráveis (cota de kWh, sessões, teto, desconto) com estados rascunho/aprovado/publicado/suspenso/encerrado; cobertura calculada antes do pedido; recorrência no Asaas sandbox; cancelamento self-service. Nenhuma oferta publicada sem aprovação.
- **E — Relacionamento**: favoritos, notificações (após canal), resumo de consumo, fluxos críticos de suporte com categoria.
- **F — Totem**: rota de quiosque própria, sessão de convidado, limpeza por inatividade, QR para o celular; só após hardware e decisão sobre visitante.
- **G — Homologação integrada** em staging, separando evidências automatizadas, sandbox, hardware e aprovações.

## 7. Proposta para começar
Iniciar por **B1 + B2** (nenhuma migração, nenhuma dependência externa, reaproveitam serviços validados), cada um em commit local separado, com testes e Playwright novos, sem push sem autorização. **B3** começa assim que a decisão 2 (faixa de valores) for tomada.

---

## 8. Fase B — entregas B1 e B2 (2026-10-29)

Commits locais (sem push): `77d9b51` (B1), `d965410` (B2). Nenhuma migração, nenhuma dependência nova, nenhuma integração externa.

### Telas alteradas
| Tela | Mudança |
|---|---|
| `/motorista/pedido/[id]` | etapa real do início: ordem **enviada** → **aceita pelo carregador** → recarga iniciada; recusa explicada (prazo, sem nova cobrança, análise de estorno). Textos próprios na demonstração |
| `/motorista/recarga/[id]` | **"Solicitação de encerramento enviada"** lida do comando gravado (sobrevive a recarregar a página); "aceito" ≠ "encerrado"; botão some com pedido em curso e volta como "Pedir o encerramento de novo" se o carregador recusar; última medição e última comunicação com horário |
| `/motorista` | filtros (conector, potência mínima, preço máximo, disponível agora, compatível com meu veículo), contagem, estado vazio; ordenação opcional por distância em linha reta |
| `/motorista/estacoes/[identity]` | compatibilidade por conector com os veículos cadastrados (só pelo tipo; potência do veículo não verificada); rótulos de conector legíveis |

### Reaproveitado
`stopCharge`, `RemoteCommand` (estados existentes), `getMySession`/`getMyChargeRequest`, `listDriverStations`/`getDriverStation`, `effectiveStatus`/`isStationFresh`, `Vehicle.connectorTypes`, `ActionForm`, `Alert`, `StateMessage`, `Select`/`Input`. Novo: `src/domain/charging/driver-state.ts`, `src/domain/stations/discovery.ts`, `listMyVehicles`, `src/app/motorista/nearby-list.tsx`.

### Defeitos encontrados e corrigidos (com teste que falhava antes)
1. **Encerramento atendia o comando de outra recarga**: `stopCharge` e a parada por limite reaproveitavam qualquer `REMOTE_STOP` pendente da **estação**; com dois conectores, o pedido do motorista B devolvia o comando do motorista A e a recarga de B não parava. Agora o reaproveitamento é por transação.
2. **Demonstração não enviava RemoteStart** (regressão do P13, `a252e71`): `issueStart` era chamado sem `from: "START_REQUESTED"` para pedidos de demonstração, então a transição condicional não ocorria.

### Testes (saída real)
| Verificação | Resultado |
|---|---|
| `npm test` | 23 arquivos, **244 testes**, 0 falhas (eram 232: +3 `driver-state`, +6 `discovery`, +3 integração B1) |
| `npm run lint` / `npm run typecheck` | 0 / 0 |
| `npm run e2e:build && npm run e2e:browser` | **18 passed** (eram 14): teste C ampliado (ordem enviada/aceita, encerramento solicitado/aceito, última comunicação), novo teste de encerramento pelo botão com recarga da página e recusa, 3 testes B2 (filtros, compatibilidade, localização emulada e negada — a posição não aparece em nenhuma requisição) |
| Visual 375 px (servidor de dev, só leitura) | sem rolagem horizontal; filtros e botão de distância legíveis |
| `npm run e2e:rotas` | **não repetido** nesta fase |
| CI remoto ([40814257774](https://github.com/WIsleyoliveira/WeMob/actions/runs/40814257774), `3d53154`, push autorizado) | **verde**: `check` (ubuntu-24.04) 23 arquivos / **244 testes**, `npm audit` 0, build, Playwright **18 passed**; `docker` imagens reais 503 → migração → 200 |

### Classificação
| Requisito | Estado |
|---|---|
| Estados enviada/aceita/iniciada e solicitada/aceita/encerrada | CONCLUÍDO COM EVIDÊNCIA (simulador) |
| Última informação confiável com horário durante falha | CONCLUÍDO COM EVIDÊNCIA (simulador) |
| Filtros por conector, potência, preço e disponibilidade | CONCLUÍDO COM EVIDÊNCIA |
| Distância/mais próxima sem armazenar localização | CONCLUÍDO COM EVIDÊNCIA (geolocalização emulada no navegador) |
| Compatibilidade pelo veículo | PARCIAL — só tipo de conector; potência AC/DC do veículo não é cadastrada |
| Mapa, busca por endereço, rotas | BLOQUEADO EXTERNAMENTE (decisão 3) |
| Escolha por valor/kWh (B3) | PENDENTE — aguarda decisão 2 (faixa de valores) |
| Comportamento em carregador físico | BLOQUEADO EXTERNAMENTE (sem hardware) |
