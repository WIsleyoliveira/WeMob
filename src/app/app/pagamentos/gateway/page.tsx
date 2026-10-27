import { requirePage } from "@/server/auth/current";
import { asaasConfigSummary } from "@/server/payments/asaas/config";
import { ACTIVATION_ITEMS, listActivations, productionReadiness } from "@/server/payments/activation";
import { decideActivationAction, requestActivationAction, revokeActivationAction } from "@/app/actions/payments";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const STAGES: { key: string; title: string; items: string[] }[] = [
  { key: "A", title: "Desenvolvimento", items: ["Gateway isolado (PaymentProvider/Asaas)", "Variáveis de ambiente documentadas", "Migrations revisadas", "Testes automatizados com servidor Asaas falso", "Sem credenciais reais no repositório"] },
  { key: "B", title: "Sandbox oficial do Asaas", items: ["Autenticação", "Criação de cliente", "Cobrança Pix e QR Code", "Confirmação de pagamento (painel do sandbox)", "Webhook recebido e validado", "Idempotência (reenvio)", "Estorno", "Split (se habilitado)", "Conciliação"] },
  { key: "C", title: "Validação comercial com o Asaas", items: ["Elegibilidade da recarga de VE", "Tarifas por método", "Liquidação", "Requisitos de conta e recebedores", "Disponibilidade do split", "Estornos e limites operacionais"] },
  { key: "D", title: "Infraestrutura", items: ["Domínio e HTTPS", "Segredos em cofre", "Webhook público", "Backup e restauração testados", "Monitoramento, logs e alertas", "Migrations controladas, CI, rollback"] },
  { key: "E", title: "Autorização final", items: ["Habilitação solicitada e aprovada por superadministradores distintos (abaixo)"] },
];

export default async function GatewayPage() {
  const ctx = await requirePage("payment:read");
  const cfg = asaasConfigSummary();
  const [ready, activations] = await Promise.all([productionReadiness(ctx.organizationId), listActivations(ctx)]);
  const canRequest = ctx.permissions.has("payment:reconcile");
  const canDecide = ctx.permissions.has("payment:enable_production");
  const pending = activations.find((a) => a.status === "PENDING");
  const active = activations.find((a) => a.status === "APPROVED" && !a.revokedAt);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Pagamentos", href: "/app/pagamentos" }, { label: "Gateway e homologação" }]} title="Gateway e homologação" description="Configuração lida do servidor (nenhum segredo é exibido). Nenhuma ação desta tela altera o gateway: a troca de ambiente é feita somente por variáveis de ambiente." />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Configuração do Asaas" />
          <Table><tbody>
            <tr><td className="text-navy-500">Selecionado (PAYMENT_PROVIDER=asaas)</td><td>{cfg.selected ? "sim" : "não"}</td></tr>
            <tr><td className="text-navy-500">Ambiente</td><td>{cfg.environment ? <Badge tone={cfg.environment === "PRODUCTION" ? "red" : "amber"}>{cfg.environment === "PRODUCTION" ? "PRODUÇÃO" : "SANDBOX"}</Badge> : "—"}</td></tr>
            <tr><td className="text-navy-500">Configuração completa</td><td>{cfg.configured ? <Badge tone="green">sim</Badge> : <Badge tone="red">não</Badge>}</td></tr>
            <tr><td className="text-navy-500">Split habilitado (ASAAS_SPLIT_ENABLED)</td><td>{cfg.splitEnabled ? "sim" : "não"}</td></tr>
            {"ownWalletConfigured" in cfg && <tr><td className="text-navy-500">walletId da conta WeMob</td><td>{cfg.ownWalletConfigured ? "configurado" : "não configurado"}</td></tr>}
          </tbody></Table>
          {cfg.errors.length > 0 && <CardBody><Alert tone="warning" title="Pendências de configuração"><ul className="list-disc pl-5">{cfg.errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert></CardBody>}
        </Card>
        <Card>
          <CardHeader title="Produção" description="Só opera com configuração de produção E habilitação aprovada na plataforma." />
          <CardBody>
            {ready.allowed ? <Alert tone="danger" title="Pagamentos reais HABILITADOS">Cobranças em estações de produção estão liberadas.</Alert> : (
              <Alert tone="info" title="Pagamentos reais bloqueados"><ul className="list-disc pl-5">{ready.reasons.map((r) => <li key={r}>{r}</li>)}</ul></Alert>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Checklist de homologação (etapas A–E)" description="Referência do processo. O avanço de cada etapa é registrado em IMPLEMENTATION_STATUS.md e na solicitação de habilitação abaixo." />
        <CardBody className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((st) => (
            <div key={st.key} className="rounded-lg border border-navy-100 p-3">
              <p className="font-display font-semibold text-navy-900">Etapa {st.key} — {st.title}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-navy-600">{st.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {canRequest && !pending && !active && (
          <Card>
            <CardHeader title="Solicitar habilitação de produção" description="Todos os itens são obrigatórios. A aprovação deve ser de outro superadministrador." />
            <CardBody>
              <ActionForm action={requestActivationAction} submitLabel="Solicitar habilitação" confirm="Registrar a solicitação de habilitação de pagamentos reais?">
                {Object.entries(ACTIVATION_ITEMS).map(([k, label]) => (
                  <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" name={k} className="mt-1 size-4 accent-brand-600" /> {label}</label>
                ))}
                <Field label="Evidências" htmlFor="act-note" hint="Ids de teste no sandbox, contrato/e-mail do Asaas, responsáveis. Sem segredos."><Textarea id="act-note" name="note" required minLength={10} /></Field>
              </ActionForm>
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Histórico de habilitações" />
          <CardBody className="flex flex-col gap-4">
            {activations.length === 0 && <p className="text-sm text-navy-500">Nenhuma solicitação.</p>}
            {activations.map((a) => (
              <div key={a.id} className="rounded-lg border border-navy-100 p-3 text-sm">
                <div className="flex items-center justify-between gap-2"><span>{dateTime(a.createdAt)}</span><Badge tone={a.status === "APPROVED" ? "red" : a.status === "PENDING" ? "amber" : "neutral"}>{a.status}</Badge></div>
                {a.decisionNote && <p className="mt-1 text-navy-600">{a.decisionNote}</p>}
                {canDecide && a.status === "PENDING" && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(["approve", "reject"] as const).map((dec) => (
                      <ActionForm key={dec} action={decideActivationAction} submitLabel={dec === "approve" ? "Aprovar" : "Recusar"} variant={dec === "approve" ? "danger" : "secondary"} size="sm" confirm={dec === "approve" ? "Aprovar pagamentos REAIS para esta operadora?" : undefined}>
                        <input type="hidden" name="activationId" value={a.id} /><input type="hidden" name="decision" value={dec} />
                        <Input name="note" required minLength={5} placeholder="Justificativa" aria-label="Justificativa" />
                      </ActionForm>
                    ))}
                  </div>
                )}
                {canDecide && a.status === "APPROVED" && !a.revokedAt && (
                  <ActionForm action={revokeActivationAction} submitLabel="Revogar" variant="danger" size="sm" className="mt-2" confirm="Revogar a habilitação? Novas cobranças reais ficam bloqueadas imediatamente.">
                    <input type="hidden" name="activationId" value={a.id} />
                    <Input name="reason" required minLength={5} placeholder="Motivo" aria-label="Motivo da revogação" />
                  </ActionForm>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
