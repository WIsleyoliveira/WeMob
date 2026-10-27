import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { currentTariff, getSiteDetail, listPartnerOrgs } from "@/server/modules/stations/service";
import { addTariffAction, createStationAction, updateSiteAction } from "@/app/actions/stations";
import { effectiveStatus, isStationFresh, type ConnectorStatus } from "@/domain/stations/status";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/app/action-form";
import { ConnectionBadge, ConnectorStatusBadge, EnvironmentBadge } from "@/components/app/station-badges";
import { brl, dateTime } from "@/lib/format";
import { SiteFields } from "../site-fields";

export const dynamic = "force-dynamic";

export default async function UnidadePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("site:read");
  const site = await getSiteDetail(ctx, (await params).id).catch(() => notFound());
  const canWrite = ctx.permissions.has("site:write") && ctx.orgKind === "OPERATOR";
  const partners = canWrite ? await listPartnerOrgs(ctx) : [];
  const now = new Date();
  const tariff = currentTariff(site.tariffs, now);
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Unidades", href: "/app/unidades" }, { label: site.name }]}
        title={site.name}
        description={`${site.address ? site.address + " · " : ""}${site.city ? `${site.city}/${site.state ?? ""}` : "Local não informado"}${site.openingHours ? ` · ${site.openingHours}` : ""}`}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Estações e conectores" description="Status exibido somente com comunicação recente; sem comunicação = desconhecido." />
            {site.stations.length === 0 ? <CardBody><EmptyState title="Nenhuma estação cadastrada" /></CardBody> : (
              <Table>
                <thead><tr><th>Estação</th><th>Ambiente</th><th>Comunicação</th><th>Conectores</th></tr></thead>
                <tbody>
                  {site.stations.map((s) => {
                    const fresh = isStationFresh(s, now);
                    return (
                      <tr key={s.id}>
                        <td><Link className="font-medium text-navy-900 hover:text-brand-700" href={`/app/estacoes/${s.id}`}>{s.ocppIdentity}</Link><p className="text-xs text-navy-500">{[s.vendor, s.model].filter(Boolean).join(" ") || "fabricante não informado"} · {s.protocol === "OCPP16J" ? "OCPP 1.6-J" : s.protocol === "OCPP201" ? "OCPP 2.0.1 (sem adaptador)" : "sem protocolo"}</p></td>
                        <td><EnvironmentBadge env={s.environment} /></td>
                        <td><ConnectionBadge fresh={fresh} state={s.connectionState} /><p className="text-xs text-navy-500">{s.lastSeenAt ? `última mensagem ${dateTime(s.lastSeenAt)}` : "—"}</p></td>
                        <td className="space-x-1">{s.connectors.length === 0 ? "—" : s.connectors.map((c) => <span key={c.id} className="inline-flex items-center gap-1 text-xs">#{c.connectorId} <ConnectorStatusBadge status={effectiveStatus(c as { status: ConnectorStatus }, s, now).status} /></span>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <CardHeader title="Tarifas" description="Versionadas por vigência; a anterior é preservada." />
            <CardBody className="flex flex-col gap-4">
              <p className="text-sm">Vigente: {tariff ? <b>{brl(tariff.pricePerKwh.toString())}/kWh{Number(tariff.pricePerMin) > 0 ? ` + ${brl(tariff.pricePerMin.toString())}/min` : ""}</b> : <span className="text-navy-500">nenhuma tarifa vigente</span>} {tariff && <span className="text-xs text-navy-500">desde {dateTime(tariff.validFrom)}</span>}</p>
              {site.tariffs.length > 0 && (
                <Table>
                  <thead><tr><th>Vigência</th><th className="text-right">R$/kWh</th><th className="text-right">R$/min</th></tr></thead>
                  <tbody>{site.tariffs.map((t) => <tr key={t.id}><td className="text-xs">{dateTime(t.validFrom)} {t.validFrom > now && <Badge tone="amber">agendada</Badge>}</td><td className="tabular text-right">{brl(t.pricePerKwh.toString())}</td><td className="tabular text-right">{brl(t.pricePerMin.toString())}</td></tr>)}</tbody>
                </Table>
              )}
              {canWrite && (
                <ActionForm action={addTariffAction} submitLabel="Registrar tarifa" variant="secondary" size="sm">
                  <input type="hidden" name="siteId" value={site.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="R$/kWh" htmlFor="pkwh"><Input id="pkwh" name="pricePerKwh" inputMode="decimal" required /></Field>
                    <Field label="R$/min (opcional)" htmlFor="pmin"><Input id="pmin" name="pricePerMin" inputMode="decimal" /></Field>
                    <Field label="Vigente a partir de" htmlFor="vf"><Input id="vf" name="validFrom" type="datetime-local" required /></Field>
                  </div>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          {canWrite && (
            <Card>
              <CardHeader title="Nova estação" description="A senha OCPP é exibida uma única vez." />
              <CardBody>
                <ActionForm action={createStationAction} submitLabel="Cadastrar estação">
                  <input type="hidden" name="siteId" value={site.id} />
                  <Field label="Identidade OCPP (chargeBoxId)" htmlFor="ocppIdentity"><Input id="ocppIdentity" name="ocppIdentity" required placeholder="Ex.: SANSOL-BEL-001" /></Field>
                  <Field label="Ambiente" htmlFor="environment" hint="Simulado/Teste ficam fora dos indicadores de produção.">
                    <Select id="environment" name="environment" defaultValue="SIMULATED"><option value="SIMULATED">Simulado</option><option value="TEST">Teste (bancada)</option><option value="PRODUCTION">Produção (equipamento real)</option></Select>
                  </Field>
                  <Field label="Protocolo" htmlFor="protocol">
                    <Select id="protocol" name="protocol" defaultValue="OCPP16J"><option value="OCPP16J">OCPP 1.6-J (implementado)</option><option value="OCPP201">OCPP 2.0.1 (cadastro; sem adaptador)</option><option value="NONE">Sem integração</option></Select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Fabricante" htmlFor="vendor"><Input id="vendor" name="vendor" /></Field>
                    <Field label="Modelo" htmlFor="model"><Input id="model" name="model" /></Field>
                    <Field label="Nº de série" htmlFor="serialNumber"><Input id="serialNumber" name="serialNumber" /></Field>
                    <Field label="Heartbeat (s)" htmlFor="hb"><Input id="hb" name="heartbeatInterval" inputMode="numeric" defaultValue="300" /></Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canWrite && (
            <Card>
              <CardHeader title="Dados da unidade" />
              <CardBody>
                <ActionForm action={updateSiteAction} submitLabel="Salvar" variant="secondary">
                  <input type="hidden" name="siteId" value={site.id} />
                  <SiteFields partners={partners} d={{ ...site, partnerOrganizationId: site.partnerOrganization?.id }} />
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
