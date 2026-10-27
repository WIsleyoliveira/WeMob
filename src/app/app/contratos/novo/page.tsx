import { requirePage } from "@/server/auth/current";
import { contractFormOptions } from "@/server/modules/contracts/service";
import { createContractAction } from "@/app/actions/contracts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { ContractTermsFields } from "@/components/app/contract-terms-fields";

export default async function NovoContratoPage() {
  const ctx = await requirePage("contract:write");
  const { partners, sites, modelVersions } = await contractFormOptions(ctx);
  return (
    <>
      <PageHeader title="Novo contrato" breadcrumbs={[{ label: "Contratos", href: "/app/contratos" }, { label: "Novo" }]} description="Cria o contrato e a versão 1 em rascunho. Só passa a valer depois de aprovada por outra pessoa com permissão." />
      {sites.length === 0 && <Alert tone="warning" className="mb-6">Nenhuma unidade vinculada a parceiro. Vincule o parceiro no cadastro da unidade antes de criar o contrato.</Alert>}
      <Card>
        <CardBody>
          <ActionForm action={createContractAction} submitLabel="Criar contrato (rascunho)">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Parceiro / investidor" htmlFor="partnerOrganizationId" required><Select id="partnerOrganizationId" name="partnerOrganizationId" required><option value="">Selecione</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind === "PARTNER" ? "parceiro" : "investidor"})</option>)}</Select></Field>
              <Field label="Título" htmlFor="title" required><Input id="title" name="title" required minLength={3} maxLength={160} /></Field>
            </div>
            <fieldset className="rounded-lg border border-navy-100 p-3">
              <legend className="px-1 text-sm font-medium text-navy-800">Unidades (devem estar vinculadas ao parceiro escolhido)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {sites.map((s) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="siteIds" value={s.id} /> {s.name} <span className="text-xs text-navy-400">({partners.find((p) => p.id === s.partnerOrganizationId)?.name})</span></label>)}
              </div>
            </fieldset>
            <ContractTermsFields modelVersions={modelVersions} reasonLabel="Motivo / origem (ex.: contrato assinado em …)" />
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
