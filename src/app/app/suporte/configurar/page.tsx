import { requirePage } from "@/server/auth/current";
import { PRIORITY_LABEL, listSlaPolicies } from "@/server/modules/support/tickets";
import { saveSlaPolicyAction } from "@/app/actions/support";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";

export const dynamic = "force-dynamic";
const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const h = (m: number) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`);

export default async function SlaPage() {
  const ctx = await requirePage("support:read");
  const policies = await listSlaPolicies(ctx);
  return (
    <>
      <PageHeader title="Políticas de SLA" description="Prazos por prioridade (opcionalmente por contrato). Salvar cria nova política e desativa a anterior; tickets existentes mantêm os prazos copiados na abertura." />
      <Card className="mb-6">
        <Table>
          <thead><tr><th>Prioridade</th><th>Escopo</th><th className="text-right">1ª resposta</th><th className="text-right">Solução</th><th>Calendário</th></tr></thead>
          <tbody>{policies.map((p) => <tr key={p.id}><td>{PRIORITY_LABEL[p.priority]}</td><td className="text-xs">{p.contractId ? "contrato específico" : "geral"}</td><td className="tabular text-right">{h(p.responseMinutes)}</td><td className="tabular text-right">{h(p.resolutionMinutes)}</td><td className="text-xs">{p.businessHoursOnly ? `${p.workDays.map((d) => DAYS[d]).join(", ")} ${p.workStartHour}h–${p.workEndHour}h` : "24×7"}</td></tr>)}</tbody>
        </Table>
      </Card>
      {ctx.permissions.has("support:configure") && (
        <Card className="max-w-3xl">
          <CardHeader title="Nova política" description="Fuso America/Belem (UTC−3). Feriados não são considerados." />
          <CardBody>
            <ActionForm action={saveSlaPolicyAction} submitLabel="Salvar política">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Prioridade" htmlFor="priority"><Select id="priority" name="priority">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="1ª resposta (min)" htmlFor="responseMinutes" required><Input id="responseMinutes" name="responseMinutes" type="number" min="1" required /></Field>
                <Field label="Solução (min)" htmlFor="resolutionMinutes" required><Input id="resolutionMinutes" name="resolutionMinutes" type="number" min="1" required /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="businessHoursOnly" /> Contar só horário útil</label>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Início do expediente (h)" htmlFor="workStartHour"><Input id="workStartHour" name="workStartHour" type="number" min="0" max="23" defaultValue={8} /></Field>
                <Field label="Fim do expediente (h)" htmlFor="workEndHour"><Input id="workEndHour" name="workEndHour" type="number" min="1" max="24" defaultValue={18} /></Field>
              </div>
              <fieldset className="flex flex-wrap gap-3 text-sm"><legend className="mb-1 text-sm font-medium text-navy-800">Dias úteis</legend>{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1"><input type="checkbox" name="workDays" value={i} defaultChecked={i >= 1 && i <= 5} /> {d}</label>)}</fieldset>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </>
  );
}
