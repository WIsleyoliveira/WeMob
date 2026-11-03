import Link from "next/link";
import { cn } from "@/lib/cn";

/** Abas por link (situação de uma lista): a atual é marcada com aria-current e o estado fica no endereço. */
export function SegmentedLinks({ items, label, className }: { items: { href: string; label: string; current: boolean; count?: number }[]; label: string; className?: string }) {
  return (
    <nav aria-label={label} className={cn("mb-4 inline-flex max-w-full overflow-x-auto rounded-lg border border-navy-200 bg-white p-0.5 text-sm", className)}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.current ? "page" : undefined} className={cn("shrink-0 rounded-md px-3 py-1.5 font-medium", i.current ? "bg-navy-900 text-white" : "text-navy-600 hover:text-navy-900")}>
          {i.label}{i.count !== undefined && <span className={cn("ml-1.5 tabular text-xs", i.current ? "opacity-80" : "text-navy-400")}>{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
