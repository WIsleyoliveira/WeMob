import { requirePage } from "@/server/auth/current";
import { listAuditEvents } from "@/server/modules/audit/service";
import { AREA_LIST, auditArea, auditLabel, entityLabel } from "@/domain/audit/labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";
import { Pagination } from "@/components/ui/pagination";
import { dateTime } from "@/lib/format";
import { hrefWith, pageParam, param } from "@/lib/query";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePage("audit:read");
  const sp = await searchParams;
  const area = param(sp, "area");
  const r = await listAuditEvents(ctx, {
    area: area && AREA_LIST.includes(area) ? area : undefined,
    actor: param(sp, "autor") || undefined,
    q: param(sp, "q") || undefined,
    from: param(sp, "de") || undefined,
    to: param(sp, "ate") || undefined,
    page: pageParam(param(sp, "page")),
  });
  const active = ["area", "autor", "q", "de", "ate"].some((k) => param(sp, k));
  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê, e quando, nesta organização. Os registros não podem ser editados nem apagados pela interface." />
      <FilterBar action="/app/auditoria" clearHref="/app/auditoria" active={active}>
        <FilterField label="Buscar" wide><SearchInput defaultValue={param(sp, "q")} placeholder="Código da ação, entidade ou ID" /></FilterField>
        <FilterField label="Área">
          <Select name="area" defaultValue={area ?? ""}><option value="">Todas</option>{AREA_LIST.map((a) => <option key={a} value={a}>{a}</option>)}</Select>
        </FilterField>
        <FilterField label="Autor">
          <Select name="autor" defaultValue={param(sp, "autor") ?? ""}><option value="">Todos</option><option value="sistema">Sistema / site</option>{r.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </FilterField>
        <FilterField label="De"><Input type="date" name="de" defaultValue={param(sp, "de")} /></FilterField>
        <FilterField label="Até"><Input type="date" name="ate" defaultValue={param(sp, "ate")} /></FilterField>
      </FilterBar>

      {r.total === 0 ? (
        <EmptyState title={active ? "Nenhum registro com esses filtros" : "Nenhum registro ainda"} description={active ? "Amplie o período ou limpe os filtros." : "As ações críticas aparecem aqui assim que acontecem."} />
      ) : (
        <Card>
          <Table aria-label="Registros de auditoria">
            <thead>
              <tr><th>Quando</th><th>O que aconteceu</th><th className="hidden md:table-cell">Área</th><th className="hidden lg:table-cell">Registro</th><th>Autor</th></tr>
            </thead>
            <tbody>
              {r.rows.map((e) => (
                <tr key={e.id}>
                  <td className="tabular whitespace-nowrap text-xs text-navy-600">{dateTime(e.createdAt)}</td>
                  <td>
                    <p className="font-medium text-navy-900">{auditLabel(e.action, e.entityType)}</p>
                    <details className="mt-0.5 text-xs text-navy-500">
                      <summary className="cursor-pointer select-none">Detalhes</summary>
                      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        <dt>Código</dt><dd><code>{e.action}</code></dd>
                        <dt>Entidade</dt><dd>{e.entityType}{e.entityId ? ` · ${e.entityId}` : ""}</dd>
                        {e.data !== null && <><dt>Dados</dt><dd><pre className="max-h-40 max-w-[36rem] overflow-auto whitespace-pre-wrap break-all rounded bg-navy-50 p-2 text-[11px] text-navy-700">{JSON.stringify(e.data, null, 1).slice(0, 2000)}</pre></dd></>}
                      </dl>
                    </details>
                  </td>
                  <td className="hidden md:table-cell"><Badge>{auditArea(e.action)}</Badge></td>
                  <td className="hidden text-xs text-navy-600 lg:table-cell">{entityLabel(e.entityType)}{e.entityId ? <span className="text-navy-400"> · …{e.entityId.slice(-6)}</span> : null}</td>
                  <td className="text-sm">{e.actorUserId ? e.actorName ?? "—" : <span className="text-navy-500">sistema / site</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={r.filter.page} pageSize={r.pageSize} total={r.total} label="registros" href={(p) => hrefWith("/app/auditoria", sp, { page: p })} />
        </Card>
      )}
    </>
  );
}
