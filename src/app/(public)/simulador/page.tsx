import type { Metadata } from "next";
import { getPublicTerms } from "@/server/modules/commercial/service";
import { Simulator } from "@/components/simulator/simulator";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Simulador de viabilidade", description: "Projete energia vendida, faturamento, resultado e payback de um eletroposto Sansol Mob." };

export default async function SimuladorPublicoPage() {
  const models = (await getPublicTerms()).map((m) => ({ terms: m.terms }));
  return (
    <div className="mx-auto max-w-7xl px-4 py-12">
      <h1 className="font-display text-3xl font-bold tracking-tight text-navy-900">Simulador de viabilidade</h1>
      <p className="mt-2 max-w-3xl text-navy-500">
        Ajuste equipamentos, utilização, preço e custos. A energia projetada respeita a potência e a disponibilidade; cada taxa incide sobre a base definida no modelo comercial.
      </p>
      <div className="mt-8">
        {models.length === 0 ? <Alert tone="warning" title="Nenhum modelo comercial vigente no momento." /> : <Simulator models={models} mode="public" />}
      </div>
    </div>
  );
}
