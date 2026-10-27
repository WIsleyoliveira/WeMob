import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { getStatement } from "@/server/modules/finance/statement";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Table } from "@/components/ui/table";
import { Input, Select } from "@/components/ui/field";
import { SettlementTable } from "@/components/app/settlement-table";
import { brl, dateTime } from "@/lib/format";
import { defaultPeriod, isPeriod } from "../labels";

export const dynamic = "force-dynamic";

const VIEWS = { unidade: "Por unidade", estacao: "Por estação", parceiro: "Por parceiro", rede: "Rede" } as const;

export default async function DemonstrativoPage({ searchParams }: { searchParams: Promise<{ periodo?: string; visao?: string }> }) {
  const ctx = await requirePage("finance:read");
  const sp = await searchParams;
  const period = isPeriod(sp.periodo) ? sp.periodo : defaultPeriod();
  const view = (sp.visao && sp.visao in VIEWS ? sp.visao : "unidade") as keyof typeof VIEWS;
  const s = await getStatement(ctx, period);
  const t = s.result.totals;
  return (
    <>
      <PageHeader
        title={`Demonstrativo ${period}`}
        description="Bruto, deduções e líquido; repasses provisionados × efetivamente pagos. Período aberto mostra prévia não registrada."
        actions={ctx.permissions.has("finance:export") && <a className="text-sm font-medium text-brand-700 hover:underline" href={`/api/financeiro/exportar?periodo=${period}`}>Exportar CSV</a>}
      />
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="text-sm text-navy-700">Período <Input type="month" name="periodo" defaultValue={period} className="mt-1 w-44" /></label>
        <label className="text-sm text-navy-700">Visão <Select name="visao" defaultValue={view} className="mt-1 w-44">{Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <button className="h-10 rounded-lg border border-navy-200 px-4 text-sm font-medium text-navy-700 hover:bg-navy-50">Atualizar</button>
      </form>
      {s.kind === "CLOSED"
        ? <Alert tone="success" className="mb-6" title="Período fechado">Resultado registrado e aprovado em {dateTime(s.closing!.decidedAt!)} — <Link className="underline" href={`/app/financeiro/fechamento/${s.closing!.id}`}>ver fechamento</Link>.</Alert>
        : <Alert tone="warning" className="mb-6" title="PRÉVIA — período não fechado">Valores podem mudar até o fechamento ser aprovado. {s.validations?.errors.length ? `${s.validations.errors.length} impedimento(s) para fechar.` : ""}</Alert>}
      {view === "rede" && (
        <Card className="mb-6">
          <Table>
            <tbody>
              {[["Receita de recarga", t.chargingRevenue], ["Outras receitas", t.otherRevenue], ["Bruto", t.gross], ["(−) Tributos", t.taxTotal], ["(−) Taxa de sistema", t.platformFee], ["= Receita líquida", t.netRevenue], ["(−) Royalties", t.royalty], ["(−) Custos das unidades", t.expenses], ["= Resultado operacional", t.operatingResult], ["(−) Repasses a parceiros", t.partnerShare], ["= Resultado das unidades (operadora)", t.operatorResult], ["(−) Despesas da rede sem unidade", t.networkExpenses], ["= Resultado da rede", t.networkResult]].map(([k, v]) => (
                <tr key={k}><td className={k.startsWith("=") ? "font-semibold" : ""}>{k}</td><td className="tabular text-right">{brl(v)}</td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {view === "parceiro" && (
        <Card className="mb-6">
          <Table>
            <thead><tr><th>Parceiro</th><th className="text-right">Unidades</th><th className="text-right">Bruto</th><th className="text-right">Líquida</th><th className="text-right">Resultado</th><th className="text-right">Repasse apurado</th><th className="text-right">Provisionado</th><th className="text-right">Pago</th></tr></thead>
            <tbody>
              {s.result.byPartner.map((p) => (
                <tr key={p.partnerOrganizationId}><td>{p.partnerName}</td><td className="text-right">{p.sites}</td><td className="tabular text-right">{brl(p.gross)}</td><td className="tabular text-right">{brl(p.netRevenue)}</td><td className="tabular text-right">{brl(p.operatingResult)}</td><td className="tabular text-right font-medium">{brl(p.partnerShare)}</td><td className="tabular text-right">{s.kind === "CLOSED" ? brl(s.partnerPayment[p.partnerOrganizationId]?.provisioned) : "—"}</td><td className="tabular text-right">{s.kind === "CLOSED" ? brl(s.partnerPayment[p.partnerOrganizationId]?.paid) : "—"}</td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {(view === "unidade" || view === "estacao") && <Card className="mb-6"><SettlementTable lines={s.result.lines} showStations={view === "estacao"} /></Card>}
      {s.adjustments.length > 0 && (
        <Card>
          <CardHeader title="Ajustes posteriores a este período" description="Não alteram o resultado registrado; somam-se ao saldo com o parceiro." />
          <Table>
            <thead><tr><th>Parceiro</th><th>Descrição</th><th>Sentido</th><th className="text-right">Valor</th></tr></thead>
            <tbody>{s.adjustments.map((a) => <tr key={a.id}><td>{a.partnerOrganization?.name}</td><td>{a.description}</td><td>{a.kind === "PAYABLE" ? "A pagar" : "A receber"}</td><td className="tabular text-right">{brl(a.amount.toString())}</td></tr>)}</tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
