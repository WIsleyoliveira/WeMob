import { requirePage } from "@/server/auth/current";
import { listModels, versionState } from "@/server/modules/commercial/service";
import { approveVersionAction, createDraftVersionAction } from "@/app/actions/commercial";
import { FEE_BASE_LABEL, FEE_BASES } from "@/domain/commercial/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { brl, date, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS = { DRAFT: ["Rascunho", "amber"], SCHEDULED: ["Agendada", "tiffany"], EFFECTIVE: ["Vigente", "green"], ENDED: ["Encerrada", "neutral"] } as const;
const p100 = (d: { toNumber(): number }) => String(+(d.toNumber() * 100).toFixed(4));

export default async function ModelosAdminPage() {
  const ctx = await requirePage("commercial_model:read");
  const models = await listModels(ctx);
  const canWrite = ctx.permissions.has("commercial_model:write");
  const canApprove = ctx.permissions.has("commercial_model:approve");

  return (
    <>
      <PageHeader
        title="Modelos comerciais"
        description="Condições versionadas. Versões aprovadas são imutáveis: alterações geram nova versão, válida para novas simulações e contratos, sem efeito retroativo. A aprovação exige um segundo administrador."
      />
      <div className="flex flex-col gap-6">
        {models.map((m) => {
          const current = m.versions.find((v) => versionState(v) === "EFFECTIVE") ?? m.versions[0];
          return (
            <Card key={m.id}>
              <CardHeader title={m.name} description={m.description} />
              <Table>
                <thead><tr><th>Versão</th><th>Status</th><th className="text-right">Investimento ref.</th><th className="text-right">Aporte / resultado</th><th>Royalty</th><th>Sistema + gateway</th><th>Tributos</th><th>Vigência</th><th /></tr></thead>
                <tbody>
                  {m.versions.map((v) => (
                    <tr key={v.id}>
                      <td className="font-semibold">v{v.version}</td>
                      <td><Badge tone={STATUS[versionState(v)][1]}>{STATUS[versionState(v)][0]}</Badge></td>
                      <td className="tabular text-right">{brl(v.referenceInvestment.toString())}</td>
                      <td className="tabular text-right">{pct(v.partnerCapitalShare.toNumber(), 0)} / {pct(v.partnerResultShare.toNumber(), 0)}</td>
                      <td>{pct(v.royaltyRate.toNumber())} <span className="text-xs text-navy-400">s/ {FEE_BASE_LABEL[v.royaltyBase].toLowerCase()}</span></td>
                      <td>{pct(v.platformFeeRate.toNumber())}</td>
                      <td>{pct(v.taxRate.toNumber())} <span className="text-xs text-navy-400">s/ {FEE_BASE_LABEL[v.taxBase].toLowerCase()}</span></td>
                      <td className="text-xs">{v.effectiveFrom ? date(v.effectiveFrom) : "—"}{v.effectiveTo ? ` → ${date(v.effectiveTo)}` : ""}</td>
                      <td>
                        {v.status === "DRAFT" && canApprove && (
                          <ActionForm action={approveVersionAction} submitLabel="Aprovar" size="sm" confirm={`Aprovar v${v.version} de ${m.name}? A versão vigente será encerrada.`}>
                            <input type="hidden" name="versionId" value={v.id} />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {current?.sourceNote && <p className="px-5 py-3 text-xs text-navy-400">Origem da versão vigente: {current.sourceNote}</p>}
              {canWrite && current && (
                <details className="border-t border-navy-100">
                  <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-brand-700">Propor nova versão</summary>
                  <CardBody>
                    <ActionForm action={createDraftVersionAction} submitLabel="Criar rascunho">
                      <input type="hidden" name="modelId" value={m.id} />
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="Investimento de referência (R$)" htmlFor={`ri-${m.id}`}><Input id={`ri-${m.id}`} name="referenceInvestment" defaultValue={current.referenceInvestment.toString()} inputMode="decimal" /></Field>
                        <Field label="Aporte do investidor (%)" htmlFor={`cs-${m.id}`}><Input id={`cs-${m.id}`} name="partnerCapitalShare" defaultValue={p100(current.partnerCapitalShare)} inputMode="decimal" /></Field>
                        <Field label="Resultado do investidor (%)" htmlFor={`rs-${m.id}`}><Input id={`rs-${m.id}`} name="partnerResultShare" defaultValue={p100(current.partnerResultShare)} inputMode="decimal" /></Field>
                        <Field label="Vigência a partir de" htmlFor={`ef-${m.id}`}><Input id={`ef-${m.id}`} name="effectiveFrom" type="date" /></Field>
                        <Field label="Royalty (%)" htmlFor={`ro-${m.id}`}><Input id={`ro-${m.id}`} name="royaltyRate" defaultValue={p100(current.royaltyRate)} inputMode="decimal" /></Field>
                        <Field label="Base do royalty" htmlFor={`rb-${m.id}`}>
                          <Select id={`rb-${m.id}`} name="royaltyBase" defaultValue={current.royaltyBase}>{FEE_BASES.map((b) => <option key={b} value={b}>{FEE_BASE_LABEL[b]}</option>)}</Select>
                        </Field>
                        <Field label="Sistema + gateway (%)" htmlFor={`pf-${m.id}`} hint="Sempre sobre o bruto."><Input id={`pf-${m.id}`} name="platformFeeRate" defaultValue={p100(current.platformFeeRate)} inputMode="decimal" /></Field>
                        <Field label="Tributos (%)" htmlFor={`tx-${m.id}`}><Input id={`tx-${m.id}`} name="taxRate" defaultValue={p100(current.taxRate)} inputMode="decimal" /></Field>
                        <Field label="Base dos tributos" htmlFor={`tb-${m.id}`}>
                          <Select id={`tb-${m.id}`} name="taxBase" defaultValue={current.taxBase}>{FEE_BASES.map((b) => <option key={b} value={b}>{FEE_BASE_LABEL[b]}</option>)}</Select>
                        </Field>
                        <Field label="Política de manutenção" htmlFor={`mp-${m.id}`} className="sm:col-span-2 lg:col-span-3"><Input id={`mp-${m.id}`} name="maintenancePolicy" defaultValue={current.maintenancePolicy} /></Field>
                        <Field label="Justificativa / origem" htmlFor={`sn-${m.id}`} className="sm:col-span-2 lg:col-span-4"><Input id={`sn-${m.id}`} name="sourceNote" placeholder="Ex.: revisão comercial aprovada em reunião de diretoria de …" /></Field>
                      </div>
                    </ActionForm>
                  </CardBody>
                </details>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
