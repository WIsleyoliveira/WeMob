"use client";
import { useActionState, useState } from "react";
import { CreditCard, QrCode } from "lucide-react";
import { startChargeAction } from "@/app/actions/driver";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/action-result";

const METHOD = {
  PIX: { label: "Pix", hint: "QR Code ou copia e cola, confirmação na hora", Icon: QrCode },
  CARD: { label: "Cartão", hint: "Crédito, na página segura do Asaas", Icon: CreditCard },
} as const;
type Method = keyof typeof METHOD;

/** Início da recarga. Com gateway pré-pago, o motorista escolhe Pix ou cartão antes de pedir. */
export function StartForm({ identity, connectorId, label, disabled, methods = [] }: { identity: string; connectorId: number; label: string; disabled?: boolean; methods?: Method[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(startChargeAction, { status: "idle" });
  const [method, setMethod] = useState<Method>(methods[0] ?? "PIX");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="identity" value={identity} />
      <input type="hidden" name="connectorId" value={connectorId} />
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
      <Button type="submit" size="lg" className="w-full" disabled={pending || disabled}>{pending ? "Solicitando…" : label}</Button>
    </form>
  );
}
