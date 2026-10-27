"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/app/crm", label: "Funil", exact: true },
  { href: "/app/crm/tarefas", label: "Tarefas" },
  { href: "/app/crm/propostas", label: "Propostas" },
  { href: "/app/crm/empresas", label: "Empresas" },
  { href: "/app/crm/metricas", label: "Métricas" },
  { href: "/app/crm/configurar", label: "Configurar funil", perm: "crm:configure" },
];

export function CrmTabs({ canConfigure }: { canConfigure: boolean }) {
  const path = usePathname();
  if (/^\/app\/crm\/propostas\/[^/]+\/imprimir/.test(path)) return null;
  return (
    <nav aria-label="Seções do CRM" className="mb-6 flex gap-1 overflow-x-auto border-b border-navy-100">
      {TABS.filter((t) => !t.perm || canConfigure).map((t) => {
        const active = t.exact ? path === t.href || /^\/app\/crm\/(?!tarefas|propostas|empresas|metricas|configurar)[^/]+$/.test(path) : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}
            className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors", active ? "border-brand-600 text-navy-900" : "border-transparent text-navy-500 hover:text-navy-800")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
