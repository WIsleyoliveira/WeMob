import type { Metadata } from "next";
import Link from "next/link";
import { History, LifeBuoy, MapPin, User } from "lucide-react";
import { getDriver } from "@/server/drivers/current";
import { Logo } from "@/components/ui/logo";
import { BottomNavLink } from "./bottom-nav-link";

export const metadata: Metadata = { title: { default: "Motorista", template: "%s · Sansol Mob" }, robots: { index: false } };

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const driver = await getDriver();
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-[var(--bg)]">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-navy-950 px-4">
        <Link href="/motorista" aria-label="Início"><Logo inverted /></Link>
        {driver ? <span className="max-w-[45%] truncate text-sm text-navy-200">{driver.name.split(" ")[0]}</span> : <Link href="/motorista/entrar" className="text-sm font-medium text-white">Entrar</Link>}
      </header>
      <main id="conteudo" className="flex-1 px-4 pb-24 pt-4">{children}</main>
      <nav aria-label="Navegação do motorista" className="fixed inset-x-0 bottom-0 z-30 mx-auto grid max-w-lg grid-cols-4 border-t border-navy-100 bg-white pb-[env(safe-area-inset-bottom)]">
        <BottomNavLink href="/motorista" label="Estações"><MapPin className="size-5" aria-hidden /></BottomNavLink>
        <BottomNavLink href="/motorista/historico" label="Recargas"><History className="size-5" aria-hidden /></BottomNavLink>
        <BottomNavLink href="/motorista/ajuda" label="Ajuda"><LifeBuoy className="size-5" aria-hidden /></BottomNavLink>
        <BottomNavLink href="/motorista/conta" label="Conta"><User className="size-5" aria-hidden /></BottomNavLink>
      </nav>
    </div>
  );
}
