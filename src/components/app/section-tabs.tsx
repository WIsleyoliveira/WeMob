"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type SectionTab = { href: string; label: string; exact?: boolean };

/** Abas de seção (mesmo visual das abas do CRM). */
export function SectionTabs({ label, tabs }: { label: string; tabs: SectionTab[] }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="mb-6 flex gap-1 overflow-x-auto border-b border-navy-100">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
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
