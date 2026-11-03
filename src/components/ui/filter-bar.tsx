import Link from "next/link";
import { Search } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Barra de filtros de lista (GET): os filtros ficam no endereço (compartilháveis, funcionam sem JavaScript).
 * Campos em grade responsiva — uma coluna no celular, várias no desktop. "Limpar" volta à lista sem filtros.
 */
export function FilterBar({ action, hidden = {}, clearHref, active, children, className }: { action: string; hidden?: Record<string, string | undefined>; clearHref?: string; active?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <form method="get" action={action} role="search" className={cn("mb-5 rounded-[var(--radius-card)] border border-navy-100 bg-white p-3 sm:p-4", className)}>
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="grid grid-cols-2 items-end gap-3 lg:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {children}
        <div className="col-span-2 flex items-end gap-2 lg:col-span-1">
          <button type="submit" className={buttonClass({ variant: "secondary" })}>Filtrar</button>
          {active && clearHref && <Link href={clearHref} className="inline-flex h-10 items-center px-2 text-sm font-medium text-navy-600 underline hover:text-navy-900">Limpar</Link>}
        </div>
      </div>
    </form>
  );
}

/** Campo de filtro com rótulo visível (o rótulo é o nome acessível). */
export function FilterField({ label, children, className, wide }: { label: string; children: React.ReactNode; className?: string; wide?: boolean }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-sm", wide && "col-span-2 lg:col-span-1", className)}>
      <span className="font-medium text-navy-700">{label}</span>
      {children}
    </label>
  );
}

/** Busca de texto com ícone, para usar dentro de FilterField. */
export function SearchInput({ name = "q", defaultValue, placeholder }: { name?: string; defaultValue?: string; placeholder: string }) {
  return (
    <span className="relative block">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-navy-400" aria-hidden />
      <input type="search" name={name} defaultValue={defaultValue} placeholder={placeholder} maxLength={100} className="h-10 w-full rounded-lg border border-navy-200 bg-white pl-9 pr-3 text-sm text-navy-900 placeholder:text-navy-300 hover:border-navy-300 focus:border-tiffany-500 focus:outline-none focus:ring-2 focus:ring-tiffany-500/20" />
    </span>
  );
}
