import { Check, CircleX, CreditCard, PlugZap, Zap } from "lucide-react";
import { cn } from "@/lib/cn";

type Status = "AWAITING_PAYMENT" | "START_REQUESTED" | "STARTED" | "FAILED" | "CANCELLED" | "EXPIRED";

const STEPS = [
  { label: "Pagamento", Icon: CreditCard },
  { label: "Carregador", Icon: PlugZap },
  { label: "Recarga", Icon: Zap },
] as const;

/** Onde o pedido está: pagamento → carregador aceita o início → recarga. Estados finais sem sucesso marcam a etapa em que pararam. */
export function OrderProgress({ status, demo }: { status: Status; demo: boolean }) {
  const current = status === "AWAITING_PAYMENT" ? 0 : status === "START_REQUESTED" ? 1 : status === "STARTED" ? 2 : null;
  // Pedido encerrado sem recarga: expirou/cancelou antes do pagamento ou falhou no carregador.
  const stoppedAt = status === "FAILED" ? 1 : status === "CANCELLED" || status === "EXPIRED" ? 0 : null;
  return (
    <ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Andamento do pedido">
      {STEPS.map(({ label, Icon }, i) => {
        const skipped = demo && i === 0;
        const done = skipped || (current !== null && i < current) || (stoppedAt !== null && i < stoppedAt);
        const active = current === i;
        const stopped = stoppedAt === i;
        return (
          <li key={label} aria-current={active ? "step" : undefined} className="flex flex-col items-center gap-1.5 text-center">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full border-2",
                done && "border-brand-600 bg-brand-600 text-white",
                active && "border-brand-600 bg-brand-50 text-brand-700 motion-safe:animate-pulse",
                stopped && "border-red-300 bg-red-50 text-red-700",
                !done && !active && !stopped && "border-navy-200 bg-white text-navy-400",
              )}
            >
              {done ? <Check className="size-5" aria-hidden /> : stopped ? <CircleX className="size-5" aria-hidden /> : <Icon className="size-5" aria-hidden />}
            </span>
            <span className={cn("text-xs font-medium", active ? "text-navy-900" : "text-navy-500")}>
              {label}
              <span className="sr-only">{done ? " (concluído)" : active ? " (em andamento)" : stopped ? " (não concluído)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
