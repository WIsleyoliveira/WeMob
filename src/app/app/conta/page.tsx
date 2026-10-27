import { requirePage } from "@/server/auth/current";
import { changePasswordAction } from "@/app/actions/identity";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { Select } from "@/components/ui/field";
import { consentAction } from "@/app/actions/support";
import { myNotificationConsents } from "@/server/modules/alerts/notifications";
import { CHANNEL_LABEL, defaultChannelAdapters } from "@/server/integrations/notify";
import { dateTime } from "@/lib/format";

export default async function ContaPage() {
  const ctx = await requirePage();
  const canAlerts = ctx.permissions.has("alert:read") && ctx.orgKind === "OPERATOR";
  const consents = canAlerts ? await myNotificationConsents(ctx) : [];
  const adapters = defaultChannelAdapters();
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
      {canAlerts && (
        <Card className="mt-6 max-w-lg">
          <CardHeader title="Notificações de alertas" description="Opt-in por canal, revogável a qualquer momento. Sem consentimento, nada é enviado a você." />
          <CardBody className="space-y-4">
            <ul className="space-y-1 text-sm">
              {(["EMAIL", "SMS", "WHATSAPP"] as const).map((c) => {
                const r = consents.find((x) => x.channel === c && !x.revokedAt);
                return <li key={c}>{CHANNEL_LABEL[c]}: {r ? `consentido em ${dateTime(r.consentAt)} (${r.destination})` : "sem consentimento"}{adapters[c].status !== "configured" && <span className="text-xs text-amber-700"> · canal não configurado na plataforma</span>}</li>;
              })}
            </ul>
            <ActionForm action={consentAction} submitLabel="Salvar">
              <Field label="Canal" htmlFor="channel"><Select id="channel" name="channel"><option value="EMAIL">E-mail</option><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option></Select></Field>
              <Field label="Destino" htmlFor="destination" hint="E-mail, ou telefone no formato +5591999998888."><Input id="destination" name="destination" /></Field>
              <Field label="Ação" htmlFor="consent"><Select id="consent" name="consent"><option value="give">Autorizo receber alertas neste canal</option><option value="revoke">Revogar consentimento</option></Select></Field>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </>
  );
}
