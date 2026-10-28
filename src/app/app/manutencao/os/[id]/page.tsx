import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { WO_STATUS_LABEL, getWorkOrder } from "@/server/modules/maintenance/service";
import { listAttachments } from "@/server/modules/attachments/service";
import { addPartAction, cancelWorkOrderAction, checklistAction, completeWorkOrderAction, updateWorkOrderAction } from "@/app/actions/support";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { Attachments } from "@/components/app/attachments";
import { brl, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("maintenance:read");
  const wo = await getWorkOrder(ctx, (await params).id).catch(() => notFound());
  const files = await listAttachments(ctx, "WorkOrder", wo.id);
  const active = ["OPEN", "SCHEDULED", "IN_PROGRESS"].includes(wo.status);
  const canWrite = ctx.permissions.has("maintenance:write") && active;
  const toLocal = (d: Date | null) => (d ? new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 16) : undefined);
  return (
    <>
      <PageHeader
        title={`${wo.number} · ${wo.title}`}
        breadcrumbs={[{ label: "Manutenção", href: "/app/manutencao" }, { label: wo.number }]}
        description={<>{wo.type === "PREVENTIVE" ? `Preventiva${wo.plan ? ` (${wo.plan.name})` : ""}` : "Corretiva"} · <Link className="underline" href={`/app/estacoes/${wo.station.id}`}>{wo.station.ocppIdentity}</Link> · {wo.station.site.name}{wo.ticket && <> · <Link className="underline" href={`/app/suporte/${wo.ticket.id}`}>{wo.ticket.number}</Link></>}</>}
        actions={<Badge tone={wo.status === "COMPLETED" ? "green" : active ? "amber" : "neutral"}>{WO_STATUS_LABEL[wo.status]}</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Execução" description={`Criada ${dateTime(wo.createdAt)}${wo.startedAt ? ` · iniciada ${dateTime(wo.startedAt)}` : ""}${wo.completedAt ? ` · concluída ${dateTime(wo.completedAt)}` : ""}`} />
            <CardBody>
              {canWrite ? (
                <ActionForm action={updateWorkOrderAction} submitLabel="Salvar">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Status" htmlFor="status"><Select id="status" name="status" defaultValue={wo.status}><option value="OPEN">Aberta</option><option value="SCHEDULED">Agendada</option><option value="IN_PROGRESS">Em execução</option></Select></Field>
                    <Field label="Agendamento" htmlFor="scheduledFor"><Input id="scheduledFor" name="scheduledFor" type="datetime-local" defaultValue={toLocal(wo.scheduledFor)} /></Field>
                    <Field label="Técnico" htmlFor="technicianName"><Input id="technicianName" name="technicianName" defaultValue={wo.technicianName ?? ""} /></Field>
                  </div>
                  <Field label="Diagnóstico" htmlFor="diagnosis"><Textarea id="diagnosis" name="diagnosis" defaultValue={wo.diagnosis ?? ""} /></Field>
                </ActionForm>
              ) : (
                <dl className="space-y-2 text-sm"><div><dt className="text-xs text-navy-500">Técnico</dt><dd>{wo.technicianName ?? "—"}</dd></div><div><dt className="text-xs text-navy-500">Diagnóstico</dt><dd className="whitespace-pre-wrap">{wo.diagnosis ?? "—"}</dd></div><div><dt className="text-xs text-navy-500">Conclusão</dt><dd className="whitespace-pre-wrap">{wo.completionNotes ?? "—"}</dd></div></dl>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Checklist" description={`${wo.checklist.filter((i) => i.done).length} de ${wo.checklist.length} concluído(s)`} />
            <CardBody>
              {canWrite ? (
                <ActionForm action={checklistAction} submitLabel="Salvar checklist" size="sm">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  {wo.checklist.map((i, idx) => <label key={idx} className="flex items-center gap-2 text-sm"><input type="hidden" name="item" value={i.item} /><input type="checkbox" name={`done_${idx}`} defaultChecked={i.done} /> {i.item}</label>)}
                  <Textarea name="newItems" placeholder="Adicionar itens (um por linha)" aria-label="Novos itens do checklist" />
                </ActionForm>
              ) : <ul className="space-y-1 text-sm">{wo.checklist.map((i, idx) => <li key={idx}>{i.done ? "☑" : "☐"} {i.item}</li>)}</ul>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Peças e custos" description={`Peças ${brl(wo.cost.parts)} + mão de obra ${brl(wo.cost.labor)} = ${brl(wo.cost.total)}`} />
            {wo.parts.length > 0 && <Table><thead><tr><th>Peça</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead><tbody>{wo.parts.map((p) => <tr key={p.id}><td>{p.description}</td><td className="tabular text-right">{p.quantity.toString()}</td><td className="tabular text-right">{brl(p.unitCost.toString())}</td><td className="tabular text-right">{brl(p.total.toString())}</td></tr>)}</tbody></Table>}
            {canWrite && (
              <CardBody className="border-t border-navy-100">
                <ActionForm action={addPartAction} submitLabel="Adicionar peça" size="sm" variant="secondary">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <div className="grid gap-2 sm:grid-cols-3"><Input name="description" placeholder="Descrição" aria-label="Descrição da peça" required minLength={2} /><Input name="quantity" type="number" step="0.01" min="0.01" placeholder="Qtd." aria-label="Quantidade" required /><Input name="unitCost" type="number" step="0.01" min="0" placeholder="Custo unitário (R$)" aria-label="Custo unitário" required /></div>
                </ActionForm>
              </CardBody>
            )}
            {wo.entry && <CardBody className="border-t border-navy-100 text-sm">Despesa lançada: {brl(wo.entry.amount.toString())} · competência {wo.entry.competence} · <Link className="text-brand-700 hover:underline" href={`/app/financeiro/lancamentos?competencia=${wo.entry.competence}`}>ver no financeiro</Link></CardBody>}
          </Card>
        </div>
        <div className="space-y-6">
          <Attachments title="Evidências" entityType="WorkOrder" entityId={wo.id} items={files} canUpload={canWrite} />
          {canWrite && (
            <Card>
              <CardHeader title="Concluir" description="Exige checklist completo e ao menos uma evidência. O custo total vira despesa a pagar." />
              <CardBody className="space-y-6">
                <ActionForm action={completeWorkOrderAction} submitLabel="Concluir OS" confirm="Concluir esta ordem de serviço? O custo será lançado como despesa de manutenção.">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <Field label="Mão de obra (R$)" htmlFor="laborCost"><Input id="laborCost" name="laborCost" type="number" step="0.01" min="0" defaultValue={wo.laborCost.toString()} /></Field>
                  <Field label="Serviço executado" htmlFor="completionNotes" required><Textarea id="completionNotes" name="completionNotes" required minLength={10} /></Field>
                </ActionForm>
                <ActionForm action={cancelWorkOrderAction} submitLabel="Cancelar OS" variant="danger" size="sm" confirm="Cancelar esta ordem de serviço?">
                  <input type="hidden" name="workOrderId" value={wo.id} />
                  <Input name="reason" placeholder="Motivo" aria-label="Motivo do cancelamento" required minLength={5} />
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
