import { requirePage } from "@/server/auth/current";
import { assignableRoles, listMembers } from "@/server/modules/identity/service";
import { changeMemberRoleAction, createResetLinkAction, revokeMemberSessionsAction, revokeMembershipAction } from "@/app/actions/identity";
import { PERMISSION_GROUPS } from "@/domain/auth/permission-labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { FilterBar, FilterField, SearchInput } from "@/components/ui/filter-bar";
import { SummaryStrip } from "@/components/ui/summary-strip";
import { ActionForm } from "@/components/app/action-form";
import { date, dateTime } from "@/lib/format";
import { hrefWith, param } from "@/lib/query";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const norm = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default async function UsuariosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePage("user:manage");
  const sp = await searchParams;
  const members = await listMembers(ctx);
  const roles = assignableRoles(ctx);
  const q = param(sp, "q");
  const role = param(sp, "perfil");
  const status = param(sp, "situacao") === "revogados" ? "revogados" : param(sp, "situacao") === "todos" ? "todos" : "ativos";
  const shown = members.filter((m) => (status === "todos" || (status === "ativos" ? !m.revokedAt : !!m.revokedAt)) && (!role || m.role.key === role) && (!q || norm(`${m.user.name} ${m.user.email}`).includes(norm(q))));
  const active = members.filter((m) => !m.revokedAt);
  const managers = active.filter((m) => roles.find((r) => r.key === m.role.key)?.permissions.includes("user:manage") || m.role.key === "superadmin").length;
  const filtered = !!(q || role || status !== "ativos");
  return (
    <>
      <PageHeader title="Usuários e acessos" description={`Quem acessa a plataforma em ${ctx.organizationName}, com qual perfil e em quais aparelhos.`} />
      <SummaryStrip
        label="Resumo dos acessos"
        items={[
          { label: "Acessos ativos", value: active.length, href: hrefWith("/app/usuarios", {}, {}), current: status === "ativos" && !role && !q },
          { label: "Com sessão aberta", value: active.filter((m) => m.sessions > 0).length, hint: "em ao menos um aparelho" },
          { label: "Administram usuários", value: managers, hint: managers <= 1 ? "o último não pode ser removido" : undefined, tone: managers <= 1 ? "warning" : "default" },
          { label: "Revogados", value: members.length - active.length, href: hrefWith("/app/usuarios", {}, { situacao: "revogados" }), current: status === "revogados" },
        ]}
      />
      <FilterBar action="/app/usuarios" clearHref="/app/usuarios" active={filtered}>
        <FilterField label="Buscar" wide><SearchInput defaultValue={q} placeholder="Nome ou e-mail" /></FilterField>
        <FilterField label="Perfil">
          <Select name="perfil" defaultValue={role ?? ""}><option value="">Todos</option>{[...new Map(members.map((m) => [m.role.key, m.role.name]))].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select>
        </FilterField>
        <FilterField label="Situação">
          <Select name="situacao" defaultValue={status}><option value="ativos">Ativos</option><option value="revogados">Revogados</option><option value="todos">Todos</option></Select>
        </FilterField>
      </FilterBar>

      {shown.length === 0 ? (
        <EmptyState title="Nenhum usuário com esses filtros" description="Limpe os filtros para ver todos os acessos." />
      ) : (
        <Card className="mb-6">
          <Table aria-label="Usuários">
            <thead><tr><th>Usuário</th><th className="hidden md:table-cell">Perfil</th><th className="hidden lg:table-cell">Aparelhos</th><th className="hidden md:table-cell">Desde</th><th className="hidden sm:table-cell">Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {shown.map((m) => {
                const self = m.user.id === ctx.userId;
                return (
                  <tr key={m.id}>
                    <td>
                      <p className="font-medium text-navy-900">{m.user.name} {self && <Badge tone="navy">você</Badge>}</p>
                      <p className="text-xs text-navy-500">{m.user.email}</p>
                      <p className="text-xs text-navy-700 md:hidden">{m.role.name}</p>
                    </td>
                    <td className="hidden md:table-cell">{m.role.name}</td>
                    <td className="hidden text-xs text-navy-600 lg:table-cell">
                      {m.sessions === 0 ? <span className="text-navy-400">nenhuma sessão aberta</span> : <>{m.sessions} sessão(ões) · {m.devices.join(", ")}<br /><span className="text-navy-400">último acesso {m.lastAccessAt ? dateTime(m.lastAccessAt) : "—"}</span></>}
                    </td>
                    <td className="hidden text-xs md:table-cell">{date(m.createdAt)}</td>
                    <td className="hidden sm:table-cell">{m.revokedAt ? <Badge tone="red">Revogado em {date(m.revokedAt)}</Badge> : <Badge tone="green">Ativo</Badge>}</td>
                    <td className="text-right">
                      {!m.revokedAt && !self && (
                        <details className="group relative inline-block text-left">
                          <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-lg border border-navy-200 px-3 text-sm font-medium text-navy-700 hover:bg-navy-50 [&::-webkit-details-marker]:hidden">Gerenciar</summary>
                          <div className="absolute right-0 z-20 mt-1 w-80 space-y-3 rounded-[var(--radius-card)] border border-navy-100 bg-white p-4 text-left shadow-xl">
                            <ActionForm action={changeMemberRoleAction} submitLabel="Trocar perfil" size="sm" variant="secondary" confirm={`Trocar o perfil de ${m.user.name}? As sessões abertas dele serão encerradas.`}>
                              <input type="hidden" name="membershipId" value={m.id} />
                              <FilterField label="Perfil"><Select name="roleKey" defaultValue={m.role.key}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select></FilterField>
                            </ActionForm>
                            <ActionForm action={revokeMemberSessionsAction} submitLabel="Encerrar sessões" size="sm" variant="secondary" confirm={`Encerrar as sessões de ${m.user.name} em todos os aparelhos? O acesso continua ativo.`}>
                              <input type="hidden" name="membershipId" value={m.id} />
                            </ActionForm>
                            <ActionForm action={createResetLinkAction} submitLabel="Gerar link de senha" variant="secondary" size="sm">
                              <input type="hidden" name="membershipId" value={m.id} />
                            </ActionForm>
                            <div className="border-t border-navy-100 pt-3">
                              <ActionForm action={revokeMembershipAction} submitLabel="Revogar acesso" variant="danger" size="sm" confirm={`Revogar o acesso de ${m.user.name}? Todas as sessões dele nesta organização serão encerradas.`}>
                                <input type="hidden" name="membershipId" value={m.id} />
                              </ActionForm>
                            </div>
                          </div>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader title="Perfis e permissões" description="Perfis do sistema: o que cada um pode fazer. As permissões são verificadas no servidor em toda ação." />
        <CardBody className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <section key={r.key} aria-labelledby={`perfil-${r.key}`} className="rounded-lg border border-navy-100 p-3">
              <h3 id={`perfil-${r.key}`} className="font-medium text-navy-900">{r.name} <span className="text-xs font-normal text-navy-500">· {active.filter((m) => m.role.key === r.key).length} ativo(s)</span></h3>
              <ul className="mt-2 space-y-1 text-xs text-navy-600">
                {PERMISSION_GROUPS.map((g) => ({ g, perms: g.permissions.filter((p) => (r.permissions as readonly string[]).includes(p.key)) })).filter((x) => x.perms.length).map(({ g, perms }) => (
                  <li key={g.label}><span className="font-medium text-navy-800">{g.label}:</span> {perms.map((p) => p.label).join(", ")}</li>
                ))}
              </ul>
            </section>
          ))}
        </CardBody>
      </Card>
      <Alert tone="info">Convite de novos usuários, envio de redefinição por e-mail e MFA dependem de um provedor de e-mail (não configurado). Até lá, gere o link de redefinição aqui e entregue por canal seguro.</Alert>
    </>
  );
}
