import Link from "next/link";
import { ChevronRight } from "lucide-react";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-navy-500">
        {items.map((c, i) => (
          <li key={c.label} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-navy-300" aria-hidden />}
            {c.href ? <Link href={c.href} className="hover:text-navy-900">{c.label}</Link> : <span aria-current="page" className="text-navy-700">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
