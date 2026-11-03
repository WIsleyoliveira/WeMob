import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { LEAD_SOURCES, listLeads, listLeadsPage, listStages, pipelineSummary, STALE_LEAD_DAYS } from "@/server/modules/leads/service";
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { SegmentedLinks } from "@/components/ui/segmented";
import { PRIORITY_LABEL } from "@/server/modules/crm/details";
import { moveStageAction } from "@/app/actions/leads";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/app/action-form";
import { brl, date } from "@/lib/format";

export const dynamic = "force-dynamic";

type SP = { q?: string; stageId?: string; source?: string; view?: string; page?: string; sort?: string; dir?: string; assignee?: string };

export default async function CrmPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePage("lead:read");
  const sp = await searchParams;
  const view = sp.view === "lista" ? "lista" : "kanban";
  const mineOnly = sp.assignee === "me";
  const filter = { q: sp.q || undefined, stageId: sp.stageId || undefined, source: (sp.source || undefined) as keyof typeof LEAD_SOURCES | undefined, assigneeId: mineOnly ? ctx.userId : undefined };
  const [stages, leads, page, summary] = await Promise.all([
    listStages(ctx),
    view === "kanban" ? listLeads(ctx, filter) : Promise.resolve([]),
    view === "lista" ? listLeadsPage(ctx, { ...filter, page: sp.page, sort: sp.sort, dir: sp.dir }) : Promise.resolve(null),
    pipelineSummary(ctx),
  ]);
  const canExport = ctx.permissions.has("lead:export");
  const exportQs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]).toString();
  const sortLink = (col: string) => {
    const dir = page?.sort === col && page.dir === "desc" ? "asc" : "desc";
    return `/app/crm?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, x]) => x)), view: "lista", sort: col, dir, page: "1" })}`;
  };
  const pageLink = (n: number) => `/app/crm?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, x]) => x)), view: "lista", page: String(n) })}`;
  const sortMark = (col: string) => (page?.sort === col ? (page.dir === "desc" ? " ↓" : " ↑") : "");
  const canWrite = ctx.permissions.has("lead:write");
  const staleCutoff = Date.now() - STALE_LEAD_DAYS * 86400000;
  const isStale = (l: (typeof leads)[number]) => !l.stage.isWon && !l.stage.isLost && l.stageChangedAt.getTime() < staleCutoff;
  const qs = (v: string) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, x]) => x)), view: v }).toString();

  return (
    <>
      <PageHeader
        title="CRM comercial"
        description="Leads do site e cadastros manuais. Reenvios do mesmo contato são agrupados no lead existente."
        actions={
          <>
            {canExport && <a href={`/api/crm/leads-csv?${exportQs}`} className={buttonClass({ variant: "secondary" })}>Exportar CSV</a>}
            {canWrite && <ButtonLink href="/app/crm/novo">Novo lead</ButtonLink>}
          </>
        }
      />
      {summary && (
        <SummaryStrip
          label="Resumo do funil"
          items={[
            { label: "Leads em aberto", value: summary.open },
            { label: "Novos (30 dias)", value: summary.newLast30Days },
            { label: "Parados há mais de 7 dias", value: summary.stale, tone: summary.stale ? "warning" : "default", hint: "sem mudança de etapa" },
            { label: "Conversão", value: summary.conversionRate === null ? "—" : `${Math.round(summary.conversionRate * 1000) / 10}%`, hint: "ganhos ÷ encerrados" },
          ]}
        />
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SegmentedLinks
          label="Visualização"
          className="mb-0"
          items={(["kanban", "lista"] as const).map((v) => ({ href: `/app/crm?${qs(v)}`, label: v === "kanban" ? "Funil (quadro)" : "Lista", current: view === v }))}
        />
        {canWrite && <a href={`/app/crm?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([k, x]) => x && k !== "assignee")), ...(mineOnly ? {} : { assignee: "me" }) })}`} className="text-sm font-medium text-brand-700 hover:underline">{mineOnly ? "Ver de todos" : "Só os meus leads"}</a>}
      </div>
      <FilterBar action="/app/crm" hidden={{ view, assignee: sp.assignee }} clearHref={`/app/crm?view=${view}`} active={!!(sp.q || sp.stageId || sp.source)}>
        <FilterField label="Buscar" wide><SearchInput defaultValue={sp.q} placeholder="Nome, empresa, e-mail ou cidade" /></FilterField>
        <FilterField label="Etapa">
          <Select name="stageId" defaultValue={sp.stageId ?? ""}>
            <option value="">Todas as etapas</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Origem">
          <Select name="source" defaultValue={sp.source ?? ""}>
            <option value="">Todas as origens</option>
            {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </FilterField>
      </FilterBar>

      {(view === "kanban" ? leads.length === 0 : page?.total === 0) ? (
        <EmptyState title="Nenhum lead encontrado" description="Leads chegam pelo formulário de estudo de viabilidade do site ou podem ser cadastrados manualmente." action={canWrite && <ButtonLink href="/app/crm/novo">Cadastrar lead</ButtonLink>} />
      ) : view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.filter((s) => !filter.stageId || s.id === filter.stageId).map((s) => {
            const col = leads.filter((l) => l.stageId === s.id);
            return (
              <section key={s.id} className="flex w-72 shrink-0 flex-col rounded-xl bg-navy-50 p-2" aria-label={s.name}>
                <h2 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold text-navy-800">
                  {s.name} <span className="tabular rounded-full bg-white px-2 text-xs text-navy-500">{col.length}</span>
                </h2>
                <div className="flex flex-col gap-2">
                  {col.map((l) => (
                    <article key={l.id} className="rounded-lg border border-navy-100 bg-white p-3 shadow-sm">
                      <Link href={`/app/crm/${l.id}`} className="font-medium text-navy-900 hover:text-brand-700">{l.companyName ?? l.contactName}</Link>
                      <p className="text-xs text-navy-500">{l.contactName}{l.city ? ` · ${l.city}/${l.state ?? ""}` : ""}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge>{LEAD_SOURCES[l.source]}</Badge>
                        {isStale(l) && <Badge tone="amber">parado</Badge>}
                      </div>
                      {canWrite && !s.isLost && (
                        <ActionForm action={moveStageAction} submitLabel="Mover" size="sm" variant="secondary" className="mt-2 flex-row! items-start gap-2!">
                          <input type="hidden" name="leadId" value={l.id} />
                          <Select name="stageId" defaultValue={s.id} className="h-8 text-xs" aria-label="Mover para etapa">
                            {stages.filter((x) => !x.isLost).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </Select>
                        </ActionForm>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[var(--radius-card)] border border-navy-100 bg-white">
          <Table>
            <thead><tr>
              <th><Link href={sortLink("contactName")}>Lead{sortMark("contactName")}</Link></th><th>Local</th><th>Origem</th><th>Etapa</th>
              <th><Link href={sortLink("priority")}>Prioridade{sortMark("priority")}</Link></th>
              <th className="text-right"><Link href={sortLink("estimatedValue")}>Valor est.{sortMark("estimatedValue")}</Link></th>
              <th><Link href={sortLink("expectedCloseDate")}>Previsão{sortMark("expectedCloseDate")}</Link></th>
              <th>Responsável</th><th><Link href={sortLink("createdAt")}>Criado{sortMark("createdAt")}</Link></th>
            </tr></thead>
            <tbody>
              {page!.items.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/app/crm/${l.id}`} className="font-medium text-navy-900 hover:text-brand-700">{l.companyName ?? l.contactName}</Link><p className="text-xs text-navy-500">{l.email}</p></td>
                  <td>{l.city ? `${l.city}/${l.state ?? ""}` : "—"}</td>
                  <td className="text-xs">{LEAD_SOURCES[l.source]}</td>
                  <td><Badge tone={l.stage.isWon ? "green" : l.stage.isLost ? "red" : "neutral"}>{l.stage.name}</Badge> {isStale(l) && <Badge tone="amber">parado</Badge>}</td>
                  <td><Badge tone={l.priority === "HIGH" ? "red" : l.priority === "LOW" ? "neutral" : "amber"}>{PRIORITY_LABEL[l.priority]}</Badge></td>
                  <td className="tabular text-right">{l.estimatedValue ? brl(l.estimatedValue.toString()) : "—"}</td>
                  <td className="tabular text-xs">{l.expectedCloseDate ? date(l.expectedCloseDate) : "—"}</td>
                  <td>{l.assignee?.name ?? <span className="text-navy-400">—</span>}</td>
                  <td className="tabular text-xs">{date(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-100 px-4 py-3 text-sm text-navy-500">
            <span>{page!.total} leads · página {page!.page} de {page!.pages}</span>
            <span className="flex gap-2">
              {page!.page > 1 && <Link className={buttonClass({ variant: "secondary", size: "sm" })} href={pageLink(page!.page - 1)}>← Anterior</Link>}
              {page!.page < page!.pages && <Link className={buttonClass({ variant: "secondary", size: "sm" })} href={pageLink(page!.page + 1)}>Próxima →</Link>}
            </span>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-navy-400">Para marcar como perdido, abra o lead e informe o motivo da perda.</p>
    </>
  );
}
