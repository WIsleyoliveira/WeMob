import { requirePage } from "@/server/auth/current";
import { listStages } from "@/server/modules/leads/service";
import { createStageAction, updateStageAction } from "@/app/actions/crm";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ActionForm } from "@/components/app/action-form";

export const dynamic = "force-dynamic";

export default async function ConfigurarFunilPage() {
  const ctx = await requirePage("crm:configure");
  const stages = await listStages(ctx);
  return (
    <>
      <PageHeader title="Configurar funil" description="Nome e probabilidade de ganho de cada etapa (usada no pipeline ponderado). Ganho = 100% e Perdido = 0% são fixos. Alterações são auditadas." />
      <div className="grid gap-4 lg:grid-cols-2">
        {stages.map((s) => (
          <Card key={s.id}>
            <CardBody>
              <ActionForm action={updateStageAction} submitLabel="Salvar" size="sm" variant="secondary">
                <input type="hidden" name="stageId" value={s.id} />
                <div className="flex items-center gap-2 text-xs text-navy-500">Posição {s.position + 1} {s.isWon && <Badge tone="green">ganho</Badge>} {s.isLost && <Badge tone="red">perda</Badge>}</div>
                <div className="grid grid-cols-[1fr_8rem] gap-3">
                  <Field label="Nome" htmlFor={`n-${s.id}`}><Input id={`n-${s.id}`} name="name" defaultValue={s.name} required /></Field>
                  <Field label="Probabilidade (%)" htmlFor={`p-${s.id}`}><Input id={`p-${s.id}`} name="probabilityPct" inputMode="decimal" defaultValue={String(Number(s.probability) * 100)} readOnly={s.isWon || s.isLost} /></Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="mt-6 max-w-xl">
        <CardHeader title="Nova etapa" description="Inserida imediatamente antes de 'Ganho'." />
        <CardBody>
          <ActionForm action={createStageAction} submitLabel="Criar etapa">
            <div className="grid grid-cols-[1fr_8rem] gap-3">
              <Field label="Nome" htmlFor="new-name"><Input id="new-name" name="name" required minLength={2} /></Field>
              <Field label="Probabilidade (%)" htmlFor="new-prob"><Input id="new-prob" name="probabilityPct" inputMode="decimal" required /></Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
