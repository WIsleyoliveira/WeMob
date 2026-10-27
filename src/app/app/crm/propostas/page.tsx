import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { listProposals, PROPOSAL_STATUS_LABEL } from "@/server/modules/crm/proposals";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { brl, date } from "@/lib/format";

export const dynamic = "force-dynamic";
const TONE = { DRAFT: "neutral", SENT: "tiffany", ACCEPTED: "green", REJECTED: "red", CANCELLED: "neutral" } as const;

export default async function PropostasPage() {
  const ctx = await requirePage("lead:read");
  const proposals = await listProposals(ctx);
  return (
    <>
      <PageHeader title="Propostas comerciais" description="Cada revisão gera uma versão imutável. Crie propostas a partir da página do lead." />
      {proposals.length === 0 ? <EmptyState title="Nenhuma proposta" description="Abra um lead e use 'Nova proposta'." /> : (
        <Card>
          <Table>
            <thead><tr><th>Número</th><th>Título</th><th>Lead</th><th className="text-right">Total (última versão)</th><th>Validade</th><th>Status</th></tr></thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/app/crm/propostas/${p.id}`} className="font-medium text-navy-900 hover:text-brand-700">{p.number}</Link></td>
                  <td>{p.title} <span className="text-xs text-navy-500">v{p.versions[0]?.version}</span></td>
                  <td><Link href={`/app/crm/${p.lead.id}`} className="text-brand-700 hover:underline">{p.lead.companyName ?? p.lead.contactName}</Link></td>
                  <td className="tabular text-right">{brl(p.versions[0]?.total.toString())}</td>
                  <td className="text-xs">{p.versions[0] ? date(p.versions[0].validUntil) : "—"}</td>
                  <td><Badge tone={TONE[p.status]}>{PROPOSAL_STATUS_LABEL[p.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
