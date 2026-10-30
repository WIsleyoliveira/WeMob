import { cn } from "@/lib/cn";

export type BarDatum = { key: string; label: string; value: number };

/**
 * Gráfico de barras em SVG (sem dependência): título, unidade e período sempre visíveis; tooltip nativo por
 * barra; tabela equivalente para leitores de tela; estado vazio com orientação. Os valores chegam prontos do
 * servidor — o componente não estima nem completa dados.
 */
export function BarChart({
  title,
  unit,
  period,
  data,
  format,
  emptyText,
  tone = "brand",
  className,
}: {
  title: string;
  unit: string;
  period: string;
  data: BarDatum[];
  format: (v: number) => string;
  emptyText: string;
  tone?: "brand" | "tiffany" | "navy";
  className?: string;
}) {
  const max = Math.max(0, ...data.map((d) => d.value));
  const empty = data.length === 0 || max === 0;
  const W = 640;
  const H = 180;
  const pad = { l: 8, r: 8, t: 12, b: 4 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const step = data.length ? innerW / data.length : innerW;
  const barW = Math.max(2, Math.min(28, step * 0.7));
  const fill = { brand: "fill-brand-600", tiffany: "fill-tiffany-500", navy: "fill-navy-700" }[tone];
  const total = data.reduce((a, d) => a + d.value, 0);
  return (
    <figure className={cn("rounded-[var(--radius-card)] border border-navy-100 bg-white p-4 shadow-[var(--shadow-card)]", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-display text-sm font-semibold text-navy-900">{title}</span>
        <span className="text-xs text-navy-500">{unit} · {period}</span>
      </figcaption>
      {empty ? (
        <p className="mt-6 mb-4 rounded-lg border border-dashed border-navy-200 px-4 py-6 text-center text-sm text-navy-500">{emptyText}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-navy-600">Total no período: <b className="tabular">{format(total)}</b> · maior valor: <span className="tabular">{format(max)}</span></p>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-36 w-full" role="img" aria-label={`${title}: total ${format(total)} no período ${period}.`} preserveAspectRatio="none">
            <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className="stroke-navy-200" strokeWidth={1} />
            {data.map((d, i) => {
              const h = max ? (d.value / max) * innerH : 0;
              const x = pad.l + i * step + (step - barW) / 2;
              return (
                <g key={d.key}>
                  <rect x={x} y={H - pad.b - h} width={barW} height={Math.max(h, d.value > 0 ? 1.5 : 0)} rx={2} className={fill}>
                    <title>{`${d.label}: ${format(d.value)}`}</title>
                  </rect>
                </g>
              );
            })}
          </svg>
          {/* Rótulos em HTML (legíveis em qualquer largura): início, meio e fim do período. */}
          <div className="mt-1 flex justify-between text-xs text-navy-500" aria-hidden>
            {[0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => <span key={data[i].key}>{data[i].label}</span>)}
          </div>
          <table className="sr-only">
            <caption>{`${title} (${unit}), ${period}`}</caption>
            <thead><tr><th scope="col">Período</th><th scope="col">{unit}</th></tr></thead>
            <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td>{format(d.value)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </figure>
  );
}
