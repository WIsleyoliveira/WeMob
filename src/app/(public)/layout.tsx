import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { ButtonLink } from "@/components/ui/button";

const NAV = [
  { href: "/#como-funciona", label: "Como funciona" },
  { href: "/modelos", label: "Modelos" },
  { href: "/simulador", label: "Simulador" },
  { href: "/#perguntas", label: "Perguntas" },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Pular para o conteúdo</a>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-navy-950/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" aria-label="Sansol Mob — início"><Logo inverted /></Link>
          <nav aria-label="Principal" className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => <Link key={n.href} href={n.href} className="text-sm text-navy-200 transition-colors hover:text-white">{n.label}</Link>)}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden text-sm text-navy-300 hover:text-white sm:inline">Entrar</Link>
            <ButtonLink href="/contato" size="sm">Fale conosco</ButtonLink>
          </div>
        </div>
        <nav aria-label="Principal (celular)" className="flex gap-4 overflow-x-auto border-t border-white/5 px-4 py-2 md:hidden">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="shrink-0 text-sm text-navy-200">{n.label}</Link>)}
        </nav>
      </header>
      <main id="conteudo" className="flex-1">{children}</main>
      <footer className="bg-navy-950 text-navy-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3">
          <div>
            <Logo inverted />
            <p className="mt-3 max-w-xs text-sm">Projetos completos de eletropostos: estudo, implantação, sistema de gestão, suporte e manutenção.</p>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-white">Soluções</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link href="/modelos" className="hover:text-white">Modelos de investimento</Link></li>
              <li><Link href="/simulador" className="hover:text-white">Simulador de viabilidade</Link></li>
              <li><Link href="/contato" className="hover:text-white">Estudo de viabilidade</Link></li>
            </ul>
          </div>
          <div className="text-sm">
            <p className="font-semibold text-white">Legal</p>
            <ul className="mt-2 space-y-1.5">
              <li><Link href="/privacidade" className="hover:text-white">Política de privacidade</Link></li>
              <li><Link href="/termos" className="hover:text-white">Termos de uso</Link></li>
            </ul>
          </div>
        </div>
        <p className="border-t border-white/5 px-4 py-4 text-center text-xs text-navy-300">© {new Date().getFullYear()} Sansol Mob. Projeções não constituem garantia de rentabilidade.</p>
      </footer>
    </div>
  );
}
