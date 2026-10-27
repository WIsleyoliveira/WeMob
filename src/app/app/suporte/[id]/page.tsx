import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { ORIGIN_LABEL, PRIORITY_LABEL, TICKET_CATEGORY_LABEL, TICKET_STATUS_LABEL, TICKET_TRANSITIONS, getTicket, supportFormOptions } from "@/server/modules/support/tickets";
import { listAttachments } from "@/server/modules/attachments/service";
import { createWorkOrderAction, ticketAssignAction, ticketCommentAction, ticketPriorityAction, ticketStatusAction } from "@/app/actions/support";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { Attachments } from "@/components/app/attachments";
import { dateTime } from "@/lib/format";
import { SlaBadge } from "../sla-badge";

export const dynamic = "force-dynamic";

const EVENT_LABEL = { CREATED: "Abertura", COMMENT: "Comentário", STATUS_CHANGE: "Status", ASSIGNMENT: "Responsável", PRIORITY_CHANGE: "Prioridade", PAUSE: "SLA pausado", RESUME: "SLA retomado", WORK_ORDER: "Ordem de serviço", ATTACHMENT: "Anexo", ALERT: "Alerta" } as const;

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("support:read");
  const t = await getTicket(ctx, (await params).id);
  const [files, opts] = await Promise.all([listAttachments(ctx, "Ticket", t.id), supportFormOptions(ctx)]);
  const canWrite = ctx.permissions.has("support:write");
  const next = TICKET_TRANSITIONS[t.status];
  return (
    <>
      <PageHeader
        title={`${t.number} · ${t.title}`}
        breadcrumbs={[{ label: "Suporte", href: "/app/suporte" }, { label: t.number }]}
        description={<>{TICKET_CATEGORY_LABEL[t.category]} · origem {ORIGIN_LABEL[t.origin]} · aberto {dateTime(t.createdAt)}{t.station && <> · <Link className="underline" href={`/app/estacoes/${t.station.id}`}>{t.station.ocppIdentity}</Link></>}{t.site && <> · {t.site.name}</>}</>}
        actions={<><Badge tone={t.priority === "CRITICAL" ? "red" : t.priority === "HIGH" ? "amber" : "neutral"}>{PRIORITY_LABEL[t.priority]}</Badge><Badge>{TICKET_STATUS_LABEL[t.status]}</Badge></>}
      />
      <div className="mb-6 flex flex-wrap gap-2"><SlaBadge label="1ª resposta" s={t.sla.response} /><SlaBadge label="Solução" s={t.sla.resolution} />
        <span className="text-xs text-navy-500">Calendário: {t.sla.calendar.businessHoursOnly ? `dias ${t.sla.calendar.workDays.join(",")} das ${t.sla.calendar.workStartHour}h às ${t.sla.calendar.workEndHour}h (America/Belem)` : "24×7"} · {t.sla.pauses.length} pausa(s) descontada(s) · feriados não considerados</span>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Descrição" />
            <CardBody><p className="whitespace-pre-wrap text-sm text-navy-800">{t.description}</p></CardBody>
          </Card>
          <Card>
            <CardHeader title="Histórico" />
            <CardBody>
              <ol className="space-y-3 text-sm">
                {t.events.map((e) => (
                  <li key={e.id} className="border-l-2 border-navy-100 pl-3">
                    <p className="text-xs text-navy-400">{dateTime(e.createdAt)} · {EVENT_LABEL[e.kind]} · {e.authorId ? t.authorNames[e.authorId] ?? "—" : "sistema"}</p>
                    {e.kind === "STATUS_CHANGE" && e.data && <p className="text-navy-700">{TICKET_STATUS_LABEL[(e.data as { from: keyof typeof TICKET_STATUS_LABEL }).from]} → {TICKET_STATUS_LABEL[(e.data as { to: keyof typeof TICKET_STATUS_LABEL }).to]}</p>}
                    {e.body && <p className="whitespace-pre-wrap text-navy-800">{e.body}</p>}
                  </li>
                ))}
              </ol>
              {canWrite && !["CLOSED", "CANCELLED"].includes(t.status) && (
                <ActionForm action={ticketCommentAction} submitLabel="Comentar" size="sm" className="mt-4">
                  <input type="hidden" name="ticketId" value={t.id} />
                  <Textarea name="body" aria-label="Comentário" required minLength={2} />
                </ActionForm>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          {canWrite && next.length > 0 && (
            <Card>
              <CardHeader title="Atualizar status" description="Pausas, solução, cancelamento e reabertura exigem motivo." />
              <CardBody>
                <ActionForm action={ticketStatusAction} submitLabel="Aplicar" size="sm">
                  <input type="hidden" name="ticketId" value={t.id} />
                  <Select name="status" aria-label="Novo status">{next.map((s) => <option key={s} value={s}>{TICKET_STATUS_LABEL[s]}</option>)}</Select>
                  <Input name="reason" placeholder="Motivo / solução" aria-label="Motivo ou solução" />
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canWrite && (
            <Card>
              <CardHeader title="Responsável e prioridade" />
              <CardBody className="space-y-4">
                <ActionForm action={ticketAssignAction} submitLabel="Atribuir" size="sm" variant="secondary">
                  <input type="hidden" name="ticketId" value={t.id} />
                  <Select name="assigneeId" defaultValue={t.assignee?.id ?? ""} aria-label="Responsável"><option value="">— sem responsável —</option>{opts.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</Select>
                </ActionForm>
                <ActionForm action={ticketPriorityAction} submitLabel="Mudar prioridade" size="sm" variant="secondary">
                  <input type="hidden" name="ticketId" value={t.id} />
                  <Select name="priority" defaultValue={t.priority} aria-label="Prioridade">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                  <Input name="reason" placeholder="Motivo (recalcula prazos)" aria-label="Motivo da mudança" required minLength={5} />
                </ActionForm>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Ordens de serviço" />
            <CardBody className="space-y-3">
              {t.workOrders.length === 0 ? <p className="text-sm text-navy-500">Nenhuma.</p> : t.workOrders.map((w) => <p key={w.id} className="text-sm"><Link className="text-brand-700 hover:underline" href={`/app/manutencao/os/${w.id}`}>{w.number}</Link> · {w.title} <Badge>{w.status}</Badge></p>)}
              {ctx.permissions.has("maintenance:write") && t.station && !["CLOSED", "CANCELLED"].includes(t.status) && (
                <ActionForm action={createWorkOrderAction} submitLabel="Abrir OS" size="sm" variant="secondary">
                  <input type="hidden" name="ticketId" value={t.id} /><input type="hidden" name="stationId" value={t.station.id} />
                  <Field label="Título da OS" htmlFor="wo-title"><Input id="wo-title" name="title" defaultValue={t.title} required /></Field>
                  <Field label="Checklist (um item por linha)" htmlFor="wo-check"><Textarea id="wo-check" name="checklist" defaultValue={"Diagnóstico no local\nCorreção\nTeste funcional com veículo"} /></Field>
                </ActionForm>
              )}
            </CardBody>
          </Card>
          {t.alert && <Card><CardBody className="text-sm">Originado do alerta <Link className="text-brand-700 hover:underline" href="/app/alertas">{t.alert.title}</Link> ({t.alert.status}).</CardBody></Card>}
          <Attachments entityType="Ticket" entityId={t.id} items={files} canUpload={canWrite} />
        </div>
      </div>
    </>
  );
}
