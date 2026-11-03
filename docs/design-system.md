# Design system Sansol Mob

Fonte da verdade: tokens em `src/app/globals.css` (`@theme`, Tailwind 4) e componentes em `src/components/ui`.

## Cores
| Papel | Token | Uso |
|---|---|---|
| Marca | `brand-500…700` | Ações primárias (`brand-600`, texto branco 4,72:1), links (`brand-700`, 6,71:1) |
| Base institucional | `navy-900/950` | Cabeçalhos, menu lateral, rodapé |
| Destaque | `tiffany-400/500/600` | Detalhes pontuais: foco, marcadores, badge informativo. Nunca como cor de fundo de áreas grandes |
| Texto secundário | `navy-500` (6,49:1) / `navy-400` (4,98:1) | `navy-400` só em fundo branco ou `navy-50`; sobre `navy-950` usar `navy-300` (8,23:1) |
| Semânticos | `success`, `danger`, `warning`, `info` | Alertas, badges e estados |

Contraste medido (WCAG 2.1, fórmula de luminância relativa) — ver IMPLEMENTATION_STATUS.md, P03.

## Tema claro e escuro
- Preferência por aparelho no cookie `sm_theme` (`light` | `dark` | `system`, padrão `system`); seletor `ThemeToggle` (`src/components/theme/theme-toggle.tsx`) no cabeçalho da equipe, do motorista e do site.
- `ThemeScript` (no `<head>` do layout raiz) define `data-theme` antes da primeira pintura — sem piscar. Em `system`, a troca de tema do aparelho é acompanhada sem recarregar.
- No escuro, as **escalas** (`navy`, `brand`, `tiffany`, `amber`, `red` e `white`) são redefinidas em `:root[data-theme="dark"]` mantendo o significado de cada degrau (50 = fundo sutil … 900 = texto forte). Por isso componentes e gráficos usam as classes de sempre (`bg-white`, `text-navy-900`, `fill-brand-600`) e **não** variantes `dark:`.
- Áreas que são escuras nos dois temas (barra lateral, cabeçalho do motorista, faixas do site, login) levam `theme-fixed`, que repõe a paleta clara por dentro.
- Sobreposições de modal usam `backdrop:bg-black/60` (não marinho, que clareia no escuro).

## Navegação
- Equipe: menu agrupado por tarefa em `src/app/app/nav.ts` (Visão geral · Rede de recarga · Financeiro · Comercial · Atendimento · Meu posto · Administração), filtrado por permissão; no celular, gaveta aberta pelo botão "Menu" (`mobile-nav.tsx`, fecha com Esc e ao trocar de página). Cabeçalho com organização, perfil por extenso, alertas abertos (vermelho se houver crítico), tema, conta e sair.
- Motorista: navegação inferior fixa (Estações · Recargas · Consumo · Ajuda · Conta).

## Indicadores
- `BarChart` (série no tempo, com tabela para leitor de tela) e `MeterList` (`src/components/ui/meter-list.tsx`: barras 0–100% acessíveis como `role="meter"`, `null` = sem dado, nunca 0%, destaque abaixo de um limite).
- Todo indicador diz período, unidade e fonte; dado de teste/simulação só entra quando pedido e com aviso visível.

## Tipografia
Manrope (títulos, `font-display`) + Inter (texto). Escala: `text-xs` 12 · `text-sm` 14 (padrão no backoffice) · `text-base` 16 · `text-lg` 18 · `text-2xl` 24 (título de página) · `text-3xl/4xl/5xl` (site). Números financeiros com `.tabular`.

## Espaçamento e forma
Escala de 4 px do Tailwind. Gutter de página: 16 px (celular), 32 px (desktop). Cartões: `--radius-card` 14 px, `--shadow-card`. Controles: altura 40 px (`h-10`), botões 32/40/48 px.

## Componentes
`Button`/`ButtonLink` (primary, navy, secondary, ghost, danger) · `Field`/`Input`/`Select`/`Textarea` (rótulo, dica, erro com `role=alert`) · `Card` · `Badge` · `Alert` · `Table` (rolagem horizontal própria) · `PageHeader` + `Breadcrumbs` · `Stat` (KPI com definição, fonte e horário obrigatórios) · `StateMessage` (vazio, erro, sem permissão, integração indisponível) · `Skeleton`/`PageSkeleton` · `ConfirmDialog` (`<dialog>` nativo) · `ActionForm` (server action + pendente/sucesso/erro + confirmação).
- **Gráficos** (P23): `BarChart` (`src/components/ui/bar-chart.tsx`) — SVG sem dependência; título, unidade e período sempre visíveis; total e maior valor em texto; tooltip nativo por barra; tabela equivalente para leitor de tela; estado vazio com orientação; rótulos do eixo em HTML (legíveis no celular). Os valores chegam prontos do servidor (`src/domain/usage/series.ts`); o componente não estima nem completa dados. Cores: `brand` (energia), `navy` (dinheiro), `tiffany` (contagens).
- **Áreas do motorista**: títulos `text-2xl`, ação principal por tela; cartões `rounded-2xl`; seletores de período como pílulas (`aria-current`); valores sugeridos como botões de no mínimo 44 px (`aria-pressed`); selo "Exemplo — não comercial" para qualquer valor ilustrativo.

## Regras
- Todo número exibido tem unidade, período e fonte; projeções levam o selo "Projeção".
- Dados de demonstração recebem badge "demonstração" e nunca entram em indicadores reais.
- Indicadores e gráficos mostram só **produção** por padrão; teste/simulação só quando o usuário pede, com aviso. Dinheiro é sempre o **confirmado pelo gateway** (capturado − estornado), separado de pendente e de estorno; nunca é chamado de receita contábil.
- Estados obrigatórios por tela: vazio, erro (`error.tsx`), sem permissão (`/app/sem-permissao`) e envio em andamento (`ActionForm`). **Não usar `loading.tsx` na área `/app`**: no build de produção (Next 15.5) ele fazia as server actions com `revalidatePath` nunca concluírem ("Salvando…" eterno) — removido no P19, protegido por `tests/unit/sem-loading-app.test.ts`. `PageSkeleton` segue disponível para carregamentos dentro da página.
- Foco visível (`outline` Tiffany), link "Pular para o conteúdo", `prefers-reduced-motion` respeitado.
- Ícones: somente `lucide-react`, 16 px no menu, decorativos com `aria-hidden`.
