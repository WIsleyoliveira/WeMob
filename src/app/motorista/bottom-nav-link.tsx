"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export function BottomNavLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/motorista" ? path === href || path.startsWith("/motorista/estacoes") : path.startsWith(href);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs", active ? "font-semibold text-brand-700" : "text-navy-500")}>
      {children}
      {label}
    </Link>
  );
}
