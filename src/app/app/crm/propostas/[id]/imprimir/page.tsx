import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getProposal } from "@/server/modules/crm/proposals";
import { Logo } from "@/components/ui/logo";
import { brl, date } from "@/lib/format";
import { PrintButton } from "./print-button";

type Item = { description: string; quantity: string; unitPrice: string; total: string };

/** Documento para impressão ou "Salvar como PDF" do navegador (sem gerador de PDF no servidor). */
export default async function ImprimirPropostaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("lead:read");
  const p = await getProposal(ctx, (await params).id).catch(() => notFound());
  const v = p.versions[0];
  const items = v.items as unknown as Item[];
  return (
    <article className="mx-auto max-w-3xl bg-white p-8 text-navy-900 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <p className="text-sm text-navy-500">Use “Salvar como PDF” na janela de impressão.</p>
        <PrintButton />
      </div>
      <div className="flex items-start justify-between border-b border-navy-200 pb-4">
        <Logo />
        <div className="text-right text-sm">
          <p className="font-semibold">{p.number} · versão {v.version}</p>
          <p className="text-navy-500">Válida até {date(v.validUntil)}</p>
        </div>
      </div>
      <h1 className="mt-6 font-display text-2xl font-semibold">{p.title}</h1>
      <p className="mt-1 text-sm text-navy-600">Para: {p.lead.companyName ?? p.lead.contactName}{p.lead.city ? ` — ${p.lead.city}/${p.lead.state ?? ""}` : ""}</p>
      <table className="mt-6 w-full border-collapse text-sm">
        <thead><tr className="border-b border-navy-200 text-left"><th className="py-2">Item</th><th className="py-2 text-right">Qtd.</th><th className="py-2 text-right">Unitário</th><th className="py-2 text-right">Total</th></tr></thead>
        <tbody>
          {items.map((i, k) => <tr key={k} className="border-b border-navy-100"><td className="py-2">{i.description}</td><td className="py-2 text-right">{i.quantity}</td><td className="py-2 text-right">{brl(i.unitPrice)}</td><td className="py-2 text-right">{brl(i.total)}</td></tr>)}
          <tr className="font-semibold"><td className="py-2" colSpan={3}>Total</td><td className="py-2 text-right">{brl(v.total.toString())}</td></tr>
        </tbody>
      </table>
      <h2 className="mt-8 font-display text-lg font-semibold">Condições comerciais</h2>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{v.conditions}</p>
      <p className="mt-10 border-t border-navy-200 pt-4 text-xs text-navy-500">
        Proposta comercial sujeita a estudo de viabilidade e a contrato. Projeções de resultado, quando houver, são estimativas e não constituem garantia de rentabilidade.
      </p>
    </article>
  );
}
