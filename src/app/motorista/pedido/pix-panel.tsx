import QRCode from "qrcode";
import { CopyButton } from "@/components/app/copy-button";
import { ActionForm } from "@/components/app/action-form";
import { refreshPaymentAction } from "@/app/actions/driver";
import { brl, dateTime } from "@/lib/format";

/** Pix pendente: QR Code (gerado a partir do código copia e cola devolvido pelo gateway), valor e validade. */
export async function PixPanel({ requestId, amount, payload, expiresAt, sandbox }: { requestId: string; amount: string; payload: string; expiresAt: Date | null; sandbox: boolean }) {
  const svg = await QRCode.toString(payload, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4" aria-labelledby="pix-title">
      <h2 id="pix-title" className="font-display font-semibold text-navy-900">Pague com Pix</h2>
      {sandbox && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">Ambiente de testes do Asaas (sandbox): nenhum dinheiro real é movimentado.</p>}
      <p className="mt-2 text-sm text-navy-600">Valor: <b className="tabular text-navy-900">{brl(amount)}</b>{expiresAt && <> · pague até <b>{dateTime(expiresAt)}</b></>}</p>
      <div className="mx-auto mt-3 size-56 max-w-full" role="img" aria-label="QR Code Pix" dangerouslySetInnerHTML={{ __html: svg }} />
      <label htmlFor="pix-code" className="mt-3 block text-sm font-medium text-navy-800">Pix copia e cola</label>
      <textarea id="pix-code" readOnly value={payload} rows={3} className="mt-1 w-full break-all rounded-lg border border-navy-200 bg-navy-50 p-2 font-mono text-xs" />
      <div className="mt-2"><CopyButton text={payload} label="Copiar código Pix" /></div>
      <ol className="mt-3 list-decimal space-y-0.5 pl-5 text-xs text-navy-600">
        <li>Abra o app do seu banco e escolha pagar com Pix (QR Code ou copia e cola).</li>
        <li>Confira o valor e confirme.</li>
        <li>Pronto: esta página confere o pagamento sozinha e a recarga começa assim que o banco confirmar.</li>
      </ol>
      <p className="mt-2 text-xs text-navy-500">Esse valor é o máximo reservado para a recarga. Ao final, a diferença não consumida é devolvida por estorno.</p>
      <ActionForm action={refreshPaymentAction} submitLabel="Já paguei — verificar agora" variant="secondary" size="sm" className="mt-3">
        <input type="hidden" name="requestId" value={requestId} />
      </ActionForm>
    </section>
  );
}
