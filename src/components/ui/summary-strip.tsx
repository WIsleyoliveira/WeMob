import Link from "next/link";
import { cn } from "@/lib/cn";

export type SummaryItem = { label: string; value: React.ReactNode; tone?: "default" | "warning" | "danger" | "success"; href?: string; hint?: string; current?: boolean };

const TONE = { default: "text-navy-900", warning: "text-amber-700", danger: "text-red-700", success: "text-brand-700" } as const;

/**
 * Resumo no topo de uma lista: contagens que respondem "o que precisa de atenção". Com `href`, cada número é um
 * atalho para a lista já filtrada (o atual fica marcado com aria-current).
 */
export function SummaryStrip({ items, label, className }: { items: SummaryItem[]; label: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]", className)}>
      {items.map((i) => {
        const body = (
          <>
            <span className="block text-xs font-medium text-navy-500">{i.label}</span>
            <span className={cn("tabular mt-0.5 block font-display text-2xl font-semibold", TONE[i.tone ?? "default"])}>{i.value}</span>
            {i.hint && <span className="mt-0.5 block text-xs text-navy-500">{i.hint}</span>}
          </>
        );
        const box = "block h-full rounded-[var(--radius-card)] border bg-white px-4 py-3 shadow-[var(--shadow-card)]";
        return (
          <li key={i.label}>
            {i.href ? (
              <Link href={i.href} aria-current={i.current ? "true" : undefined} className={cn(box, "transition-colors hover:border-navy-300 focus-visible:ring-2 focus-visible:ring-brand-500", i.current ? "border-navy-900 ring-1 ring-navy-900" : "border-navy-100")}>{body}</Link>
            ) : (
              <div className={cn(box, "border-navy-100")}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
