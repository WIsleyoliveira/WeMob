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
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { SegmentedLinks } from "@/components/ui/segmented";
import { hrefWith } from "@/lib/query";
import Decimal from "decimal.js";

export const dynamic = "force-dynamic";
const norm = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default async function ManutencaoPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; tipo?: string }> }) {
  const ctx = await requirePage("maintenance:read");
  const sp = await searchParams;
  const status = sp.status === "done" || sp.status === "all" ? sp.status : "active";
  const [all, active, plans] = await Promise.all([listWorkOrders(ctx, { status: "all" }), listWorkOrders(ctx, { status: "active" }), listPlans(ctx)]);
  const activeIds = new Set(active.map((w) => w.id));
  const byStatus = all.filter((w) => (status === "all" ? true : status === "active" ? activeIds.has(w.id) : !activeIds.has(w.id)));
  const orders = byStatus.filter((w) => (!sp.tipo || w.type === sp.tipo) && (!sp.q || norm(`${w.number} ${w.title} ${w.station.ocppIdentity} ${w.station.site.name}`).includes(norm(sp.q))));
  const monthStart = new Date(new Date().toISOString().slice(0, 7) + "-01T00:00:00-03:00");
  const doneThisMonth = all.filter((w) => w.status === "COMPLETED" && w.completedAt && w.completedAt >= monthStart);
  const costThisMonth = doneThisMonth.reduce((a, w) => a.plus(workOrderCost(w).total), new Decimal(0)).toFixed(2);
  const tabHref = (st: string) => hrefWith("/app/manutencao", { q: sp.q, tipo: sp.tipo }, { status: st === "active" ? null : st });
  const canWrite = ctx.permissions.has("maintenance:write");
  const opts = canWrite ? await supportFormOptions(ctx) : null;
  return (
    <>
      <PageHeader title="Manutenção" description="Ordens de serviço corretivas e preventivas. A conclusão exige checklist completo e evidência; o custo vira despesa de manutenção da unidade." />
      <SummaryStrip
        label="Resumo da manutenção"
        items={[
          { label: "Em aberto", value: active.length, tone: active.length ? "warning" : "default", href: tabHref("active"), current: status === "active" && !sp.q && !sp.tipo },
          { label: "Em execução", value: active.filter((w) => w.status === "IN_PROGRESS").length },
          { label: "Agendadas", value: active.filter((w) => w.status === "SCHEDULED").length },
          { label: "Concluídas no mês", value: doneThisMonth.length, hint: `custo ${brl(costThisMonth)}` },
          { label: "Planos preventivos ativos", value: plans.filter((p) => p.active).length },
        ]}
      />
      {opts && (
        <details className="group mb-5 rounded-[var(--radius-card)] border border-navy-100 bg-white" id="nova-os">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-medium text-navy-900 [&::-webkit-details-marker]:hidden">
            <span>+ Nova OS corretiva</span><span className="text-xs font-normal text-navy-500">registre um defeito e o técnico responsável</span>
          </summary>
          <div className="border-t border-navy-100 p-5">
            <ActionForm action={createWorkOrderAction} submitLabel="Abrir OS">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Estação" htmlFor="w-station" required><Select id="w-station" name="stationId" required>{opts.stations.map((s) => <option key={s.id} value={s.id}>{s.ocppIdentity} · {s.site.name}</option>)}</Select></Field>
                <Field label="Título" htmlFor="w-title" required><Input id="w-title" name="title" required minLength={3} placeholder="Ex.: conector 2 não trava o cabo" /></Field>
                <Field label="Diagnóstico inicial" htmlFor="w-diag"><Textarea id="w-diag" name="diagnosis" /></Field>
                <Field label="Checklist (um item por linha)" htmlFor="w-check" hint="A conclusão exige todos os itens marcados."><Textarea id="w-check" name="checklist" /></Field>
              </div>
            </ActionForm>
          </div>
        </details>
      )}
      <SegmentedLinks label="Situação das ordens de serviço" items={[{ k: "active", l: "Em aberto", n: active.length }, { k: "done", l: "Encerradas", n: all.length - active.length }, { k: "all", l: "Todas", n: all.length }].map((t) => ({ href: tabHref(t.k), label: t.l, current: status === t.k, count: t.n }))} />
      <FilterBar action="/app/manutencao" hidden={{ status: status === "active" ? undefined : status }} clearHref={tabHref(status)} active={!!(sp.q || sp.tipo)}>
        <FilterField label="Buscar" wide><SearchInput defaultValue={sp.q} placeholder="Número, título, estação ou unidade" /></FilterField>
        <FilterField label="Tipo"><Select name="tipo" defaultValue={sp.tipo ?? ""}><option value="">Todos</option><option value="CORRECTIVE">Corretiva</option><option value="PREVENTIVE">Preventiva</option></Select></FilterField>
      </FilterBar>
      {orders.length === 0 ? <EmptyState title={all.length === 0 ? "Nenhuma ordem de serviço" : "Nenhuma OS com esses filtros"} description={all.length === 0 ? "Abra uma OS corretiva acima ou crie um plano preventivo." : "Troque a situação ou limpe os filtros."} /> : (
        <Card className="mb-6">
          <Table aria-label="Ordens de serviço">
            <thead><tr><th>OS</th><th className="hidden md:table-cell">Estação</th><th className="hidden sm:table-cell">Tipo</th><th>Situação</th><th className="hidden lg:table-cell">Agendada</th><th className="text-right">Custo</th></tr></thead>
            <tbody>{orders.map((w) => <tr key={w.id}><td><Link className="font-medium text-brand-700 hover:underline" href={`/app/manutencao/os/${w.id}`}>{w.number}</Link><p className="text-navy-900">{w.title}</p>{w.ticket && <p className="text-xs text-navy-400">{w.ticket.number}</p>}</td><td className="hidden text-xs md:table-cell">{w.station.ocppIdentity}<p>{w.station.site.name}</p></td><td className="hidden sm:table-cell">{w.type === "PREVENTIVE" ? "Preventiva" : "Corretiva"}</td><td><Badge tone={w.status === "COMPLETED" ? "green" : w.status === "CANCELLED" ? "neutral" : w.status === "IN_PROGRESS" ? "tiffany" : "amber"}>{WO_STATUS_LABEL[w.status]}</Badge></td><td className="hidden text-xs lg:table-cell">{w.scheduledFor ? dateTime(w.scheduledFor) : "—"}</td><td className="tabular text-right">{brl(workOrderCost(w).total)}</td></tr>)}</tbody>
          </Table>
        </Card>
      )}
      <div className="grid gap-6 [&>*]:min-w-0">
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
              <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-700">+ Novo plano preventivo</summary>
              <div className="mt-4">
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
              </div>
              </details>
            </CardBody>
          )}
        </Card>

      </div>
    </>
  );
}
