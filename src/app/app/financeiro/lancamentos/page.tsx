import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { CATEGORY_LABEL, ENTRY_STATUS_LABEL, EXPENSE_CATEGORIES, KIND_LABEL, REVENUE_CATEGORIES, financeFormOptions, listEntries } from "@/server/modules/finance/entries";
import { cancelEntryAction, createEntryAction, settleEntryAction } from "@/app/actions/finance";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { brl, date } from "@/lib/format";
import { periodOf } from "@/domain/finance/period";
import { isPeriod } from "../labels";

export const dynamic = "force-dynamic";

export default async function LancamentosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePage("finance:read");
  const sp = await searchParams;
  const filter = { competence: isPeriod(sp.competencia) ? sp.competencia : undefined, kind: sp.sentido === "RECEIVABLE" || sp.sentido === "PAYABLE" ? sp.sentido : undefined, status: ["OPEN", "PAID", "CANCELLED"].includes(sp.situacao ?? "") ? sp.situacao : undefined };
  const [entries, opts] = await Promise.all([listEntries(ctx, filter), financeFormOptions(ctx)]);
  const canWrite = ctx.permissions.has("finance:write");
  const qs = new URLSearchParams(Object.entries({ tipo: "lancamentos", competencia: filter.competence, sentido: filter.kind, situacao: filter.status }).filter(([, v]) => v) as [string, string][]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        title="Contas a pagar e receber"
        description="Provisionado = em aberto. Baixado = pagamento/recebimento já feito fora da plataforma e registrado aqui. Períodos fechados não aceitam alterações."
        actions={ctx.permissions.has("finance:export") && <a className="text-sm font-medium text-brand-700 hover:underline" href={`/api/financeiro/exportar?${qs}`}>Exportar CSV</a>}
      />
      <form className="mb-6 flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm text-navy-700">Competência <Input type="month" name="competencia" defaultValue={filter.competence} className="mt-1 w-44" /></label>
        <label className="text-sm text-navy-700">Sentido <Select name="sentido" defaultValue={filter.kind ?? ""} className="mt-1 w-40"><option value="">Todos</option><option value="RECEIVABLE">A receber</option><option value="PAYABLE">A pagar</option></Select></label>
        <label className="text-sm text-navy-700">Situação <Select name="situacao" defaultValue={filter.status ?? ""} className="mt-1 w-48"><option value="">Todas</option>{Object.entries(ENTRY_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
        <button className="h-10 rounded-lg border border-navy-200 px-4 text-sm font-medium text-navy-700 hover:bg-navy-50">Filtrar</button>
      </form>
      {canWrite && (
        <Card className="mb-6">
          <CardHeader title="Novo lançamento" description="Receitas e despesas operacionais por unidade. Repasses e aportes são gerados apenas pelo fechamento aprovado." />
          <CardBody>
            <ActionForm action={createEntryAction} submitLabel="Registrar lançamento">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Categoria" htmlFor="category" required>
                  <Select id="category" name="category" required>
                    <optgroup label="Receitas (a receber)">{REVENUE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</optgroup>
                    <optgroup label="Despesas (a pagar)">{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</optgroup>
                  </Select>
                </Field>
                <Field label="Descrição" htmlFor="description" required><Input id="description" name="description" required minLength={3} maxLength={300} /></Field>
                <Field label="Valor (R$)" htmlFor="amount" required><Input id="amount" name="amount" type="number" step="0.01" min="0.01" required /></Field>
                <Field label="Competência" htmlFor="competence" required><Input id="competence" name="competence" type="month" defaultValue={periodOf(new Date())} required /></Field>
                <Field label="Vencimento" htmlFor="dueDate"><Input id="dueDate" name="dueDate" type="date" /></Field>
                <Field label="Unidade" htmlFor="siteId" hint="Sem unidade: despesa da rede, sem rateio com parceiros."><Select id="siteId" name="siteId"><option value="">— Rede (sem unidade) —</option>{opts.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
      {entries.length === 0 ? <EmptyState title="Nenhum lançamento encontrado" /> : (
        <Card>
          <Table>
            <thead><tr><th>Competência</th><th>Descrição</th><th>Unidade / parceiro</th><th>Situação</th><th className="text-right">Valor</th><th>Ações</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} id={e.id}>
                  <td className="text-xs">{e.competence}{e.adjustsPeriod && <p className="text-amber-700">ajusta {e.adjustsPeriod}</p>}</td>
                  <td><p className="text-navy-900">{e.description}</p><p className="text-xs text-navy-400">{KIND_LABEL[e.kind]} · {CATEGORY_LABEL[e.category]}{e.dueDate ? ` · vence ${date(e.dueDate)}` : ""}</p></td>
                  <td className="text-xs">{e.site?.name ?? "Rede"}{e.partnerOrganization && <p>{e.partnerOrganization.name}</p>}</td>
                  <td><Badge tone={e.status === "PAID" ? "green" : e.status === "CANCELLED" ? "neutral" : e.dueDate && e.dueDate < new Date() ? "red" : "amber"}>{ENTRY_STATUS_LABEL[e.status]}</Badge>{e.paidAt && <p className="mt-1 text-xs text-navy-400">{brl(e.paidAmount?.toString())} em {date(e.paidAt)} · {e.paymentNote}</p>}</td>
                  <td className="tabular text-right">{brl(e.amount.toString())}</td>
                  <td className="min-w-56">
                    {canWrite && e.status === "OPEN" && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-brand-700">Registrar baixa / cancelar</summary>
                        <ActionForm action={settleEntryAction} submitLabel="Registrar baixa" size="sm" confirm="Confirma que este valor JÁ foi pago/recebido fora da plataforma? A baixa não movimenta dinheiro." className="mt-2">
                          <input type="hidden" name="entryId" value={e.id} />
                          <Input name="paidAt" type="date" defaultValue={today} max={today} aria-label="Data da baixa" required />
                          <Input name="paidAmount" type="number" step="0.01" min="0.01" defaultValue={e.amount.toString()} aria-label="Valor baixado" required />
                          <Input name="note" placeholder="Referência (ex.: comprovante)" aria-label="Referência do pagamento" required minLength={3} />
                        </ActionForm>
                        {e.source !== "CLOSING" && (
                          <ActionForm action={cancelEntryAction} submitLabel="Cancelar lançamento" variant="danger" size="sm" confirm="Cancelar este lançamento? Ele permanece no histórico como cancelado." className="mt-3">
                            <input type="hidden" name="entryId" value={e.id} />
                            <Input name="reason" placeholder="Motivo" aria-label="Motivo do cancelamento" required minLength={5} />
                          </ActionForm>
                        )}
                      </details>
                    )}
                    {e.closingId && <Link className="text-xs text-brand-700 hover:underline" href={`/app/financeiro/fechamento/${e.closingId}`}>ver fechamento</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
