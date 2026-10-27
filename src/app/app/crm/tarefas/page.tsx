import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listOpenTasks } from "@/server/modules/crm/tasks";
import { completeTaskAction } from "@/app/actions/crm";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm } from "@/components/app/action-form";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TarefasPage({ searchParams }: { searchParams: Promise<{ todas?: string }> }) {
  const ctx = await requirePage("lead:read");
  const all = (await searchParams).todas === "1";
  const tasks = await listOpenTasks(ctx, { mine: !all });
  const now = Date.now();
  return (
    <>
      <PageHeader
        title={all ? "Tarefas em aberto da equipe" : "Minhas tarefas em aberto"}
        description="Ordenadas por vencimento. Lembretes externos (e-mail/WhatsApp) não estão configurados: as tarefas aparecem apenas aqui e no painel."
        actions={<Link href={all ? "/app/crm/tarefas" : "/app/crm/tarefas?todas=1"} className="text-sm font-medium text-brand-700 hover:underline">{all ? "Ver só as minhas" : "Ver da equipe"}</Link>}
      />
      {tasks.length === 0 ? <EmptyState title="Nenhuma tarefa em aberto" description="Crie tarefas a partir da página de cada lead." /> : (
        <Card>
          <Table>
            <thead><tr><th>Vencimento</th><th>Tarefa</th><th>Lead</th><th>Responsável</th><th /></tr></thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td className="tabular text-xs">{dateTime(t.dueAt)} {t.dueAt.getTime() < now && <Badge tone="red">atrasada</Badge>}</td>
                  <td>{t.title}</td>
                  <td><Link className="text-brand-700 hover:underline" href={`/app/crm/${t.lead.id}`}>{t.lead.companyName ?? t.lead.contactName}</Link></td>
                  <td>{t.assignee?.name ?? "—"}</td>
                  <td>{ctx.permissions.has("lead:write") && <ActionForm action={completeTaskAction} submitLabel="Concluir" size="sm" variant="secondary"><input type="hidden" name="taskId" value={t.id} /></ActionForm>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
