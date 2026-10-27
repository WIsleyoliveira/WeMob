import { requirePage } from "@/server/auth/current";
import { listMembers } from "@/server/modules/identity/service";
import { revokeMembershipAction } from "@/app/actions/identity";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/app/action-form";
import { date } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const ctx = await requirePage("user:manage");
  const members = await listMembers(ctx);
  return (
    <>
      <PageHeader title="Usuários e acessos" description="Revogar um acesso encerra imediatamente todas as sessões do usuário nesta organização." />
      <Card>
        <Table>
          <thead><tr><th>Usuário</th><th>Perfil</th><th>Desde</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td><p className="font-medium">{m.user.name}</p><p className="text-xs text-navy-500">{m.user.email}</p></td>
                <td>{m.role.name}</td>
                <td className="text-xs">{date(m.createdAt)}</td>
                <td>{m.revokedAt ? <Badge tone="red">Revogado em {date(m.revokedAt)}</Badge> : <Badge tone="green">Ativo</Badge>}</td>
                <td>
                  {!m.revokedAt && m.user.id !== ctx.userId && (
                    <ActionForm action={revokeMembershipAction} submitLabel="Revogar acesso" variant="danger" size="sm" confirm={`Revogar o acesso de ${m.user.name}?`}>
                      <input type="hidden" name="membershipId" value={m.id} />
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-navy-400">Convite de novos usuários, redefinição de senha por e-mail e MFA dependem de um provedor de e-mail configurado (pendente).</p>
    </>
  );
}
