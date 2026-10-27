import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";

const STEPS = [
  ["Análise do local", "Avaliação técnica do espaço, do fluxo e da infraestrutura elétrica."],
  ["Projeto técnico", "Dimensionamento dos carregadores e das adequações necessárias."],
  ["Equipamentos", "Seleção da solução de recarga adequada ao perfil do ponto."],
  ["Instalação", "Implantação por equipe especializada."],
  ["Ativação", "Testes, comissionamento e entrada em operação."],
  ["Sistema Sansol Mob", "Gestão da operação, cobrança e dados da unidade."],
  ["Manutenção", "Suporte técnico e continuidade operacional."],
] as const;

const SEGMENTS = [
  ["Postos de combustível", "Amplie o mix de serviços e atenda motoristas de veículos elétricos no mesmo endereço."],
  ["Supermercados", "A recarga acontece enquanto o cliente faz as compras — tempo bem aproveitado."],
  ["Estacionamentos", "Agregue um serviço de maior valor às vagas que você já opera."],
  ["Centros comerciais e empresas", "Atraia visitantes, atenda frotas e colaboradores com uma estrutura gerenciada."],
] as const;

const FAQ = [
  ["Preciso entender de eletromobilidade para ter um eletroposto?", "Não. A Sansol Mob conduz a análise do local, o projeto, a implantação, a ativação e oferece sistema de gestão, suporte e manutenção conforme o contrato."],
  ["Qual a diferença entre compra integral e parceria 50/50?", "Na compra integral o investidor aporta a implantação e fica com o resultado das recargas, pagando royalty e as taxas previstas. Na parceria, Sansol Mob e parceiro dividem investimento, custos e resultado líquido. As condições vigentes estão na página de modelos."],
  ["Os números do simulador são garantidos?", "Não. O simulador mostra projeções baseadas nas premissas que você informa. O resultado real depende da demanda do local, do preço praticado, do custo de energia, de tributos e das condições do contrato."],
  ["Posso usar energia das usinas Sansol?", "Existe essa possibilidade, sujeita a análise técnica, viabilidade de conexão e condições comerciais específicas, avaliadas no estudo de viabilidade."],
  ["Quanto tempo leva a implantação?", "Depende do local, da infraestrutura elétrica existente e de eventuais aprovações da concessionária. O prazo é definido no projeto técnico."],
] as const;

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden bg-navy-950 text-white">
        <div className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(60%_60%_at_80%_20%,rgba(22,163,107,0.35),transparent_70%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1.2fr_1fr] md:py-28">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-tiffany-400">Eletromobilidade para o seu negócio</p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
              Seu espaço também pode <span className="text-brand-400">mover o futuro.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-navy-200">
              Projeto completo de eletroposto para postos, supermercados, estacionamentos e empresas — com tecnologia, marca e suporte contínuo.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/contato" size="lg">Solicitar estudo de viabilidade</ButtonLink>
              <ButtonLink href="/simulador" size="lg" variant="secondary" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30">
                Simular investimento
              </ButtonLink>
            </div>
          </div>
          <ul className="grid grid-cols-2 gap-3 self-center">
            {[
              ["Novo serviço", "para os seus clientes"],
              ["Diferencial", "para o seu negócio"],
              ["Conveniência", "no mesmo endereço"],
              ["Suporte", "contínuo após a implantação"],
            ].map(([a, b]) => (
              <li key={a} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="font-display text-lg font-semibold text-white">{a}</p>
                <p className="text-sm text-navy-300">{b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="font-display text-3xl font-bold tracking-tight text-navy-900">Para quem é</h2>
        <p className="mt-2 max-w-2xl text-navy-500">O carro elétrico vai parar em algum lugar. Que seja no seu estabelecimento.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map(([t, d]) => (
            <div key={t} className="rounded-[var(--radius-card)] border border-navy-100 p-5">
              <div className="mb-3 h-1 w-10 rounded bg-brand-500" />
              <h3 className="font-display font-semibold text-navy-900">{t}</h3>
              <p className="mt-1.5 text-sm text-navy-500">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-20 bg-navy-50/60">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-display text-3xl font-bold tracking-tight text-navy-900">Da análise à operação, uma só jornada</h2>
          <p className="mt-2 max-w-2xl text-navy-500">Um único projeto, do planejamento ao pós-implantação.</p>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)]">
                <span className="grid size-8 place-items-center rounded-full bg-navy-900 font-display text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 font-display font-semibold text-navy-900">{t}</h3>
                <p className="mt-1 text-sm text-navy-500">{d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-[var(--radius-card)] border border-navy-100 p-7">
            <p className="font-display text-5xl font-bold text-brand-600">100%</p>
            <h3 className="mt-3 font-display text-xl font-semibold text-navy-900">Compra integral</h3>
            <p className="mt-2 text-navy-500">Você investe, é o proprietário conforme contrato e fica com o resultado das recargas, utilizando a marca Sansol Mob.</p>
          </div>
          <div className="rounded-[var(--radius-card)] border border-navy-100 p-7">
            <p className="font-display text-5xl font-bold text-tiffany-600">50/50</p>
            <h3 className="mt-3 font-display text-xl font-semibold text-navy-900">Parceria</h3>
            <p className="mt-2 text-navy-500">Sansol Mob e parceiro investem juntos e dividem custos e resultado líquido da unidade.</p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/modelos" variant="navy">Comparar modelos e condições</ButtonLink>
          <ButtonLink href="/simulador" variant="secondary">Abrir simulador</ButtonLink>
        </div>
      </section>

      <section id="perguntas" className="scroll-mt-20 border-t border-navy-100">
        <div className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="font-display text-3xl font-bold tracking-tight text-navy-900">Perguntas frequentes</h2>
          <div className="mt-8 divide-y divide-navy-100 rounded-[var(--radius-card)] border border-navy-100">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-navy-900">
                  {q}
                  <span className="text-navy-400 transition-transform group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-navy-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-brand-700">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-14">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">Vamos avaliar o seu ponto?</h2>
            <p className="mt-1 text-brand-100">Desenhamos o melhor modelo para o seu negócio a partir de um estudo do local.</p>
          </div>
          <Link href="/contato" className="rounded-lg bg-white px-6 py-3 font-semibold text-brand-800 hover:bg-brand-50">Falar com a Sansol Mob</Link>
        </div>
      </section>
    </>
  );
}
