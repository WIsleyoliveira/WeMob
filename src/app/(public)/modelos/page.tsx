import type { Metadata } from "next";
import { getPublicTerms } from "@/server/modules/commercial/service";
import { FEE_BASE_LABEL } from "@/domain/commercial/types";
import { brl, date, pct } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modelos de investimento", description: "Compare a compra integral e a parceria 50/50 para eletropostos Sansol Mob." };

export default async function ModelosPage() {
  const models = await getPublicTerms();
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="font-display text-3xl font-bold tracking-tight text-navy-900 sm:text-4xl">Você escolhe como entrar nesse mercado</h1>
      <p className="mt-2 max-w-2xl text-navy-500">Condições comerciais vigentes. Valores de referência, sujeitos ao contrato firmado após o estudo de viabilidade.</p>

      {models.length === 0 ? (
        <Alert tone="warning" className="mt-8" title="Nenhum modelo comercial vigente">As condições estão em revisão. Fale com a equipe comercial.</Alert>
      ) : (
        <>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {models.map(({ terms: t, responsibilities, maintenancePolicy }) => (
              <article key={t.modelKey} className="flex flex-col rounded-[var(--radius-card)] border border-navy-100 bg-white p-6 shadow-[var(--shadow-card)]">
                <h2 className="font-display text-xl font-semibold text-navy-900">{t.modelName}</h2>
                <p className="mt-1 text-sm text-navy-500">Versão {t.version}</p>
                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                  <div><dt className="text-navy-500">Investimento do cliente</dt><dd className="tabular font-display text-lg font-semibold">{brl(t.referenceInvestment * t.partnerCapitalShare)}</dd></div>
                  <div><dt className="text-navy-500">Resultado das recargas</dt><dd className="font-display text-lg font-semibold">{pct(t.partnerResultShare, 0)} do cliente</dd></div>
                  <div><dt className="text-navy-500">Royalty da marca</dt><dd className="font-semibold">{pct(t.royaltyRate, 0)} <span className="font-normal text-navy-500">s/ {FEE_BASE_LABEL[t.royaltyBase].toLowerCase()}</span></dd></div>
                  <div><dt className="text-navy-500">Sistema + gateway</dt><dd className="font-semibold">{pct(t.platformFeeRate, 0)} <span className="font-normal text-navy-500">por transação</span></dd></div>
                  <div><dt className="text-navy-500">Tributos estimados</dt><dd className="font-semibold">até {pct(t.taxRate, 0)} <span className="font-normal text-navy-500">s/ bruto</span></dd></div>
                  <div><dt className="text-navy-500">Manutenção</dt><dd className="font-semibold">{maintenancePolicy}</dd></div>
                </dl>
                {responsibilities && (
                  <div className="mt-6 grid gap-4 border-t border-navy-100 pt-5 text-sm sm:grid-cols-2">
                    <div>
                      <p className="font-semibold text-navy-900">Sansol Mob</p>
                      <ul className="mt-2 space-y-1 text-navy-600">{responsibilities.sansol.map((r) => <li key={r}>• {r}</li>)}</ul>
                    </div>
                    <div>
                      <p className="font-semibold text-navy-900">{t.partnerCapitalShare < 1 ? "Parceiro" : "Investidor"}</p>
                      <ul className="mt-2 space-y-1 text-navy-600">{responsibilities.partner.map((r) => <li key={r}>• {r}</li>)}</ul>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
          <p className="mt-6 text-xs text-navy-400">
            Condições vigentes desde {date(models[0].approvedAt ?? new Date())}. Propriedade da estrutura, base de cálculo de cada taxa, rateio de custos e obrigações das partes são definidos em contrato.
            Tributos dependem do regime tributário e devem ser confirmados com contador habilitado.
          </p>
        </>
      )}
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/simulador">Simular com estas condições</ButtonLink>
        <ButtonLink href="/contato" variant="secondary">Solicitar estudo de viabilidade</ButtonLink>
      </div>
    </div>
  );
}
