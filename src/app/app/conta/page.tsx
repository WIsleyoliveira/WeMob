import { requirePage } from "@/server/auth/current";
import { changePasswordAction } from "@/app/actions/identity";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";

export default async function ContaPage() {
  const ctx = await requirePage();
  return (
    <>
      <PageHeader title="Minha conta" description={`${ctx.userName} · ${ctx.email} · ${ctx.organizationName}`} />
      <Card className="max-w-lg">
        <CardHeader title="Alterar senha" description="As demais sessões abertas serão encerradas." />
        <CardBody>
          <ActionForm action={changePasswordAction} submitLabel="Alterar senha">
            <Field label="Senha atual" htmlFor="currentPassword"><Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required /></Field>
            <Field label="Nova senha" htmlFor="password" hint="Mínimo de 12 caracteres, com letras e números."><Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
            <Field label="Confirme a nova senha" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
