import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { logoutAction } from "@/app/actions/auth";
import type { Permission } from "@/server/auth/permissions";
import { Activity, Building2, ClipboardList, Calculator, FileStack, LayoutDashboard, ScrollText, Users } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { NavLink } from "./nav-link";

export const metadata: Metadata = { title: "Plataforma", robots: { index: false } };

const NAV: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: Permission }[] = [
  { href: "/app", label: "Painel", icon: LayoutDashboard },
  { href: "/app/crm", label: "CRM comercial", icon: ClipboardList, perm: "lead:read" },
  { href: "/app/simulador", label: "Simulador", icon: Calculator, perm: "simulation:run" },
  { href: "/app/modelos", label: "Modelos comerciais", icon: FileStack, perm: "commercial_model:read" },
  { href: "/app/operacao", label: "Operação", icon: Activity, perm: "site:read" },
  { href: "/app/unidades", label: "Unidades", icon: Building2, perm: "site:read" },
  { href: "/app/usuarios", label: "Usuários e acessos", icon: Users, perm: "user:manage" },
  { href: "/app/auditoria", label: "Auditoria", icon: ScrollText, perm: "audit:read" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePage();
  const items = NAV.filter((n) => !n.perm || ctx.permissions.has(n.perm));
  return (
    <div className="min-h-dvh bg-[var(--bg)] lg:grid lg:grid-cols-[240px_1fr]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <aside className="bg-navy-950 text-navy-200 lg:sticky lg:top-0 lg:h-dvh lg:overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4">
          <Link href="/app"><Logo inverted /></Link>
        </div>
        <nav aria-label="Módulos" className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {items.map((n) => (
            <NavLink key={n.href} href={n.href}>
              <n.icon className="size-4 shrink-0 opacity-80" aria-hidden />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-white/5 px-5 py-4 text-xs lg:block">
          <p className="font-medium text-white">{ctx.userName}</p>
          <p className="truncate text-navy-300">{ctx.email}</p>
          <p className="mt-1 text-navy-300">{ctx.organizationName}</p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-navy-100 bg-white px-4 lg:px-8">
          <p className="truncate text-sm text-navy-500"><span className="font-medium text-navy-800">{ctx.organizationName}</span> · {ctx.roleKey}</p>
          <div className="flex items-center gap-4">
            <Link href="/app/conta" className="text-sm font-medium text-navy-600 hover:text-navy-900">Minha conta</Link>
            <form action={logoutAction}><button className="text-sm font-medium text-navy-600 hover:text-navy-900">Sair</button></form>
          </div>
        </header>
        <main id="conteudo" className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
