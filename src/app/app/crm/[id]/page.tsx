import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { BUSINESS_TYPES, LEAD_SOURCES, getLead, listAssignableUsers, listStages } from "@/server/modules/leads/service";
import { addActivityAction, assignLeadAction, moveStageAction } from "@/app/actions/leads";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  CREATED: "Lead criado", NOTE: "Nota", STAGE_CHANGE: "Mudança de etapa", CALL: "Ligação", MEETING: "Reunião", EMAIL: "E-mail",
  DUPLICATE_SUBMISSION: "Novo envio do mesmo contato", ASSIGNMENT: "Responsável alterado",
};

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("lead:read");
  const { id } = await params;
  const lead = await getLead(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const canWrite = ctx.permissions.has("lead:write");
  const canAssign = ctx.permissions.has("lead:assign");
  const [stages, users] = await Promise.all([listStages(ctx), canAssign ? listAssignableUsers(ctx) : []]);

  const fields: [string, React.ReactNode][] = [
    ["Contato", lead.contactName],
    ["E-mail", <a key="e" href={`mailto:${lead.email}`} className="text-brand-700 underline">{lead.email}</a>],
    ["Telefone", lead.phone ?? "—"],
    ["Empresa", lead.companyName ?? "—"],
    ["Tipo", lead.businessType ? BUSINESS_TYPES[lead.businessType] : "—"],
    ["Local", lead.city ? `${lead.city}/${lead.state ?? ""}` : "—"],
    ["Modelo de interesse", lead.interestModel ?? "—"],
    ["Origem", LEAD_SOURCES[lead.source]],
    ["Campanha", lead.campaign ?? "—"],
    ["Consentimento LGPD", lead.consentAt ? `${dateTime(lead.consentAt)} (política ${lead.consentPolicyVer})` : "Não registrado (cadastro manual)"],
  ];

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/app/crm" className="text-navy-500 hover:text-navy-900">← CRM</Link></p>
      <PageHeader
        title={lead.companyName ?? lead.contactName}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={lead.stage.isWon ? "green" : lead.stage.isLost ? "red" : "tiffany"}>{lead.stage.name}</Badge> desde {dateTime(lead.stageChangedAt)} · responsável: {lead.assignee?.name ?? "não atribuído"}</span>}
        actions={<Link href={`/app/simulador?leadId=${lead.id}`} className="text-sm font-medium text-brand-700 hover:underline">Simular para este lead →</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Dados do lead" />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {fields.map(([k, v]) => <div key={k}><dt className="text-navy-500">{k}</dt><dd className="font-medium text-navy-900">{v}</dd></div>)}
              </dl>
              {lead.message && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-navy-50 p-3 text-sm text-navy-700">{lead.message}</p>}
              {lead.lostReason && <p className="mt-3 text-sm text-red-700">Motivo da perda: {lead.lostReason}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Histórico" description="Atividades e interações em ordem cronológica inversa." />
            <CardBody>
              <ol className="relative space-y-4 border-l border-navy-100 pl-5">
                {lead.activities.map((a) => {
                  const d = (a.data ?? {}) as Record<string, unknown>;
                  return (
                    <li key={a.id}>
                      <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-brand-500" aria-hidden />
                      <p className="text-sm font-medium text-navy-900">
                        {KIND_LABEL[a.kind] ?? a.kind}
                        {a.kind === "STAGE_CHANGE" && <span className="font-normal text-navy-500"> — {String(d.from)} → {String(d.to)}</span>}
                      </p>
                      <p className="text-xs text-navy-400">{dateTime(a.createdAt)}{a.author ? ` · ${a.author.name}` : ""}</p>
                      {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-navy-700">{a.body}</p>}
                    </li>
                  );
                })}
              </ol>
            </CardBody>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          {canWrite && (
            <Card>
              <CardHeader title="Etapa" />
              <CardBody>
                <ActionForm action={moveStageAction} submitLabel="Atualizar etapa">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Field label="Mover para" htmlFor="stageId">
                    <Select id="stageId" name="stageId" defaultValue={lead.stageId}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                  </Field>
                  <Field label="Motivo da perda" htmlFor="lostReason" hint="Obrigatório ao mover para 'Perdido'.">
                    <Input id="lostReason" name="lostReason" maxLength={500} />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canAssign && (
            <Card>
              <CardHeader title="Responsável comercial" />
              <CardBody>
                <ActionForm action={assignLeadAction} submitLabel="Atribuir" variant="secondary">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Select name="assigneeId" defaultValue={lead.assigneeId ?? ""} aria-label="Responsável">
                    <option value="">Não atribuído</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canWrite && (
            <Card>
              <CardHeader title="Registrar interação" />
              <CardBody>
                <ActionForm action={addActivityAction} submitLabel="Registrar">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Select name="kind" defaultValue="NOTE" aria-label="Tipo">
                    <option value="NOTE">Nota</option><option value="CALL">Ligação</option><option value="MEETING">Reunião</option><option value="EMAIL">E-mail</option>
                  </Select>
                  <Textarea name="body" required maxLength={4000} aria-label="Descrição" placeholder="O que foi tratado, próximos passos…" />
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
