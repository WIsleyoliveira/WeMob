import { requirePage } from "@/server/auth/current";
import { BASE_LABEL, CONTRACT_STATUS_LABEL, LOSS_LABEL, contractFormOptions, getContract } from "@/server/modules/contracts/service";
import { listAttachments } from "@/server/modules/attachments/service";
import { createAmendmentAction, decideVersionAction, setContractStatusAction } from "@/app/actions/contracts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { Attachments } from "@/components/app/attachments";
import { ContractTermsFields } from "@/components/app/contract-terms-fields";
import { date, dateTime, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

const VERSION_STATUS = { DRAFT: "Rascunho — aguardando decisão", APPROVED: "Aprovada", REJECTED: "Recusada" } as const;

export default async function ContratoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("contract:read");
  const c = await getContract(ctx, (await params).id);
  const [docs, opts] = await Promise.all([listAttachments(ctx, "Contract", c.id), ctx.permissions.has("contract:write") ? contractFormOptions(ctx) : Promise.resolve(null)]);
  const name = (id: string | null) => (id ? c.userNames[id] ?? "—" : "—");
  const canApprove = ctx.permissions.has("contract:approve");
  return (
    <>
      <PageHeader
        title={`${c.number} · ${c.title}`}
        breadcrumbs={[{ label: "Contratos", href: "/app/contratos" }, { label: c.number }]}
        description={<>{c.partnerOrganization.name} · unidades: {c.sites.map((s) => s.site.name).join(", ")}{c.statusReason && <> · último motivo de status: “{c.statusReason}”</>}</>}
        actions={<Badge tone={c.status === "ACTIVE" ? "green" : c.status === "DRAFT" ? "amber" : "neutral"}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>}
      />
      {!c.current && <Alert tone="warning" className="mb-6">Nenhuma versão aprovada vigente hoje: fechamentos das unidades deste contrato ficarão bloqueados.</Alert>}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-4">
          {c.versions.map((v) => (
            <Card key={v.id} className={c.current?.id === v.id ? "ring-2 ring-brand-200" : ""}>
              <CardHeader
                title={<>v{v.version} · {v.kind === "ORIGINAL" ? "Original" : "Aditivo"} {c.current?.id === v.id && <Badge tone="green">vigente</Badge>}</>}
                description={`${VERSION_STATUS[v.status]} · vigência ${date(v.effectiveFrom)} → ${v.effectiveTo ? date(v.effectiveTo) : "sem término"}`}
              />
              <CardBody className="space-y-3 text-sm">
                <dl className="grid gap-2 sm:grid-cols-3">
                  <div><dt className="text-xs text-navy-500">Royalty</dt><dd>{pct(v.royaltyRate.toString(), 2)} s/ {BASE_LABEL[v.royaltyBase].toLowerCase()}</dd></div>
                  <div><dt className="text-xs text-navy-500">Taxa de sistema</dt><dd>{pct(v.platformFeeRate.toString(), 2)} s/ bruto (inclui gateway)</dd></div>
                  <div><dt className="text-xs text-navy-500">Parceiro</dt><dd>{pct(v.partnerShareRate.toString(), 2)} s/ {BASE_LABEL[v.partnerShareBase].toLowerCase()}</dd></div>
                  <div><dt className="text-xs text-navy-500">Prejuízo</dt><dd>{LOSS_LABEL[v.lossTreatment]}</dd></div>
                  <div><dt className="text-xs text-navy-500">Prazo do repasse</dt><dd>{v.paymentTermDays} dias após o mês</dd></div>
                  <div><dt className="text-xs text-navy-500">Premissa de origem</dt><dd>{v.commercialModelVersion ? `${v.commercialModelVersion.model.name} v${v.commercialModelVersion.version}` : "—"}</dd></div>
                </dl>
                <p className="whitespace-pre-wrap rounded-lg bg-navy-50/60 p-3 text-navy-700">{v.conditions}</p>
                <p className="text-xs text-navy-500">Criada por {name(v.createdById)} em {dateTime(v.createdAt)} · motivo: “{v.reason}”{v.decidedAt && <> · {v.status === "APPROVED" ? "aprovada" : "recusada"} por {name(v.decidedById)} em {dateTime(v.decidedAt)}{v.decisionNote && <> (“{v.decisionNote}”)</>}</>}</p>
                {v.status === "DRAFT" && canApprove && (v.createdById === ctx.userId ? <Alert tone="info">Você criou esta versão: a decisão cabe a outra pessoa autorizada.</Alert> : (
                  <div className="flex flex-wrap gap-6 border-t border-navy-100 pt-3">
                    <ActionForm action={decideVersionAction} submitLabel="Aprovar versão" size="sm" confirm={`Aprovar a v${v.version}? Ela passa a valer em ${date(v.effectiveFrom)} e não poderá ser editada.`}>
                      <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="contractId" value={c.id} /><input type="hidden" name="decision" value="approve" />
                    </ActionForm>
                    <ActionForm action={decideVersionAction} submitLabel="Recusar" size="sm" variant="danger">
                      <input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="contractId" value={c.id} /><input type="hidden" name="decision" value="reject" />
                      <Input name="note" placeholder="Motivo da recusa" aria-label="Motivo da recusa" required minLength={5} />
                    </ActionForm>
                  </div>
                ))}
              </CardBody>
            </Card>
          ))}
          {opts && c.status !== "TERMINATED" && !c.versions.some((v) => v.status === "DRAFT") && (
            <Card>
              <CardHeader title="Novo aditivo" description="Cria a próxima versão em rascunho; as versões anteriores permanecem inalteradas." />
              <CardBody><ActionForm action={createAmendmentAction} submitLabel="Criar aditivo"><input type="hidden" name="contractId" value={c.id} /><ContractTermsFields modelVersions={opts.modelVersions} reasonLabel="Motivo do aditivo" /></ActionForm></CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Attachments title="Documentos" entityType="Contract" entityId={c.id} items={docs} canUpload={ctx.permissions.has("contract:write")} partnerOption />
          {canApprove && c.status !== "TERMINATED" && (
            <Card>
              <CardHeader title="Status do contrato" />
              <CardBody>
                <ActionForm action={setContractStatusAction} submitLabel="Alterar status" variant="secondary" confirm="Alterar o status do contrato? Encerramento é definitivo.">
                  <input type="hidden" name="contractId" value={c.id} />
                  <Field label="Novo status" htmlFor="status"><Select id="status" name="status"><option value="ACTIVE">Ativo</option><option value="SUSPENDED">Suspenso</option><option value="TERMINATED">Encerrado</option></Select></Field>
                  <Field label="Motivo" htmlFor="sreason" required><Input id="sreason" name="reason" required minLength={5} /></Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
