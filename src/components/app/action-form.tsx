"use client";

import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ActionState } from "@/server/action-result";
import { cn } from "@/lib/cn";

/** Formulário ligado a uma server action, com estado de envio, confirmação opcional e mensagens de retorno. */
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
  const [asking, setAsking] = useState(false);
  const confirmed = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      action={formAction}
      aria-busy={pending}
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(e) => {
        if (confirm && !confirmed.current) {
          e.preventDefault();
          setAsking(true);
        }
        confirmed.current = false;
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
      {state.status === "ok" && state.message && <Alert tone="success"><span className="break-all">{state.message}</span></Alert>}
      <div>
        <Button type="submit" variant={variant} size={size} disabled={pending}>{pending ? pendingLabel : submitLabel}</Button>
      </div>
      {confirm && (
        <ConfirmDialog
          open={asking}
          title="Confirmar ação"
          description={confirm}
          confirmLabel={submitLabel}
          tone={variant === "danger" ? "danger" : "primary"}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            confirmed.current = true;
            formRef.current?.requestSubmit();
          }}
        />
      )}
    </form>
  );
}
