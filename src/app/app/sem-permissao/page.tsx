import { requirePage } from "@/server/auth/current";
import { StateMessage } from "@/components/ui/state";
import { ButtonLink } from "@/components/ui/button";

export default async function SemPermissaoPage() {
  const ctx = await requirePage();
  return (
    <StateMessage
      kind="forbidden"
      title="Acesso não permitido"
      description={`Seu perfil (${ctx.roleKey}) em ${ctx.organizationName} não tem permissão para esta área. Solicite acesso ao administrador da organização.`}
      action={<ButtonLink href="/app" variant="secondary">Voltar ao painel</ButtonLink>}
    />
  );
}
