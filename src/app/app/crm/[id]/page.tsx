import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { BUSINESS_TYPES, LEAD_SOURCES, getLead, listAssignableUsers, listStages } from "@/server/modules/leads/service";
import { addActivityAction, assignLeadAction, moveStageAction } from "@/app/actions/leads";
import { completeTaskAction, convertLeadAction, createTaskAction, linkCompanyAction, updateLeadDetailsAction } from "@/app/actions/crm";
import { PRIORITY_LABEL } from "@/server/modules/crm/details";
import { listLeadTasks } from "@/server/modules/crm/tasks";
import { listProposals, PROPOSAL_STATUS_LABEL } from "@/server/modules/crm/proposals";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { brl, date, dateTime } from "@/lib/format";

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
  const [stages, users, tasks, proposals] = await Promise.all([
    listStages(ctx),
    canAssign ? listAssignableUsers(ctx) : [],
    listLeadTasks(ctx, lead.id),
    listProposals(ctx, { leadId: lead.id }),
  ]);
  const company = lead.company;
  const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const now = Date.now();

  const fields: [string, React.ReactNode][] = [
    ["Contato", lead.contactName],
    ["E-mail", <a key="e" href={`mailto:${lead.email}`} className="text-brand-700 underline">{lead.email}</a>],
    ["Telefone", lead.phone ?? "—"],
    ["Empresa", lead.companyName ?? "—"],
    ["Tipo", lead.businessType ? BUSINESS_TYPES[lead.businessType] : "—"],
    ["Local", lead.city ? `${lead.city}/${lead.state ?? ""}` : "—"],
    ["Modelo de interesse", lead.interestModel ?? "—"],
    ["Prioridade", PRIORITY_LABEL[lead.priority]],
    ["Valor estimado", lead.estimatedValue ? brl(lead.estimatedValue.toString()) : "—"],
    ["Previsão de fechamento", lead.expectedCloseDate ? date(lead.expectedCloseDate) : "—"],
    ["Próximo passo", lead.nextStep ?? "—"],
    ["Empresa vinculada", company ? <Link key="c" href={`/app/crm/empresas/${company.id}`} className="text-brand-700 underline">{company.name}</Link> : "—"],
    ["Origem", LEAD_SOURCES[lead.source]],
    ["Campanha", lead.campaign ?? "—"],
    ["Consentimento LGPD", lead.consentAt ? `${dateTime(lead.consentAt)} (política ${lead.consentPolicyVer})` : "Não registrado (cadastro manual)"],
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "CRM", href: "/app/crm" }, { label: lead.companyName ?? lead.contactName }]}
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
            <CardHeader title="Tarefas e lembretes" />
            <CardBody className="flex flex-col gap-4">
              {tasks.length === 0 ? <p className="text-sm text-navy-500">Nenhuma tarefa.</p> : (
                <ul className="divide-y divide-navy-50">
                  {tasks.map((t) => {
                    const overdue = !t.completedAt && t.dueAt.getTime() < now;
                    return (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span className={t.completedAt ? "text-navy-400 line-through" : "text-navy-900"}>
                          {t.title} <span className="text-xs text-navy-500">· {dateTime(t.dueAt)} · {t.assignee?.name ?? "—"}</span>
                          {overdue && <Badge tone="red" className="ml-2">atrasada</Badge>}
                        </span>
                        {!t.completedAt && canWrite && (
                          <ActionForm action={completeTaskAction} submitLabel="Concluir" size="sm" variant="secondary"><input type="hidden" name="taskId" value={t.id} /></ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {canWrite && (
                <ActionForm action={createTaskAction} submitLabel="Adicionar tarefa" variant="secondary" size="sm">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                    <Field label="Tarefa" htmlFor="task-title"><Input id="task-title" name="title" required minLength={3} placeholder="Ex.: Agendar visita técnica" /></Field>
                    <Field label="Vencimento" htmlFor="task-due"><Input id="task-due" name="dueAt" type="datetime-local" required /></Field>
                  </div>
                </ActionForm>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Propostas" actions={canWrite && <ButtonLink href={`/app/crm/propostas/nova?leadId=${lead.id}`} size="sm">Nova proposta</ButtonLink>} />
            <CardBody>
              {proposals.length === 0 ? <p className="text-sm text-navy-500">Nenhuma proposta.</p> : (
                <ul className="divide-y divide-navy-50 text-sm">
                  {proposals.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <Link href={`/app/crm/propostas/${p.id}`} className="font-medium text-navy-900 hover:text-brand-700">{p.number} — {p.title}</Link>
                      <span className="flex items-center gap-2"><span className="tabular">{brl(p.versions[0]?.total.toString())}</span><Badge>{PROPOSAL_STATUS_LABEL[p.status]}</Badge></span>
                    </li>
                  ))}
                </ul>
              )}
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
              <CardHeader title="Qualificação comercial" />
              <CardBody>
                <ActionForm action={updateLeadDetailsAction} submitLabel="Salvar qualificação" variant="secondary">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Field label="Prioridade" htmlFor="priority">
                    <Select id="priority" name="priority" defaultValue={lead.priority}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  </Field>
                  <Field label="Valor estimado (R$)" htmlFor="estimatedValue" hint="Base da previsão de receita ponderada.">
                    <Input id="estimatedValue" name="estimatedValue" inputMode="decimal" defaultValue={lead.estimatedValue?.toString() ?? ""} />
                  </Field>
                  <Field label="Previsão de fechamento" htmlFor="expectedCloseDate"><Input id="expectedCloseDate" name="expectedCloseDate" type="date" defaultValue={isoDate(lead.expectedCloseDate)} /></Field>
                  <Field label="Próximo passo" htmlFor="nextStep"><Input id="nextStep" name="nextStep" maxLength={300} defaultValue={lead.nextStep ?? ""} /></Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canWrite && (
            <Card>
              <CardHeader title="Empresa e conversão" description={company?.convertedOrganization ? `Convertida em organização: ${company.convertedOrganization.name}` : undefined} />
              <CardBody className="flex flex-col gap-4">
                <ActionForm action={linkCompanyAction} submitLabel={company ? "Atualizar vínculo" : "Vincular empresa"} variant="secondary">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Field label="Nome da empresa" htmlFor="company-name"><Input id="company-name" name="name" required defaultValue={company?.name ?? lead.companyName ?? ""} /></Field>
                  <Field label="CNPJ/CPF" htmlFor="company-doc" hint="Evita duplicidade entre empresas."><Input id="company-doc" name="document" inputMode="numeric" defaultValue={company?.document ?? ""} /></Field>
                </ActionForm>
                {lead.stage.isWon && company && !company.convertedOrganization && (
                  <ActionForm action={convertLeadAction} submitLabel="Converter em organização" confirm="Criar (ou reaproveitar) a organização parceira/investidora desta empresa?">
                    <input type="hidden" name="leadId" value={lead.id} />
                    <Select name="kind" defaultValue="PARTNER" aria-label="Tipo de organização"><option value="PARTNER">Parceiro (50/50)</option><option value="INVESTOR">Investidor (compra integral)</option></Select>
                  </ActionForm>
                )}
                {!lead.stage.isWon && <p className="text-xs text-navy-500">A conversão em organização fica disponível quando o lead estiver na etapa de ganho.</p>}
              </CardBody>
            </Card>
          )}
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
