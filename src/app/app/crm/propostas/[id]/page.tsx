import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getProposal, PROPOSAL_STATUS_LABEL, TRANSITIONS } from "@/server/modules/crm/proposals";
import { listApprovedVersions } from "@/server/modules/commercial/service";
import { getEmailAdapter } from "@/server/integrations/email";
import { reviseProposalAction, setProposalStatusAction } from "@/app/actions/crm";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ActionForm } from "@/components/app/action-form";
import { ProposalFields } from "@/components/app/proposal-form";
import { brl, date, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const ACTION_LABEL = { SENT: "Marcar como enviada", ACCEPTED: "Registrar aceite", REJECTED: "Registrar recusa", CANCELLED: "Cancelar proposta" } as const;
type Item = { description: string; quantity: string; unitPrice: string; total: string };

export default async function PropostaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("lead:read");
  const { id } = await params;
  const p = await getProposal(ctx, id).catch(() => notFound());
  const current = p.versions[0];
  const canWrite = ctx.permissions.has("lead:write");
  const versions = canWrite && ctx.permissions.has("simulation:run") ? await listApprovedVersions(ctx) : [];
  const email = getEmailAdapter();
  const items = current.items as unknown as Item[];
  const next = TRANSITIONS[p.status].filter((s) => s !== "DRAFT") as (keyof typeof ACTION_LABEL)[];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "CRM", href: "/app/crm" }, { label: "Propostas", href: "/app/crm/propostas" }, { label: p.number }]}
        title={`${p.number} — ${p.title}`}
        description={<span className="flex flex-wrap items-center gap-2"><Badge>{PROPOSAL_STATUS_LABEL[p.status]}</Badge> versão {current.version} · lead <Link className="text-brand-700 underline" href={`/app/crm/${p.lead.id}`}>{p.lead.companyName ?? p.lead.contactName}</Link></span>}
        actions={<Link href={`/app/crm/propostas/${p.id}/imprimir`} className="text-sm font-medium text-brand-700 hover:underline">Versão para impressão / PDF →</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title={`Versão ${current.version}`} description={`Criada em ${dateTime(current.createdAt)} · válida até ${date(current.validUntil)}`} />
            <Table>
              <thead><tr><th>Item</th><th className="text-right">Qtd.</th><th className="text-right">Unitário</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {items.map((i, k) => (
                  <tr key={k}><td>{i.description}</td><td className="tabular text-right">{i.quantity}</td><td className="tabular text-right">{brl(i.unitPrice)}</td><td className="tabular text-right">{brl(i.total)}</td></tr>
                ))}
                <tr className="font-semibold"><td colSpan={3}>Total</td><td className="tabular text-right">{brl(current.total.toString())}</td></tr>
              </tbody>
            </Table>
            <CardBody><p className="whitespace-pre-wrap text-sm text-navy-700">{current.conditions}</p></CardBody>
          </Card>
          {p.versions.length > 1 && (
            <Card>
              <CardHeader title="Histórico de versões" />
              <Table>
                <thead><tr><th>Versão</th><th className="text-right">Total</th><th>Validade</th><th>Criada</th></tr></thead>
                <tbody>{p.versions.map((v) => <tr key={v.id}><td>v{v.version}</td><td className="tabular text-right">{brl(v.total.toString())}</td><td className="text-xs">{date(v.validUntil)}</td><td className="text-xs">{dateTime(v.createdAt)}</td></tr>)}</tbody>
              </Table>
            </Card>
          )}
          {canWrite && ["DRAFT", "SENT"].includes(p.status) && (
            <Card>
              <CardHeader title="Revisar (nova versão)" description="A versão atual é preservada. Uma proposta enviada volta para rascunho." />
              <CardBody>
                <ActionForm action={reviseProposalAction} submitLabel={`Salvar como v${current.version + 1}`}>
                  <input type="hidden" name="proposalId" value={p.id} />
                  <ProposalFields
                    models={versions.map((v) => ({ id: v.id, label: `${v.terms.modelName} v${v.terms.version}` }))}
                    defaults={{ title: p.title, items: items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })), validUntil: current.validUntil.toISOString().slice(0, 10), conditions: current.conditions, modelVersionId: current.modelVersionId }}
                  />
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Status" />
            <CardBody className="flex flex-col gap-3">
              <Alert tone="info" title={`Envio por e-mail: ${email.status === "configured" ? "configurado" : "não configurado"}`}>
                A plataforma não envia a proposta. Envie a versão para impressão/PDF pelo seu canal e registre aqui.
              </Alert>
              {canWrite && next.map((st) => (
                <ActionForm key={st} action={setProposalStatusAction} submitLabel={ACTION_LABEL[st]} variant={st === "CANCELLED" || st === "REJECTED" ? "secondary" : "primary"} confirm={st === "SENT" ? undefined : `${ACTION_LABEL[st]}? Esta mudança é registrada e não pode ser desfeita.`}>
                  <input type="hidden" name="proposalId" value={p.id} />
                  <input type="hidden" name="status" value={st} />
                </ActionForm>
              ))}
              {next.length === 0 && <p className="text-sm text-navy-500">Estado final: sem ações disponíveis.</p>}
              <dl className="text-xs text-navy-500">
                {p.sentAt && <div>Enviada em {dateTime(p.sentAt)}</div>}
                {p.decidedAt && <div>Decidida em {dateTime(p.decidedAt)}</div>}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
