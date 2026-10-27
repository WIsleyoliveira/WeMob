import { dateTime } from "@/lib/format";

/** Indicador com definição, fonte e horário — nenhum número sem origem. */
export function Stat({
  label,
  value,
  definition,
  source,
  updatedAt,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  definition: string;
  source: string;
  updatedAt?: Date | string;
  tone?: "default" | "projection";
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-navy-100 bg-white p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-navy-500">{label}</p>
        {tone === "projection" && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Projeção</span>}
      </div>
      <p className="tabular mt-1 font-display text-2xl font-semibold text-navy-900">{value}</p>
      <details className="group mt-2 text-xs text-navy-400">
        <summary className="cursor-pointer list-none select-none hover:text-navy-600">
          <span className="underline decoration-dotted underline-offset-2">Definição e fonte</span>
        </summary>
        <p className="mt-1.5">{definition}</p>
        <p className="mt-1">Fonte: {source}{updatedAt ? ` · atualizado ${dateTime(updatedAt)}` : ""}</p>
      </details>
    </div>
  );
}
