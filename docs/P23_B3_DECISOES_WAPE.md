# B3 — Decisões necessárias da WAPE (compra da recarga por valor ou por kWh)

**Para**: comercial + financeiro WAPE · **Preparado em**: 2026-10-29 · **Status de todas as decisões: PENDENTE** (nenhuma aprovada).
Contexto técnico: `docs/P23_B3_ESPECIFICACAO.md`. Este documento não é uma proposta comercial nem um compromisso da empresa; serve para registrar as decisões oficiais.

**Situação do sistema hoje**: a compra por **valor** está implementada e **desligada por padrão** (`CHARGE_AMOUNT_MODE=off`). A compra por **kWh** não é oferecida ao cliente até as decisões 4 e 6.

### Parâmetros de EXEMPLO × decisões pendentes (atualizado em 2026-10-29)
| Parâmetro | Valor no sistema | Natureza | Onde vale |
|---|---|---|---|
| Mínimo por recarga | R$ 5,00 | **EXEMPLO — NÃO COMERCIAL** (`B3_EXAMPLE` em `src/domain/charging/purchase.ts`) | só com `CHARGE_AMOUNT_MODE=example`, sem gateway de produção e fora de estações reais |
| Máximo por recarga | R$ 500,00 | **EXEMPLO — NÃO COMERCIAL** | idem |
| Valor sugerido / atalhos | R$ 50,00 / R$ 20, 50 e 100 | **EXEMPLO — NÃO COMERCIAL** | idem; a tela mostra o selo "Exemplo — não comercial" |
| Preço por kWh | o da tarifa cadastrada da estação (no E2E: R$ 2,00/kWh) | dado da estação, não do B3 | — |
| Energia estimada | calculada pelo limite da sessão (ex.: R$ 50 a R$ 2,00/kWh equivale a 25 kWh; a recarga para em R$ 45 → até 22,5 kWh) | regra técnica em vigor (margem de segurança de 10%) | — |
| Mínimo e máximo **oficiais** | — | **PENDENTE — decisão 1** | `CHARGE_AMOUNT_MODE=configured` + `CHARGE_AMOUNT_MIN/MAX`; produção exige `CHARGE_AMOUNT_APPROVAL_REF` |
| Valor sugerido oficial | — | **PENDENTE — decisão 3** | `CHARGE_AMOUNT_SUGGESTED` (opcional) |

O perfil de exemplo **nunca** é usado como valor de reserva em produção: com gateway de produção ou em estação real ele fica desligado.

Como funciona o limite (regra já em vigor): a recarga para quando o consumo atinge o valor pago **menos uma margem de segurança** (hoje 10%), para a parada chegar a tempo. O que não for consumido é devolvido.

---

### 1. Valor mínimo e máximo por recarga — **PRIORIDADE**
- **Decisão**: o menor e o maior valor (R$) que o cliente pode escolher por recarga. Se forem diferentes por meio de pagamento (Pix × cartão), informar os dois.
- **Impacto**: liga a compra por valor. O mínimo evita recargas cujo custo de processamento supere o valor e deve respeitar o valor mínimo de cobrança do Asaas (pergunta A1 em `docs/P23_ASAAS_PERGUNTAS.md`). O máximo limita a exposição em caso de falha de parada ou de devolução.
- **Se não decidir**: o cliente continua sem escolher o valor e paga o valor único atual.
- **Recomendação técnica**: definir o mínimo só depois da resposta do Asaas sobre o valor mínimo de cobrança. O máximo deve considerar a potência das estações e o maior consumo realista de uma sessão.
- **Decisão oficial**: mínimo R$ ______ · máximo R$ ______ · por meio? ( ) não ( ) sim: Pix ______ / cartão ______
- **Responsável**: ____________________ · **Data**: ___/___/______

### 2. Modos oferecidos
- **Decisão**: oferecer compra ( ) só por valor ( ) só por kWh ( ) ambos.
- **Impacto**: só por valor já está pronto, faltando a decisão 1. Por kWh exige as decisões 4 e 6 e não funciona em estações com tarifa por minuto, porque o custo depende da duração.
- **Se não decidir**: o sistema segue preparado só para valor.
- **Recomendação técnica**: lançar só por valor e avaliar o kWh depois. É o modo mais previsível financeiramente.
- **Decisão oficial**: ______________________ · **Responsável**: __________ · **Data**: ___/___/______

### 3. Valor único atual (`PAYMENT_PREAUTH_AMOUNT`)
- **Decisão**: com a escolha ligada, o valor único ( ) deixa de existir ( ) aparece pré-preenchido como sugestão. Indicar também se haverá atalhos de valores sugeridos (ex.: três botões) e quais.
- **Impacto**: texto e formulário de início; sugestões influenciam o valor médio cobrado e as devoluções.
- **Se não decidir**: o campo fica vazio e o cliente digita o valor.
- **Decisão oficial**: ______________________ · **Responsável**: __________ · **Data**: ___/___/______

### 4. Compra por kWh: como cobrar a margem
- **Decisão**: quando o cliente pede X kWh:
  - **(a)** cobrar o valor que, descontada a margem, cobre os X kWh. Ex.: 10 kWh a R$ 2,40 → cobra R$ 26,67, e a recarga pode ir até R$ 24,00 de energia. A sobra é devolvida.
  - **(b)** cobrar o custo exato (R$ 24,00), e a recarga para antes da energia pedida (cerca de 9 kWh).
- **Impacto**: em (a) o cliente recebe a energia pedida, mas paga mais na hora e depende da devolução (no cartão, estorno parcial: ver o Asaas). Em (b) o cliente paga o exato, mas recebe menos do que pediu.
- **Se não decidir**: a compra por kWh não é oferecida.
- **Recomendação técnica**: (a), por ser a única coerente com o limite de segurança em vigor. Ela depende da confirmação do Asaas sobre o estorno parcial no cartão, ou de restringir o kWh ao Pix.
- **Decisão oficial**: ( ) a ( ) b · **Responsável**: __________ · **Data**: ___/___/______

### 5. Arredondamento mostrado ao cliente
- **Decisão**: casas decimais de kWh no resumo e no recibo (sugestão técnica: até 3 no cálculo, 1 ou 2 na tela). R$ sempre com 2.
- **Impacto**: só apresentação. O cálculo interno não muda: a energia estimada é arredondada para baixo, para nunca prometer mais do que o limite cobre.
- **Se não decidir**: o sistema mostra até 3 casas.
- **Decisão oficial**: ______ casas · **Responsável**: __________ · **Data**: ___/___/______

### 6. Tarifa alterada entre a escolha e o início
- **Decisão**: se a tarifa da estação mudar depois de o cliente ver o resumo e antes de o carregador iniciar: ( ) honrar a tarifa mostrada ( ) aplicar a nova tarifa e avisar ( ) cancelar o pedido sem cobrança.
- **Impacto**: hoje vale a tarifa vigente no **início real** da recarga. Na compra por **valor**, isso muda só a energia recebida, não o valor cobrado. Na compra por **kWh**, muda o valor necessário, e por isso esta decisão é obrigatória para esse modo.
- **Se não decidir**: compra por valor segue como hoje (tarifa do início); compra por kWh não é oferecida.
- **Recomendação técnica**: honrar a tarifa mostrada, gravando a cotação no pedido. Exige uma migração aditiva simples.
- **Decisão oficial**: ______________________ · **Responsável**: __________ · **Data**: ___/___/______

### 7. Comunicação da devolução da sobra
- **Decisão**: texto oficial sobre a devolução do não consumido: prazo no Pix × cartão e se a devolução no cartão pode ser recusada ou adiada pelo gateway.
- **Impacto**: hoje o texto diz "no cartão, pode levar até 10 dias úteis" (documentação do Asaas). O sandbox recusou estorno **parcial** de cartão no dia da compra e no dia seguinte, então o texto pode precisar mudar depois da resposta do Asaas.
- **Se não decidir**: mantém-se o texto atual.
- **Decisão oficial**: ______________________ · **Responsável**: __________ · **Data**: ___/___/______

---
Depois de decidido, a equipe técnica configura `CHARGE_AMOUNT_MODE=configured` com `CHARGE_AMOUNT_MIN`/`CHARGE_AMOUNT_MAX` (e, em produção, `CHARGE_AMOUNT_APPROVAL_REF` com a referência desta decisão) no ambiente de **homologação** primeiro, executa o checklist `docs/P23_CHECKLIST_HOMOLOGACAO.md` e só então avalia produção, que **não está autorizada**.
