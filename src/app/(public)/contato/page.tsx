import type { Metadata } from "next";
import { LeadForm } from "@/components/site/lead-form";

export const metadata: Metadata = { title: "Estudo de viabilidade", description: "Solicite um estudo de viabilidade para instalar um eletroposto Sansol Mob no seu estabelecimento." };

export default async function ContatoPage({ searchParams }: { searchParams: Promise<{ origem?: string; utm_campaign?: string }> }) {
  const sp = await searchParams;
  const fromSim = sp.origem === "simulador";
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-[1fr_1.4fr]">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-navy-900">Vamos avaliar o seu ponto</h1>
        <p className="mt-3 text-navy-500">Conte um pouco sobre o seu estabelecimento. A equipe comercial analisa as informações e agenda uma conversa para o estudo de viabilidade.</p>
        <ul className="mt-8 space-y-4 text-sm text-navy-600">
          <li><b className="text-navy-900">1. Análise inicial</b><br />Localização, fluxo de veículos e infraestrutura elétrica.</li>
          <li><b className="text-navy-900">2. Reunião</b><br />Apresentação dos modelos e das premissas do seu caso.</li>
          <li><b className="text-navy-900">3. Proposta</b><br />Projeto técnico, investimento e condições contratuais.</li>
        </ul>
      </div>
      <div className="rounded-[var(--radius-card)] border border-navy-100 bg-white p-6 shadow-[var(--shadow-card)]">
        <LeadForm source={fromSim ? "WEBSITE_SIMULATOR" : "WEBSITE_VIABILITY"} campaign={sp.utm_campaign?.slice(0, 120)} />
      </div>
    </div>
  );
}
