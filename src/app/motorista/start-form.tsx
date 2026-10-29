"use client";
import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { CreditCard, QrCode } from "lucide-react";
import { startChargeAction } from "@/app/actions/driver";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/action-result";
import { quoteByAmount } from "@/domain/charging/purchase";

const METHOD = {
  PIX: { label: "Pix", hint: "QR Code ou copia e cola, confirmação na hora", Icon: QrCode },
  CARD: { label: "Cartão", hint: "Crédito, na página segura do Asaas", Icon: CreditCard },
} as const;
type Method = keyof typeof METHOD;

/** B3 por valor: faixa (decisão da WAPE), margem do limite e tarifa vigente para o resumo. */
export type PurchaseInput = { min: string; max: string; margin: number; pricePerKwh: string; pricePerMin: string; prepaid: boolean };

const brl = (v: Decimal.Value) => new Decimal(v).toNumber().toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Resumo antes de pagar, calculado com a MESMA regra do servidor; o valor final é validado e recalculado lá. */
function PurchaseSummary({ value, p }: { value: string; p: PurchaseInput }) {
  let v: Decimal | null = null;
  try {
    v = new Decimal(value.replace(",", "."));
  } catch {
    v = null;
  }
  if (!value.trim()) return <p className="text-xs text-navy-500">Valor entre {brl(p.min)} e {brl(p.max)}.</p>;
  if (!v || !v.isFinite() || v.decimalPlaces() > 2) return <p className="text-sm text-red-700" role="alert">Use reais com até 2 casas decimais.</p>;
  if (v.lt(p.min) || v.gt(p.max)) return <p className="text-sm text-red-700" role="alert">Escolha um valor entre {brl(p.min)} e {brl(p.max)}.</p>;
  const q = quoteByAmount(v, { pricePerKwh: p.pricePerKwh, pricePerMin: p.pricePerMin }, p.margin);
  return (
    <dl className="grid gap-1 rounded-lg bg-navy-50 p-3 text-sm text-navy-800" aria-label="Resumo antes de pagar">
      <div className="flex justify-between gap-2"><dt>{p.prepaid ? "Você paga agora" : "Reservado agora no meio de pagamento"}</dt><dd className="font-semibold tabular">{brl(q.charged)}</dd></div>
      <div className="flex justify-between gap-2"><dt>A recarga para ao atingir</dt><dd className="tabular">{brl(q.limit)}</dd></div>
      <div className="flex justify-between gap-2">
        <dt>Energia estimada</dt>
        <dd className="tabular">{q.maxEnergyKwh ? `até ${q.maxEnergyKwh.toNumber().toLocaleString("pt-BR", { maximumFractionDigits: 3 })} kWh` : "sem estimativa (tarifa por minuto)"}</dd>
      </div>
      <dd className="text-xs text-navy-600">
        Margem de segurança de {Math.round(p.margin * 100)}% para a parada chegar a tempo. Tarifa de {brl(p.pricePerKwh)}/kWh{Number(p.pricePerMin) > 0 ? ` + ${brl(p.pricePerMin)}/min` : ""}, confirmada no início da recarga. A energia real depende do veículo. {p.prepaid ? "O que não for consumido é devolvido por estorno — no cartão, pode levar até 10 dias úteis." : "Ao final é cobrado só o valor apurado e o restante da reserva é liberado."}
      </dd>
    </dl>
  );
}

/** Início da recarga. Com gateway pré-pago, o motorista escolhe Pix ou cartão (e, se habilitado, o valor) antes de pedir. */
export function StartForm({ identity, connectorId, label, disabled, methods = [], purchase }: { identity: string; connectorId: number; label: string; disabled?: boolean; methods?: Method[]; purchase?: PurchaseInput }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(startChargeAction, { status: "idle" });
  const [method, setMethod] = useState<Method>(methods[0] ?? "PIX");
  const [amount, setAmount] = useState("");
  const amountId = `amount-${identity}-${connectorId}`;
  const invalidAmount = (() => {
    if (!purchase) return false;
    try {
      const v = new Decimal(amount.replace(",", "."));
      return !v.isFinite() || v.decimalPlaces() > 2 || v.lt(purchase.min) || v.gt(purchase.max);
    } catch {
      return true;
    }
  })();
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="identity" value={identity} />
      <input type="hidden" name="connectorId" value={connectorId} />
      {purchase && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={amountId} className="text-sm font-medium text-navy-800">Quanto você quer gastar (R$)</label>
          <input
            id={amountId}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled || pending}
            aria-invalid={amount.trim() !== "" && invalidAmount}
            className="h-12 w-full rounded-lg border border-navy-200 bg-white px-3 text-base text-navy-900 focus:border-tiffany-500 focus:outline-none focus:ring-2 focus:ring-tiffany-500/20 aria-[invalid=true]:border-red-500"
          />
          <PurchaseSummary value={amount} p={purchase} />
        </div>
      )}
      {methods.length > 0 && (
        <fieldset disabled={disabled || pending}>
          <legend className="text-sm font-medium text-navy-800">Forma de pagamento</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {methods.map((m) => {
              const { label: l, hint, Icon } = METHOD[m];
              const on = method === m;
              return (
                <label key={m} className={`flex cursor-pointer flex-col gap-1 rounded-xl border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 ${on ? "border-brand-600 bg-brand-50" : "border-navy-100 bg-white hover:border-navy-200"}`}>
                  <input type="radio" name="method" value={m} checked={on} onChange={() => setMethod(m)} className="sr-only" />
                  <span className="flex items-center gap-2 font-semibold text-navy-900"><Icon className="size-5" aria-hidden />{l}</span>
                  <span className="text-xs text-navy-600">{hint}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending || disabled || invalidAmount}>{pending ? "Solicitando…" : label}</Button>
    </form>
  );
}
