import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { TRIGGER_LABEL, WO_STATUS_LABEL, listPlans, listWorkOrders, workOrderCost } from "@/server/modules/maintenance/service";
import { supportFormOptions } from "@/server/modules/support/tickets";
import { createPlanAction, createWorkOrderAction, togglePlanAction } from "@/app/actions/support";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { brl, dateTime, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ManutencaoPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requirePage("maintenance:read");
  const sp = await searchParams;
  const status = sp.status === "done" || sp.status === "all" ? sp.status : "active";
  const [orders, plans] = await Promise.all([listWorkOrders(ctx, { status }), listPlans(ctx)]);
  const canWrite = ctx.permissions.has("maintenance:write");
  const opts = canWrite ? await supportFormOptions(ctx) : null;
  return (
    <>
      <PageHeader title="Manutenção" description="Ordens de serviço corretivas e preventivas. A conclusão exige checklist completo e evidência; o custo vira despesa de manutenção da unidade." />
      <div className="mb-4 flex gap-3 text-sm">{(["active", "done", "all"] as const).map((s) => <Link key={s} href={`/app/manutencao?status=${s}`} className={s === status ? "font-semibold text-navy-900" : "text-brand-700 hover:underline"}>{{ active: "Em aberto", done: "Encerradas", all: "Todas" }[s]}</Link>)}</div>
      {orders.length === 0 ? <EmptyState title="Nenhuma ordem de serviço" /> : (
        <Card className="mb-6">
          <Table>
            <thead><tr><th>OS</th><th>Estação</th><th>Tipo</th><th>Status</th><th>Agendada</th><th className="text-right">Custo</th></tr></thead>
            <tbody>{orders.map((w) => <tr key={w.id}><td><Link className="font-medium text-brand-700 hover:underline" href={`/app/manutencao/os/${w.id}`}>{w.number}</Link><p className="text-navy-900">{w.title}</p>{w.ticket && <p className="text-xs text-navy-400">{w.ticket.number}</p>}</td><td className="text-xs">{w.station.ocppIdentity}<p>{w.station.site.name}</p></td><td>{w.type === "PREVENTIVE" ? "Preventiva" : "Corretiva"}</td><td><Badge tone={w.status === "COMPLETED" ? "green" : w.status === "CANCELLED" ? "neutral" : "amber"}>{WO_STATUS_LABEL[w.status]}</Badge></td><td className="text-xs">{w.scheduledFor ? dateTime(w.scheduledFor) : "—"}</td><td className="tabular text-right">{brl(workOrderCost(w).total)}</td></tr>)}</tbody>
          </Table>
        </Card>
      )}
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Planos de manutenção preventiva" description="Planos por uso só geram OS com telemetria confiável (estação de produção, comunicação estabelecida, sem sessões com comunicação perdida)." />
          {plans.length === 0 ? <CardBody><p className="text-sm text-navy-500">Nenhum plano.</p></CardBody> : (
            <Table>
              <thead><tr><th>Plano</th><th>Gatilho</th><th>Situação</th><th /></tr></thead>
              <tbody>{plans.map((p) => <tr key={p.id}><td>{p.name}<p className="text-xs text-navy-400">{p.station.ocppIdentity} · {p.station.environment}</p></td><td className="text-xs">{TRIGGER_LABEL[p.trigger]}: {p.intervalDays ?? p.intervalKwh ?? p.intervalSessions}</td><td className="text-xs">{p.workOrders.length ? <Link className="text-brand-700" href={`/app/manutencao/os/${p.workOrders[0].id}`}>{p.workOrders[0].number} em aberto</Link> : <>{p.due.reason}{p.due.progress !== null && ` (${pct(p.due.progress, 0)})`}</>}{!p.active && <Badge className="ml-1">inativo</Badge>}</td><td>{canWrite && <ActionForm action={togglePlanAction} submitLabel={p.active ? "Desativar" : "Ativar"} size="sm" variant="secondary"><input type="hidden" name="planId" value={p.id} /><input type="hidden" name="active" value={String(!p.active)} /></ActionForm>}</td></tr>)}</tbody>
            </Table>
          )}
          {opts && (
            <CardBody className="border-t border-navy-100">
              <ActionForm action={createPlanAction} submitLabel="Criar plano">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Estação" htmlFor="p-station" required><Select id="p-station" name="stationId" required>{opts.stations.map((s) => <option key={s.id} value={s.id}>{s.ocppIdentity} ({s.environment})</option>)}</Select></Field>
                  <Field label="Nome" htmlFor="p-name" required><Input id="p-name" name="name" required minLength={3} /></Field>
                  <Field label="Gatilho" htmlFor="p-trigger"><Select id="p-trigger" name="trigger">{Object.entries(TRIGGER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Dias" htmlFor="p-days"><Input id="p-days" name="intervalDays" type="number" min="1" /></Field>
                    <Field label="kWh" htmlFor="p-kwh"><Input id="p-kwh" name="intervalKwh" type="number" min="1" /></Field>
                    <Field label="Sessões" htmlFor="p-ses"><Input id="p-ses" name="intervalSessions" type="number" min="1" /></Field>
                  </div>
                </div>
                <Field label="Checklist (um item por linha)" htmlFor="p-check" required><Textarea id="p-check" name="checklist" required defaultValue={"Inspeção visual de cabos e conectores\nLimpeza\nReaperto de bornes\nTeste de recarga"} /></Field>
              </ActionForm>
            </CardBody>
          )}
        </Card>
        {opts && (
          <Card>
            <CardHeader title="Nova OS corretiva" />
            <CardBody>
              <ActionForm action={createWorkOrderAction} submitLabel="Abrir OS">
                <Field label="Estação" htmlFor="w-station" required><Select id="w-station" name="stationId" required>{opts.stations.map((s) => <option key={s.id} value={s.id}>{s.ocppIdentity} · {s.site.name}</option>)}</Select></Field>
                <Field label="Título" htmlFor="w-title" required><Input id="w-title" name="title" required minLength={3} /></Field>
                <Field label="Diagnóstico inicial" htmlFor="w-diag"><Textarea id="w-diag" name="diagnosis" /></Field>
                <Field label="Checklist (um item por linha)" htmlFor="w-check"><Textarea id="w-check" name="checklist" /></Field>
              </ActionForm>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
