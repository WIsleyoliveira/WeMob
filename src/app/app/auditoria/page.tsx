import { requirePage } from "@/server/auth/current";
import { listAuditEvents } from "@/server/modules/audit/service";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditoriaPage() {
  const ctx = await requirePage("audit:read");
  const events = await listAuditEvents(ctx);
  return (
    <>
      <PageHeader title="Auditoria" description="Últimas 200 ações críticas registradas nesta organização. Registros não são editáveis pela interface." />
      <Card>
        <Table>
          <thead><tr><th>Quando</th><th>Ação</th><th>Entidade</th><th>Autor</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="tabular text-xs">{dateTime(e.createdAt)}</td>
                <td><code className="text-xs">{e.action}</code></td>
                <td className="text-xs">{e.entityType}{e.entityId ? ` · ${e.entityId.slice(-8)}` : ""}</td>
                <td>{e.actorUserId ? e.actorName ?? "—" : <span className="text-navy-400">sistema / site</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
