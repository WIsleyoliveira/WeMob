import { requirePage } from "@/server/auth/current";
import { listSplitConfig } from "@/server/payments/split";
import { asaasConfigSummary } from "@/server/payments/asaas/config";
import { createRecipientAction, createSplitPolicyAction, decideSplitPolicyAction, disableRecipientAction, validateRecipientAction } from "@/app/actions/payments";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { date, dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";
const REC_TONE = { PENDING_VALIDATION: "amber", ACTIVE: "green", DISABLED: "neutral" } as const;
const POL_TONE = { DRAFT: "amber", APPROVED: "green", REJECTED: "neutral" } as const;

export default async function SplitPage() {
  const ctx = await requirePage("payment:read");
  const { recipients, policies, orgs, sites } = await listSplitConfig(ctx);
  const cfg = asaasConfigSummary();
  const canRec = ctx.permissions.has("payment:recipients_manage");
  const canPol = ctx.permissions.has("payment:split_configure");
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const wallet = (w: string) => `${w.slice(0, 8)}…${w.slice(-4)}`;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Pagamentos", href: "/app/pagamentos" }, { label: "Split e recebedores" }]} title="Split e recebedores" description="Divisão automática pelo Asaas entre a WeMob e os postos parceiros. Percentuais incidem sobre o valor LÍQUIDO (após tarifas do Asaas) — 50% no split não é 50% do valor cobrado." />
      <Alert tone={cfg.splitEnabled ? "info" : "warning"} className="mb-6" title={cfg.splitEnabled ? "Split habilitado no servidor" : "Split desabilitado (ASAAS_SPLIT_ENABLED≠1)"}>
        {cfg.splitEnabled
          ? "Cobranças novas incluem o split somente com política aprovada e vigente e recebedores validados no mesmo ambiente; qualquer impedimento → cobrança sem split, com motivo registrado."
          : "Nenhuma divisão automática é enviada. Repasses aos parceiros seguem pelo fechamento mensal, com aprovação e trilha de auditoria. Habilite só após confirmar com o Asaas a elegibilidade do split para recarga de VE."}
      </Alert>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Recebedores (carteiras Asaas dos parceiros)" description="O walletId é informado pelo parceiro e conferido por outra pessoa. Nunca é gerado pela plataforma." />
          <Table>
            <thead><tr><th>Parceiro</th><th>Ambiente</th><th>walletId</th><th>Status</th><th /></tr></thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td>{orgName.get(r.organizationId) ?? r.organizationId.slice(-6)}</td>
                  <td><Badge tone={r.environment === "PRODUCTION" ? "red" : "amber"}>{r.environment === "PRODUCTION" ? "produção" : "sandbox"}</Badge></td>
                  <td className="font-mono text-xs">{wallet(r.walletId)}</td>
                  <td><Badge tone={REC_TONE[r.status]}>{r.status === "PENDING_VALIDATION" ? "aguardando validação" : r.status === "ACTIVE" ? "ativo" : "desativado"}</Badge>{r.validatedAt && <span className="block text-xs text-navy-500">validado {dateTime(r.validatedAt)}</span>}</td>
                  <td className="space-y-1">
                    {canRec && r.status === "PENDING_VALIDATION" && <ActionForm action={validateRecipientAction} submitLabel="Validar" size="sm" confirm="Confirma que conferiu o walletId com o parceiro (documento/e-mail)?"><input type="hidden" name="recipientId" value={r.id} /></ActionForm>}
                    {canRec && r.status !== "DISABLED" && <ActionForm action={disableRecipientAction} submitLabel="Desativar" variant="secondary" size="sm" confirm="Desativar o recebedor? Cobranças já criadas não mudam."><input type="hidden" name="recipientId" value={r.id} /></ActionForm>}
                  </td>
                </tr>
              ))}
              {recipients.length === 0 && <tr><td colSpan={5} className="text-navy-500">Nenhum recebedor cadastrado.</td></tr>}
            </tbody>
          </Table>
          {canRec && (
            <CardBody>
              <ActionForm action={createRecipientAction} submitLabel="Cadastrar recebedor" variant="secondary">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Parceiro" htmlFor="r-org"><Select id="r-org" name="organizationId" required defaultValue=""><option value="" disabled>Selecione</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
                  <Field label="Ambiente" htmlFor="r-env"><Select id="r-env" name="environment" defaultValue="SANDBOX"><option value="SANDBOX">Sandbox</option><option value="PRODUCTION">Produção</option></Select></Field>
                </div>
                <Field label="walletId (UUID)" htmlFor="r-wallet"><Input id="r-wallet" name="walletId" required className="font-mono" placeholder="00000000-0000-0000-0000-000000000000" /></Field>
                <Field label="Origem da informação" htmlFor="r-note" hint="Ex.: enviado por e-mail pelo responsável financeiro do posto em dd/mm."><Input id="r-note" name="note" required minLength={5} /></Field>
              </ActionForm>
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Políticas de split (versionadas)" description="Imutáveis após aprovação; cada cobrança guarda a versão aplicada. Aprovação por outra pessoa." />
          <CardBody className="flex flex-col gap-3">
            {policies.length === 0 && <p className="text-sm text-navy-500">Nenhuma política.</p>}
            {policies.map((p) => (
              <div key={p.id} className="rounded-lg border border-navy-100 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{p.siteId ? siteName.get(p.siteId) ?? "Unidade" : "Padrão da rede"} · v{p.version}</span>
                  <Badge tone={POL_TONE[p.status]}>{p.status === "DRAFT" ? "rascunho" : p.status === "APPROVED" ? "aprovada" : "recusada"}</Badge>
                </div>
                <p className="text-xs text-navy-500">Vigência a partir de {date(p.effectiveFrom)}{p.effectiveTo ? ` até ${date(p.effectiveTo)}` : ""} · motivo: {p.reason}</p>
                <ul className="mt-1 list-disc pl-5 text-navy-700">
                  {p.participants.map((x) => (
                    <li key={x.id}>{x.kind === "SITE_PARTNER" ? "Parceiro da unidade" : "Recebedor fixo"}: {x.percentualValue ? `${x.percentualValue}% do líquido` : ""}{x.percentualValue && x.fixedValue ? " + " : ""}{x.fixedValue ? `R$ ${x.fixedValue}` : ""}{x.description ? ` (${x.description})` : ""}</li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-navy-500">Tarifas: {p.feeTreatment}</p>
                {canPol && p.status === "DRAFT" && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {(["approve", "reject"] as const).map((dec) => (
                      <ActionForm key={dec} action={decideSplitPolicyAction} submitLabel={dec === "approve" ? "Aprovar" : "Recusar"} variant={dec === "approve" ? "primary" : "secondary"} size="sm" confirm={dec === "approve" ? "Aprovar esta política para novas cobranças?" : undefined}>
                        <input type="hidden" name="policyId" value={p.id} /><input type="hidden" name="decision" value={dec} />
                        <Input name="note" placeholder={dec === "approve" ? "Observação (opcional)" : "Motivo da recusa"} aria-label="Observação" />
                      </ActionForm>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardBody>
          {canPol && (
            <CardBody className="border-t border-navy-100">
              <p className="mb-2 font-display font-semibold text-navy-900">Nova versão</p>
              <ActionForm action={createSplitPolicyAction} submitLabel="Criar rascunho" variant="secondary">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Escopo" htmlFor="sp-site"><Select id="sp-site" name="siteId" defaultValue=""><option value="">Padrão da rede</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                  <Field label="Vigência a partir de" htmlFor="sp-from"><Input id="sp-from" name="effectiveFrom" type="date" required /></Field>
                </div>
                {[0, 1, 2].map((i) => (
                  <fieldset key={i} className="grid gap-2 rounded-lg border border-navy-100 p-2 sm:grid-cols-4">
                    <legend className="px-1 text-xs text-navy-500">Participante {i + 1}{i > 0 ? " (opcional)" : ""}</legend>
                    <Select name={`p${i}.kind`} defaultValue={i === 0 ? "SITE_PARTNER" : ""} aria-label="Tipo"><option value="">—</option><option value="SITE_PARTNER">Parceiro da unidade</option><option value="RECIPIENT">Recebedor fixo</option></Select>
                    <Select name={`p${i}.recipientId`} defaultValue="" aria-label="Recebedor fixo"><option value="">(recebedor fixo)</option>{recipients.filter((r) => r.status === "ACTIVE").map((r) => <option key={r.id} value={r.id}>{orgName.get(r.organizationId) ?? r.id.slice(-6)} · {r.environment === "PRODUCTION" ? "prod" : "sandbox"}</option>)}</Select>
                    <Input name={`p${i}.pct`} inputMode="decimal" placeholder="% do líquido" aria-label="Percentual do líquido" />
                    <Input name={`p${i}.fixed`} inputMode="decimal" placeholder="R$ fixo" aria-label="Valor fixo" />
                  </fieldset>
                ))}
                <Field label="Tratamento das tarifas" htmlFor="sp-fee" hint="Como as tarifas do Asaas entram na conta (o split incide sobre o líquido; o resíduo fica com a WeMob)."><Textarea id="sp-fee" name="feeTreatment" required minLength={10} /></Field>
                <Field label="Motivo / base contratual" htmlFor="sp-reason"><Input id="sp-reason" name="reason" required minLength={5} /></Field>
              </ActionForm>
            </CardBody>
          )}
        </Card>
      </div>
    </>
  );
}
