import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

/** Paginação acessível: "x–y de N", anterior/próxima e a página atual anunciada. */
export function Pagination({ page, pageSize, total, href, label = "registros" }: { page: number; pageSize: number; total: number; href: (page: number) => string; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-100 px-4 py-3 text-sm text-navy-500">
      <span aria-live="polite">{total === 0 ? `Nenhum ${label.replace(/s$/, "")}` : `${from}–${to} de ${total} ${label}`} · página {Math.min(page, pages)} de {pages}</span>
      <span className="flex gap-2">
        {page > 1 ? <Link className={buttonClass({ variant: "secondary", size: "sm" })} href={href(page - 1)} rel="prev">← Anterior</Link> : <span className={buttonClass({ variant: "secondary", size: "sm", className: "pointer-events-none opacity-40" })} aria-disabled="true">← Anterior</span>}
        {page < pages ? <Link className={buttonClass({ variant: "secondary", size: "sm" })} href={href(page + 1)} rel="next">Próxima →</Link> : <span className={buttonClass({ variant: "secondary", size: "sm", className: "pointer-events-none opacity-40" })} aria-disabled="true">Próxima →</span>}
      </span>
    </nav>
  );
}
