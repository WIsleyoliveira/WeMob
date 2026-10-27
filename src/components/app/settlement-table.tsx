import { Fragment } from "react";
import { Table } from "@/components/ui/table";
import { brl, pct } from "@/lib/format";
import type { SiteLine } from "@/domain/finance/settlement";

const BASE = { GROSS_REVENUE: "bruto", NET_REVENUE: "líquida", OPERATING_RESULT: "resultado" } as const;

/** Tabela de apuração por unidade + legenda das fórmulas (mesma do motor). */
export function SettlementTable({ lines, showStations = false }: { lines: SiteLine[]; showStations?: boolean }) {
  if (!lines.length) return <p className="p-5 text-sm text-navy-500">Nenhuma unidade com movimento ou contrato no período.</p>;
  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>Unidade</th><th>Contrato</th><th className="text-right">Bruto</th><th className="text-right">Tributos</th><th className="text-right">Taxa sistema</th><th className="text-right">Líquida</th>
            <th className="text-right">Royalty</th><th className="text-right">Custos</th><th className="text-right">Resultado</th><th className="text-right">Repasse parceiro</th><th className="text-right">Operadora</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <Fragment key={l.siteId}>
              <tr>
                <td><p className="font-medium text-navy-900">{l.siteName}</p><p className="text-xs text-navy-400">{l.partnerName ?? "Unidade própria"}</p></td>
                <td className="text-xs">{l.contract ? <>{l.contract.contractNumber} v{l.contract.version}<br />royalty {pct(l.contract.royaltyRate)} s/ {BASE[l.contract.royaltyBase]} · sistema {pct(l.contract.platformFeeRate)} · parceiro {pct(l.contract.partnerShareRate)} s/ {BASE[l.contract.partnerShareBase]}{l.contract.lossTreatment === "CARRY_FORWARD" ? " (compensação)" : ""}</> : "—"}</td>
                <td className="tabular text-right">{brl(l.gross)}</td>
                <td className="tabular text-right">{brl(l.taxTotal)}</td>
                <td className="tabular text-right">{brl(l.platformFee)}</td>
                <td className="tabular text-right">{brl(l.netRevenue)}</td>
                <td className="tabular text-right">{brl(l.royalty)}</td>
                <td className="tabular text-right">{brl(l.expenses)}</td>
                <td className="tabular text-right">{brl(l.operatingResult)}{Number(l.lossCarriedIn) > 0 && <p className="text-xs text-amber-700">− prejuízo anterior {brl(l.lossCarriedIn)}</p>}</td>
                <td className="tabular text-right font-medium">{brl(l.partnerShare)}{Number(l.partnerShare) < 0 && <p className="text-xs text-amber-700">aporte do parceiro</p>}{Number(l.lossCarriedOut) > 0 && <p className="text-xs text-amber-700">prejuízo a compensar {brl(l.lossCarriedOut)}</p>}</td>
                <td className="tabular text-right">{brl(l.operatorResult)}</td>
              </tr>
              {showStations && l.stations.map((s) => (
                <tr key={`${l.siteId}-${s.stationId}`} className="text-xs text-navy-500">
                  <td colSpan={2} className="pl-8">↳ Estação {s.identity} · {s.paymentCount} pagamento(s)</td>
                  <td className="tabular text-right">{brl(s.chargingRevenue)}</td>
                  <td colSpan={8} />
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </Table>
      <details className="border-t border-navy-100 px-5 py-3 text-xs text-navy-500">
        <summary className="cursor-pointer">Fórmulas</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Bruto = receita de recarga (produção: capturado − reembolsado das sessões encerradas no mês, + recarga lançada de sistema externo) + outras receitas lançadas na unidade.</li>
          <li>Tributos = Σ (bruto × alíquota vigente). Taxa de sistema = bruto × taxa do contrato (já inclui gateway). Líquida = bruto − tributos − taxa de sistema.</li>
          <li>Royalty = base (bruto ou líquida) × taxa. Resultado = líquida − custos da unidade − royalty.</li>
          <li>Repasse = base (bruto, líquida ou resultado − prejuízo a compensar) × participação. Base negativa: rateio → aporte do parceiro; compensação → repasse zero e prejuízo levado ao mês seguinte.</li>
          <li>Cada linha é arredondada a 2 casas (meio para cima). Dados de teste/simulação nunca entram.</li>
        </ul>
      </details>
    </>
  );
}
