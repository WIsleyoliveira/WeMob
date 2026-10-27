"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/action-result";
import { cn } from "@/lib/cn";

/** Formulário ligado a uma server action, com estado de envio e mensagens de retorno. */
export function ActionForm({
  action,
  submitLabel,
  pendingLabel = "Salvando…",
  variant = "primary",
  size = "md",
  confirm,
  className,
  children,
}: {
  action: (prev: ActionState, f: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "danger" | "navy";
  size?: "sm" | "md";
  confirm?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { status: "idle" });
  return (
    <form
      action={formAction}
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state.status === "error" && (
        <Alert tone="danger">
          {state.message}
          {state.fieldErrors && (
            <ul className="mt-1 list-disc pl-5 text-xs">{Object.entries(state.fieldErrors).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
          )}
        </Alert>
      )}
      {state.status === "ok" && state.message && <Alert tone="success">{state.message}</Alert>}
      <div>
        <Button type="submit" variant={variant} size={size} disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
      </div>
    </form>
  );
}
