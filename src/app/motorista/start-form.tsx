"use client";
import { useActionState, useState } from "react";
import Decimal from "decimal.js";
import { CreditCard, QrCode } from "lucide-react";
import { startChargeAction } from "@/app/actions/driver";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/action-result";
import { parseAmount, quoteByAmount } from "@/domain/charging/purchase";
import { cn } from "@/lib/cn";

const METHOD = {
  PIX: { label: "Pix", hint: "QR Code ou copia e cola, confirmação na hora", Icon: QrCode },
  CARD: { label: "Cartão", hint: "Crédito, na página segura do Asaas", Icon: CreditCard },
} as const;
type Method = keyof typeof METHOD;

/** B3 por valor: faixa do ambiente, atalhos, margem do limite e tarifa vigente para o resumo. */
export type PurchaseInput = {
  min: string;
  max: string;
  suggested: string | null;
  shortcuts: string[];
  /** Perfil de EXEMPLO (não comercial): a tela identifica. */
  example: boolean;
  margin: number;
  pricePerKwh: string;
  pricePerMin: string;
  prepaid: boolean;
};

const brl = (v: Decimal.Value) => new Decimal(v).toNumber().toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const kwh = (v: Decimal) => `${v.toNumber().toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kWh`;

/** Resumo antes de pagar, com a MESMA regra do servidor (que valida e recalcula o valor de novo). */
function PurchaseSummary({ value, p }: { value: string; p: PurchaseInput }) {
  const v = parseAmount(value.trim());
  if (!value.trim()) return <p className="text-sm text-navy-600">Escolha um valor entre {brl(p.min)} e {brl(p.max)}.</p>;
  if (!v) return <p className="text-sm font-medium text-red-700" role="alert">Digite só números, com até 2 casas decimais (ex.: 50 ou 37,50).</p>;
  if (v.lt(p.min) || v.gt(p.max)) return <p className="text-sm font-medium text-red-700" role="alert">Escolha um valor entre {brl(p.min)} e {brl(p.max)}.</p>;
  const q = quoteByAmount(v, { pricePerKwh: p.pricePerKwh, pricePerMin: p.pricePerMin }, p.margin);
  const perKwh = new Decimal(p.pricePerKwh);
  const timeTariff = new Decimal(p.pricePerMin).gt(0);
  const equivalent = !timeTariff && perKwh.gt(0) ? q.charged.div(perKwh).toDecimalPlaces(2, Decimal.ROUND_DOWN) : null;
  return (
    <section className="rounded-xl border border-navy-100 bg-navy-50/60 p-4" aria-label="Resumo antes de pagar">
      <h3 className="text-sm font-semibold text-navy-900">Resumo antes de pagar</h3>
      <dl className="mt-2 grid gap-1.5 text-sm text-navy-800">
        <div className="flex justify-between gap-3"><dt>{p.prepaid ? "Você paga agora" : "Reservado agora no meio de pagamento"}</dt><dd className="tabular font-semibold">{brl(q.charged)}</dd></div>
        {equivalent && <div className="flex justify-between gap-3"><dt>Equivale a</dt><dd className="tabular">{kwh(equivalent)} a {brl(perKwh)}/kWh</dd></div>}
        <div className="flex justify-between gap-3"><dt>A recarga para ao atingir</dt><dd className="tabular">{brl(q.limit)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Energia estimada</dt><dd className="tabular font-medium">{q.maxEnergyKwh ? `até ${kwh(q.maxEnergyKwh)}` : "depende da duração"}</dd></div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-navy-600">
        Para a recarga parar a tempo, ela é encerrada {Math.round(p.margin * 100)}% antes do valor escolhido. A energia real depende do veículo e da potência disponível
        {timeTariff ? `, e há cobrança de ${brl(p.pricePerMin)} por minuto` : ""}. A tarifa é confirmada quando o carregador inicia.{" "}
        {p.prepaid ? "Você paga só o que consumir: a diferença volta por estorno — no cartão, pode levar até 10 dias úteis." : "Ao final é cobrado só o valor consumido e o restante da reserva é liberado."}
      </p>
    </section>
  );
}

/** Início da recarga: valor (se habilitado no ambiente), forma de pagamento e confirmação. */
export function StartForm({ identity, connectorId, label, disabled, methods = [], purchase }: { identity: string; connectorId: number; label: string; disabled?: boolean; methods?: Method[]; purchase?: PurchaseInput }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(startChargeAction, { status: "idle" });
  const [method, setMethod] = useState<Method>(methods[0] ?? "PIX");
  const [amount, setAmount] = useState(purchase?.suggested ? purchase.suggested.replace(".", ",") : "");
  const amountId = `amount-${identity}-${connectorId}`;
  const invalidAmount = (() => {
    if (!purchase) return false;
    const v = parseAmount(amount.trim()); // mesma leitura do servidor
    return !v || v.lt(purchase.min) || v.gt(purchase.max);
  })();
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="identity" value={identity} />
      <input type="hidden" name="connectorId" value={connectorId} />
      {purchase && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={amountId} className="text-sm font-semibold text-navy-900">Quanto você quer gastar (R$)</label>
            {purchase.example && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">Exemplo — não comercial</span>}
          </div>
          {purchase.shortcuts.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Valores sugeridos">
              {purchase.shortcuts.map((v) => {
                const shown = v.replace(".", ",");
                const on = amount.trim() === shown || amount.trim() === v;
                return (
                  <button key={v} type="button" onClick={() => setAmount(shown)} disabled={disabled || pending} aria-pressed={on} className={cn("min-h-11 rounded-full border-2 px-4 text-sm font-semibold tabular transition-colors", on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-navy-200 bg-white text-navy-800 hover:border-navy-300")}>
                    {brl(v)}
                  </button>
                );
              })}
            </div>
          )}
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-navy-500" aria-hidden>R$</span>
            <input
              id={amountId}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onBlur={(e) => setAmount(e.target.value.trim())}
              disabled={disabled || pending}
              aria-invalid={amount.trim() !== "" && invalidAmount}
              aria-describedby={`${amountId}-hint`}
              className="h-12 w-full rounded-lg border border-navy-200 bg-white pl-10 pr-3 text-lg font-semibold tabular text-navy-900 focus:border-tiffany-500 focus:outline-none focus:ring-2 focus:ring-tiffany-500/20 aria-[invalid=true]:border-red-500"
            />
          </div>
          <div id={`${amountId}-hint`}><PurchaseSummary value={amount} p={purchase} /></div>
        </div>
      )}
      {methods.length > 0 && (
        <fieldset disabled={disabled || pending}>
          <legend className="text-sm font-semibold text-navy-900">Forma de pagamento</legend>
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
