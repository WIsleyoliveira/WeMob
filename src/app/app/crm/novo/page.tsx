import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { BUSINESS_TYPES } from "@/server/modules/leads/service";
import { createLeadAction } from "@/app/actions/leads";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";

export default async function NovoLeadPage() {
  await requirePage("lead:write");
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/app/crm" className="text-navy-500 hover:text-navy-900">← CRM</Link></p>
      <PageHeader title="Novo lead" description="O sistema bloqueia duplicidade por e-mail ou telefone de leads em aberto." />
      <Card className="max-w-3xl">
        <CardBody>
          <ActionForm action={createLeadAction} submitLabel="Cadastrar lead">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome do contato" htmlFor="contactName" required><Input id="contactName" name="contactName" required /></Field>
              <Field label="E-mail" htmlFor="email" required><Input id="email" name="email" type="email" required /></Field>
              <Field label="Telefone" htmlFor="phone"><Input id="phone" name="phone" type="tel" /></Field>
              <Field label="Empresa" htmlFor="companyName"><Input id="companyName" name="companyName" /></Field>
              <Field label="Tipo de estabelecimento" htmlFor="businessType">
                <Select id="businessType" name="businessType" defaultValue=""><option value="">—</option>{Object.entries(BUSINESS_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
              </Field>
              <Field label="Origem" htmlFor="source">
                <Select id="source" name="source" defaultValue="MANUAL"><option value="MANUAL">Cadastro manual</option><option value="REFERRAL">Indicação</option><option value="EVENT">Evento</option></Select>
              </Field>
              <Field label="Cidade" htmlFor="city"><Input id="city" name="city" /></Field>
              <Field label="UF" htmlFor="state" hint="Sigla, ex.: PA"><Input id="state" name="state" maxLength={2} className="uppercase" /></Field>
              <Field label="Campanha" htmlFor="campaign"><Input id="campaign" name="campaign" /></Field>
              <Field label="Modelo de interesse" htmlFor="interestModel">
                <Select id="interestModel" name="interestModel" defaultValue="indefinido"><option value="indefinido">Indefinido</option><option value="compra-integral">Compra integral</option><option value="parceria-50-50">Parceria 50/50</option></Select>
              </Field>
              <Field label="Observações" htmlFor="message" className="sm:col-span-2"><Textarea id="message" name="message" /></Field>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
