import type { Metadata } from "next";
import { PRIVACY_POLICY_VERSION } from "@/server/modules/leads/service";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Política de privacidade" };

export default function PrivacidadePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 text-navy-700 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-navy-900 [&_p]:mt-3 [&_li]:mt-1">
      <h1 className="font-display text-3xl font-bold text-navy-900">Política de privacidade</h1>
      <p className="text-sm text-navy-400">Versão {PRIVACY_POLICY_VERSION}</p>
      <Alert tone="warning" className="mt-6">Minuta técnica. Deve ser revisada pelo encarregado (DPO) e pela assessoria jurídica antes da publicação oficial; inclua razão social, CNPJ e canal do encarregado.</Alert>
      <h2>Dados coletados</h2>
      <p>Nos formulários do site coletamos nome, e-mail, telefone, empresa, tipo de estabelecimento, cidade/UF, modelo de interesse e a mensagem enviada. Para prevenir abuso, registramos um identificador irreversível (hash com segredo) do endereço IP, sem armazenar o IP em claro.</p>
      <h2>Finalidade e base legal</h2>
      <p>Os dados são usados para responder à solicitação, realizar o estudo de viabilidade e o contato comercial (art. 7º, V e IX, da LGPD), mediante o seu consentimento registrado com data e versão desta política.</p>
      <h2>Compartilhamento</h2>
      <p>Os dados não são vendidos. Podem ser tratados por fornecedores de infraestrutura que hospedam a plataforma, sob obrigação contratual de confidencialidade.</p>
      <h2>Seus direitos</h2>
      <ul className="list-disc pl-6"><li>Confirmação e acesso aos dados;</li><li>Correção, anonimização ou eliminação;</li><li>Revogação do consentimento;</li><li>Informação sobre compartilhamento.</li></ul>
      <h2>Retenção</h2>
      <p>Leads sem relação comercial são mantidos por até 24 meses após o último contato e então anonimizados, salvo obrigação legal.</p>
    </article>
  );
}
