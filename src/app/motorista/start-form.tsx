"use client";
import { useActionState } from "react";
import { startChargeAction } from "@/app/actions/driver";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/action-result";

export function StartForm({ identity, connectorId, label, disabled }: { identity: string; connectorId: number; label: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(startChargeAction, { status: "idle" });
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="identity" value={identity} />
      <input type="hidden" name="connectorId" value={connectorId} />
      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
      <Button type="submit" size="lg" className="w-full" disabled={pending || disabled}>{pending ? "Solicitando…" : label}</Button>
    </form>
  );
}
