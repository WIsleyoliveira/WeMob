import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getLead } from "@/server/modules/leads/service";
import { listApprovedVersions } from "@/server/modules/commercial/service";
import { createProposalAction } from "@/app/actions/crm";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm } from "@/components/app/action-form";
import { ProposalFields } from "@/components/app/proposal-form";

export default async function NovaPropostaPage({ searchParams }: { searchParams: Promise<{ leadId?: string }> }) {
  const ctx = await requirePage("lead:write");
  const { leadId } = await searchParams;
  if (!leadId) notFound();
  const lead = await getLead(ctx, leadId).catch(() => notFound());
  const versions = ctx.permissions.has("simulation:run") ? await listApprovedVersions(ctx) : [];
  const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "CRM", href: "/app/crm" }, { label: lead.companyName ?? lead.contactName, href: `/app/crm/${lead.id}` }, { label: "Nova proposta" }]} title="Nova proposta" />
      <Card className="max-w-3xl">
        <CardBody>
          <ActionForm action={createProposalAction} submitLabel="Criar proposta (v1)">
            <input type="hidden" name="leadId" value={lead.id} />
            <ProposalFields models={versions.map((v) => ({ id: v.id, label: `${v.terms.modelName} v${v.terms.version}${v.status === "DRAFT" ? " (rascunho)" : ""}` }))} defaults={{ title: `Eletroposto — ${lead.companyName ?? lead.contactName}`, items: [{ description: "Projeto e implantação do eletroposto", quantity: "1", unitPrice: "" }], validUntil, conditions: "" }} />
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
