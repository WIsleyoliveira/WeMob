import { CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { ActionForm } from "@/components/app/action-form";
import { refreshPaymentAction } from "@/app/actions/driver";
import { brl } from "@/lib/format";

/** Cartão pendente: o pagamento acontece na página segura do Asaas; a WeMob nunca recebe os dados do cartão. */
export function CardPanel({ requestId, amount, invoiceUrl, sandbox }: { requestId: string; amount: string; invoiceUrl: string; sandbox: boolean }) {
  return (
    <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4" aria-labelledby="card-title">
      <h2 id="card-title" className="flex items-center gap-2 font-display font-semibold text-navy-900"><CreditCard className="size-5" aria-hidden />Pague com cartão</h2>
      {sandbox && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">Ambiente de testes do Asaas (sandbox): nenhum dinheiro real é movimentado.</p>}
      <p className="mt-2 text-sm text-navy-600">Valor: <b className="tabular text-navy-900">{brl(amount)}</b></p>
      <a href={invoiceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
        Abrir página de pagamento<ExternalLink className="size-4" aria-hidden />
      </a>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-navy-500"><ShieldCheck className="mt-px size-4 shrink-0 text-brand-700" aria-hidden />Os dados do cartão são digitados no Asaas, nosso parceiro de pagamentos. A WeMob não recebe nem guarda o número do cartão.</p>
      <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-xs text-navy-600">
        <li>Toque em “Abrir página de pagamento” (abre em outra aba).</li>
        <li>Preencha os dados do cartão e confirme.</li>
        <li>Volte para esta tela: ela confere o pagamento sozinha e a recarga começa assim que o cartão for aprovado.</li>
      </ol>
      <p className="mt-2 text-xs text-navy-500">Esse valor é o máximo da recarga. Ao final, a diferença não consumida é estornada no cartão (pode levar até 10 dias úteis para aparecer na fatura).</p>
      <ActionForm action={refreshPaymentAction} submitLabel="Já paguei — verificar agora" variant="secondary" size="sm" className="mt-3">
        <input type="hidden" name="requestId" value={requestId} />
      </ActionForm>
    </section>
  );
}
