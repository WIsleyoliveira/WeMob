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

## Tipografia
Manrope (títulos, `font-display`) + Inter (texto). Escala: `text-xs` 12 · `text-sm` 14 (padrão no backoffice) · `text-base` 16 · `text-lg` 18 · `text-2xl` 24 (título de página) · `text-3xl/4xl/5xl` (site). Números financeiros com `.tabular`.

## Espaçamento e forma
Escala de 4 px do Tailwind. Gutter de página: 16 px (celular), 32 px (desktop). Cartões: `--radius-card` 14 px, `--shadow-card`. Controles: altura 40 px (`h-10`), botões 32/40/48 px.

## Componentes
`Button`/`ButtonLink` (primary, navy, secondary, ghost, danger) · `Field`/`Input`/`Select`/`Textarea` (rótulo, dica, erro com `role=alert`) · `Card` · `Badge` · `Alert` · `Table` (rolagem horizontal própria) · `PageHeader` + `Breadcrumbs` · `Stat` (KPI com definição, fonte e horário obrigatórios) · `StateMessage` (vazio, erro, sem permissão, integração indisponível) · `Skeleton`/`PageSkeleton` · `ConfirmDialog` (`<dialog>` nativo) · `ActionForm` (server action + pendente/sucesso/erro + confirmação).

## Regras
- Todo número exibido tem unidade, período e fonte; projeções levam o selo "Projeção".
- Dados de demonstração recebem badge "demonstração" e nunca entram em indicadores reais.
- Estados obrigatórios por tela: vazio, erro (`error.tsx`), sem permissão (`/app/sem-permissao`) e envio em andamento (`ActionForm`). **Não usar `loading.tsx` na área `/app`**: no build de produção (Next 15.5) ele fazia as server actions com `revalidatePath` nunca concluírem ("Salvando…" eterno) — removido no P19, protegido por `tests/unit/sem-loading-app.test.ts`. `PageSkeleton` segue disponível para carregamentos dentro da página.
- Foco visível (`outline` Tiffany), link "Pular para o conteúdo", `prefers-reduced-motion` respeitado.
- Ícones: somente `lucide-react`, 16 px no menu, decorativos com `aria-hidden`.
