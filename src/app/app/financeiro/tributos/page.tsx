import { requirePage } from "@/server/auth/current";
import { listTaxRules } from "@/server/modules/finance/entries";
import { createTaxRuleAction, endTaxRuleAction } from "@/app/actions/finance";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Table } from "@/components/ui/table";
import { Field, Input } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { date, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TributosPage() {
  const ctx = await requirePage("finance:read");
  const rules = await listTaxRules(ctx);
  const canEdit = ctx.permissions.has("finance:approve");
  return (
    <>
      <PageHeader title="Tributos configuráveis" description="Alíquotas aplicadas sobre a receita bruta no fechamento, versionadas por vigência. Mudar alíquota = nova regra; a anterior é encerrada, nunca editada." />
      <Alert tone="warning" className="mb-6">Modelo simplificado (percentual sobre o bruto). Não representa apuração fiscal oficial: confirme regime, alíquotas e bases com o contador.</Alert>
      <Card className="mb-6">
        <Table>
          <thead><tr><th>Tributo</th><th className="text-right">Alíquota</th><th>Vigência</th><th>Observação</th>{canEdit && <th>Encerrar</th>}</tr></thead>
          <tbody>
            {rules.length === 0 && <tr><td colSpan={5} className="text-navy-500">Nenhum tributo configurado: fechamentos serão calculados sem tributos (com aviso).</td></tr>}
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td><td className="tabular text-right">{pct(r.rate.toString(), 2)}</td>
                <td className="text-xs">{date(r.effectiveFrom)} → {r.effectiveTo ? date(r.effectiveTo) : "sem término"}</td><td className="text-xs">{r.note ?? "—"}</td>
                {canEdit && <td>{!r.effectiveTo && <ActionForm action={endTaxRuleAction} submitLabel="Encerrar" size="sm" variant="secondary" confirm="Encerrar a vigência deste tributo na data informada?"><input type="hidden" name="taxRuleId" value={r.id} /><Input type="date" name="effectiveTo" required aria-label="Data de término" className="w-40" /></ActionForm>}</td>}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {canEdit && (
        <Card>
          <CardHeader title="Nova regra" description="Use o 1º dia de um mês: vigência parcial dentro do mês bloqueia o fechamento." />
          <CardBody>
            <ActionForm action={createTaxRuleAction} submitLabel="Registrar tributo">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Nome" htmlFor="name" required><Input id="name" name="name" required placeholder="Ex.: Simples Nacional" /></Field>
                <Field label="Alíquota (%)" htmlFor="rate" required><Input id="rate" name="rate" type="number" step="0.0001" min="0.0001" max="100" required /></Field>
                <Field label="Início" htmlFor="effectiveFrom" required><Input id="effectiveFrom" name="effectiveFrom" type="date" required /></Field>
                <Field label="Término (opcional)" htmlFor="effectiveTo"><Input id="effectiveTo" name="effectiveTo" type="date" /></Field>
              </div>
              <Field label="Observação" htmlFor="note"><Input id="note" name="note" maxLength={300} /></Field>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </>
  );
}
