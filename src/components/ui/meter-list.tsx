import { cn } from "@/lib/cn";

export type MeterItem = { key: string; label: string; sub?: string; value: number | null; hint?: string };

/**
 * Lista de medidores horizontais (0–100%) — utilização, disponibilidade, consumo do orçamento. Cada barra é um
 * `meter` acessível com o valor por extenso; `null` = sem dado (mostra "—", nunca 0%). Cores pelo token da paleta,
 * então funcionam no tema claro e no escuro.
 */
export function MeterList({ items, emptyText, tone = "brand", thresholds, className }: { items: MeterItem[]; emptyText: string; tone?: "brand" | "tiffany" | "navy"; thresholds?: { warnBelow?: number }; className?: string }) {
  if (items.length === 0) return <p className="text-sm text-navy-500">{emptyText}</p>;
  const fill = { brand: "bg-brand-600", tiffany: "bg-tiffany-500", navy: "bg-navy-700" }[tone];
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {items.map((i) => {
        const pct = i.value === null ? null : Math.max(0, Math.min(1, i.value));
        const warn = pct !== null && thresholds?.warnBelow !== undefined && pct < thresholds.warnBelow;
        return (
          <li key={i.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-navy-800">{i.label}{i.sub && <span className="ml-1.5 text-xs text-navy-500">{i.sub}</span>}</span>
              <span className={cn("tabular shrink-0 font-semibold", warn ? "text-amber-700" : "text-navy-900")}>{pct === null ? "—" : `${Math.round(pct * 1000) / 10}%`}</span>
            </div>
            <div
              role="meter"
              aria-label={i.label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct === null ? undefined : Math.round(pct * 100)}
              aria-valuetext={pct === null ? "sem dado" : `${Math.round(pct * 100)}%${i.hint ? ` — ${i.hint}` : ""}`}
              className="mt-1 h-2 overflow-hidden rounded-full bg-navy-100"
            >
              {pct !== null && <div className={cn("h-full rounded-full", warn ? "bg-amber-600" : fill)} style={{ width: `${pct * 100}%` }} />}
            </div>
            {i.hint && <p className="mt-0.5 text-xs text-navy-500">{i.hint}</p>}
          </li>
        );
      })}
    </ul>
  );
}
