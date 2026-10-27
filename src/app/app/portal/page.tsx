import { requirePage } from "@/server/auth/current";
import { partnerContracts, partnerIndicators, partnerStatements } from "@/server/modules/partner/portal";
import { BASE_LABEL } from "@/server/modules/contracts/service";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { SettlementTable } from "@/components/app/settlement-table";
import { brl, date, dateTime, num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  const ctx = await requirePage("partner_portal:read");
  if (ctx.orgKind === "OPERATOR") return <Alert tone="info">O portal é exclusivo de parceiros e investidores. A operadora acompanha estes dados em Financeiro e Contratos.</Alert>;
  const [contracts, statements, ind] = await Promise.all([partnerContracts(ctx), partnerStatements(ctx), partnerIndicators(ctx)]);
  const conns = ind.perConnector;
  const availability = conns.length ? conns.reduce((a, c) => a + c.availability, 0) / conns.length : null;
  return (
    <>
      <PageHeader title={`Portal — ${ctx.organizationName}`} description="Somente os dados das suas unidades e contratos. Extratos refletem fechamentos aprovados pela operadora." />
      <Alert tone="info" className="mb-6">Valores gerenciais. Para fins fiscais/contábeis, consulte seu contador. Dúvidas sobre o extrato: fale com a Sansol Mob.</Alert>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Estações (produção)" value={num(ind.stations.total)} definition="Estações de produção nas suas unidades." source="Cadastro de estações" updatedAt={ind.computedAt} />
        <Stat label="Sessões concluídas (30 dias)" value={num(ind.sessions.completed)} definition="Sessões de produção concluídas nos últimos 30 dias." source="Servidor OCPP" updatedAt={ind.computedAt} />
        <Stat label="Energia entregue (30 dias)" value={`${num(ind.sessions.energyKwhCompleted, 1)} kWh`} definition="Σ (medidor final − inicial) das sessões concluídas." source="Servidor OCPP" updatedAt={ind.computedAt} />
        <Stat label="Disponibilidade (30 dias)" value={availability === null ? "—" : pct(availability)} definition="Média por conector do tempo fora de Indisponível/Em falha/Sem comunicação ÷ período." source="Status OCPP" updatedAt={ind.computedAt} />
      </div>
      <h2 className="mb-3 font-display text-lg font-semibold text-navy-900">Contratos e documentos</h2>
      {contracts.length === 0 ? <EmptyState title="Nenhum contrato ativo" /> : (
        <div className="mb-8 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          {contracts.map((c) => (
            <Card key={c.id}>
              <CardHeader title={`${c.number} · ${c.title}`} description={c.sites.map((s) => s.site.name).join(", ")} />
              <CardBody className="space-y-3 text-sm">
                {c.current ? <p>Condição vigente (v{c.current.version} desde {date(c.current.effectiveFrom)}): royalty {pct(c.current.royaltyRate.toString(), 2)} s/ {BASE_LABEL[c.current.royaltyBase].toLowerCase()} · taxa de sistema {pct(c.current.platformFeeRate.toString(), 2)} · sua participação {pct(c.current.partnerShareRate.toString(), 2)} s/ {BASE_LABEL[c.current.partnerShareBase].toLowerCase()}.</p> : <p className="text-amber-700">Sem versão aprovada vigente.</p>}
                <ul className="space-y-1">{c.documents.length === 0 ? <li className="text-navy-500">Nenhum documento disponibilizado.</li> : c.documents.map((d) => <li key={d.id}><a className="text-brand-700 hover:underline" href={`/api/anexos/${d.id}`}>{d.filename}</a> <span className="text-xs text-navy-400">({(d.size / 1024).toFixed(0)} KB)</span></li>)}</ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      <h2 className="mb-3 font-display text-lg font-semibold text-navy-900">Extratos</h2>
      {statements.length === 0 ? <EmptyState title="Nenhum fechamento aprovado ainda" /> : statements.map((s) => (
        <Card key={s.closingId} className="mb-6">
          <CardHeader
            title={`Competência ${s.period}`}
            description={`Aprovado em ${s.approvedAt ? dateTime(s.approvedAt) : "—"} · seu repasse ${brl(s.totals.partnerShare)} · provisionado ${brl(s.provisioned)} · pago ${brl(s.paid)}`}
            actions={<a className="text-sm font-medium text-brand-700 hover:underline" href={`/api/portal/extrato?periodo=${s.period}`}>Baixar CSV</a>}
          />
          <SettlementTable lines={s.lines} />
          {(s.repasses.length > 0 || s.adjustments.length > 0) && (
            <Table>
              <thead><tr><th>Lançamento</th><th>Vencimento</th><th>Situação</th><th className="text-right">Valor</th></tr></thead>
              <tbody>
                {[...s.repasses, ...s.adjustments].map((e) => (
                  <tr key={e.id}><td>{e.description}{e.adjustsPeriod && <Badge tone="amber" className="ml-2">ajuste</Badge>}</td><td>{e.dueDate ? date(e.dueDate) : "—"}</td><td><Badge tone={e.status === "PAID" ? "green" : "amber"}>{e.status === "PAID" ? `Pago em ${e.paidAt ? date(e.paidAt) : "—"}` : "Provisionado"}</Badge></td><td className="tabular text-right">{e.kind === "RECEIVABLE" ? "−" : ""}{brl(e.amount.toString())}</td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      ))}
    </>
  );
}
