import { requirePage } from "@/server/auth/current";
import { PRIORITY_LABEL, TICKET_CATEGORY_LABEL, supportFormOptions } from "@/server/modules/support/tickets";
import { createTicketAction } from "@/app/actions/support";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";

export default async function NovoTicketPage() {
  const ctx = await requirePage("support:write");
  const opts = await supportFormOptions(ctx);
  return (
    <>
      <PageHeader title="Novo ticket" description="O prazo de SLA é copiado da política vigente da prioridade (ou do contrato da unidade) no momento da abertura." />
      <Card className="max-w-3xl">
        <CardBody>
          <ActionForm action={createTicketAction} submitLabel="Abrir ticket">
            <Field label="Título" htmlFor="title" required><Input id="title" name="title" required minLength={3} maxLength={160} /></Field>
            <Field label="Descrição" htmlFor="description" required><Textarea id="description" name="description" required minLength={5} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Categoria" htmlFor="category" required><Select id="category" name="category">{Object.entries(TICKET_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Prioridade" htmlFor="priority" required><Select id="priority" name="priority" defaultValue="MEDIUM">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Estação" htmlFor="stationId"><Select id="stationId" name="stationId"><option value="">—</option>{opts.stations.map((s) => <option key={s.id} value={s.id}>{s.ocppIdentity} · {s.site.name}{s.environment !== "PRODUCTION" ? ` (${s.environment})` : ""}</option>)}</Select></Field>
              <Field label="Unidade (se não houver estação)" htmlFor="siteId"><Select id="siteId" name="siteId"><option value="">—</option>{opts.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
