import type { Metadata } from "next";
import Link from "next/link";
import { Bell, LogOut, UserRound } from "lucide-react";
import { requirePage } from "@/server/auth/current";
import { logoutAction } from "@/app/actions/auth";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import { openAlertCounts } from "@/server/modules/alerts/engine";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/cn";
import { NavLink } from "./nav-link";
import { MobileNavToggle } from "./mobile-nav";
import { visibleNav } from "./nav";

export const metadata: Metadata = { title: "Plataforma", robots: { index: false } };

const ORG_KIND = { OPERATOR: "Operadora da rede", PARTNER: "Posto parceiro", INVESTOR: "Investidor" } as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePage();
  const groups = visibleNav(ctx.permissions);
  const alerts = await openAlertCounts(ctx);
  const role = SYSTEM_ROLES[ctx.roleKey]?.name ?? ctx.roleKey;
  return (
    <div className="min-h-dvh bg-[var(--bg)] lg:grid lg:grid-cols-[256px_1fr]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>

      {/* Navegação lateral: fixa no desktop; gaveta no celular (aberta pelo botão "Menu" do cabeçalho). */}
      <aside
        id="navegacao"
        data-open="false"
        className="theme-fixed fixed inset-y-0 left-0 z-40 hidden w-72 flex-col overflow-y-auto bg-navy-950 text-navy-200 shadow-2xl data-[open=true]:flex lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-auto lg:shadow-none"
      >
        <div className="flex h-16 items-center px-5">
          <Link href="/app" aria-label="Painel"><Logo inverted /></Link>
        </div>
        <nav aria-label="Módulos" className="flex flex-1 flex-col gap-5 px-3 pb-4">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-300/80">{g.label}</p>
              <ul className="flex flex-col gap-0.5">
                {g.items.map((n) => (
                  <li key={n.href}>
                    <NavLink href={n.href}>
                      <n.icon className="size-4 shrink-0 opacity-80" aria-hidden />
                      <span className="flex-1">{n.label}</span>
                      {n.href === "/app/alertas" && alerts && alerts.total > 0 && (
                        <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", alerts.critical > 0 ? "bg-red-600 text-white" : "bg-white/15 text-white")}>{alerts.total}</span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4 text-xs">
          <p className="truncate font-medium text-white">{ctx.userName}</p>
          <p className="truncate text-navy-300">{ctx.email}</p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-navy-100 bg-white/90 px-4 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNavToggle targetId="navegacao" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-navy-900">{ctx.organizationName}</p>
              <p className="truncate text-xs text-navy-500">{ORG_KIND[ctx.orgKind]} · {role}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            {alerts && (
              <Link href="/app/alertas" className="relative inline-flex size-9 items-center justify-center rounded-lg text-navy-600 hover:bg-navy-100 hover:text-navy-900" aria-label={alerts.total ? `${alerts.total} alerta(s) aberto(s)${alerts.critical ? `, ${alerts.critical} crítico(s)` : ""}` : "Alertas: nenhum aberto"}>
                <Bell className="size-5" aria-hidden />
                {alerts.total > 0 && <span className={cn("absolute -right-0.5 -top-0.5 min-w-4 rounded-full px-1 text-center text-[10px] font-bold leading-4 text-white", alerts.critical ? "bg-red-600" : "bg-amber-600")}>{alerts.total > 99 ? "99+" : alerts.total}</span>}
              </Link>
            )}
            <ThemeToggle />
            <Link href="/app/conta" className="inline-flex size-9 items-center justify-center rounded-lg text-navy-600 hover:bg-navy-100 hover:text-navy-900 sm:w-auto sm:gap-1.5 sm:px-2.5 sm:text-sm sm:font-medium">
              <UserRound className="size-5 sm:size-4" aria-hidden /><span className="sr-only sm:not-sr-only">Minha conta</span>
            </Link>
            <form action={logoutAction}>
              <button className="inline-flex size-9 items-center justify-center rounded-lg text-navy-600 hover:bg-navy-100 hover:text-navy-900 sm:w-auto sm:gap-1.5 sm:px-2.5 sm:text-sm sm:font-medium">
                <LogOut className="size-5 sm:size-4" aria-hidden /><span className="sr-only sm:not-sr-only">Sair</span>
              </button>
            </form>
          </div>
        </header>
        <main id="conteudo" className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
