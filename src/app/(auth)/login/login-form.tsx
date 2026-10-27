"use client";
import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/action-result";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(loginAction, { status: "idle" });
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
      <Field label="Senha" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</Button>
    </form>
  );
}
