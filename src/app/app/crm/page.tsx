import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { LEAD_SOURCES, listLeads, listStages, STALE_LEAD_DAYS } from "@/server/modules/leads/service";
import { moveStageAction } from "@/app/actions/leads";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/app/action-form";
import { date } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

type SP = { q?: string; stageId?: string; source?: string; view?: string };

export default async function CrmPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePage("lead:read");
  const sp = await searchParams;
  const view = sp.view === "lista" ? "lista" : "kanban";
  const filter = { q: sp.q || undefined, stageId: sp.stageId || undefined, source: (sp.source || undefined) as keyof typeof LEAD_SOURCES | undefined };
  const [stages, leads] = await Promise.all([listStages(ctx), listLeads(ctx, filter)]);
  const canWrite = ctx.permissions.has("lead:write");
  const staleCutoff = Date.now() - STALE_LEAD_DAYS * 86400000;
  const isStale = (l: (typeof leads)[number]) => !l.stage.isWon && !l.stage.isLost && l.stageChangedAt.getTime() < staleCutoff;
  const qs = (v: string) => new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, x]) => x)), view: v }).toString();

  return (
    <>
      <PageHeader
        title="CRM comercial"
        description="Leads do site e cadastros manuais. Reenvios do mesmo contato são agrupados no lead existente."
        actions={canWrite && <ButtonLink href="/app/crm/novo">Novo lead</ButtonLink>}
      />
      <form className="mb-5 flex flex-wrap items-center gap-2" method="get">
        <input type="hidden" name="view" value={view} />
        <Input name="q" defaultValue={sp.q} placeholder="Buscar nome, empresa, e-mail, cidade" className="w-72" aria-label="Buscar" />
        <Select name="stageId" defaultValue={sp.stageId ?? ""} className="w-48" aria-label="Etapa">
          <option value="">Todas as etapas</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select name="source" defaultValue={sp.source ?? ""} className="w-56" aria-label="Origem">
          <option value="">Todas as origens</option>
          {Object.entries(LEAD_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <button className={buttonClass({ variant: "secondary" })}>Filtrar</button>
        <div className="ml-auto inline-flex rounded-lg border border-navy-200 bg-white p-0.5 text-sm">
          {(["kanban", "lista"] as const).map((v) => (
            <Link key={v} href={`/app/crm?${qs(v)}`} aria-current={view === v ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 capitalize", view === v ? "bg-navy-900 text-white" : "text-navy-600")}>{v}</Link>
          ))}
        </div>
      </form>

      {leads.length === 0 ? (
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
            <thead><tr><th>Lead</th><th>Local</th><th>Origem</th><th>Etapa</th><th>Responsável</th><th>Criado</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td><Link href={`/app/crm/${l.id}`} className="font-medium text-navy-900 hover:text-brand-700">{l.companyName ?? l.contactName}</Link><p className="text-xs text-navy-500">{l.email}</p></td>
                  <td>{l.city ? `${l.city}/${l.state ?? ""}` : "—"}</td>
                  <td className="text-xs">{LEAD_SOURCES[l.source]}</td>
                  <td><Badge tone={l.stage.isWon ? "green" : l.stage.isLost ? "red" : "neutral"}>{l.stage.name}</Badge> {isStale(l) && <Badge tone="amber">parado</Badge>}</td>
                  <td>{l.assignee?.name ?? <span className="text-navy-400">—</span>}</td>
                  <td className="tabular text-xs">{date(l.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-xs text-navy-400">Para marcar como perdido, abra o lead e informe o motivo da perda.</p>
    </>
  );
}
