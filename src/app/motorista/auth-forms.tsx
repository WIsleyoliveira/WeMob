"use client";
import Link from "next/link";
import { useActionState } from "react";
import { driverLoginAction, driverSignupAction } from "@/app/actions/driver";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { ActionState } from "@/server/action-result";

export function DriverLoginForm({ voltar }: { voltar?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(driverLoginAction, { status: "idle" });
  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="voltar" value={voltar ?? ""} />
      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
      <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
      <Field label="Senha" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</Button>
      <p className="text-center text-sm">Não tem conta? <Link className="font-medium text-brand-700 underline" href={`/motorista/cadastro${voltar ? `?voltar=${encodeURIComponent(voltar)}` : ""}`}>Cadastre-se</Link></p>
    </form>
  );
}

export function DriverSignupForm({ voltar }: { voltar?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(driverSignupAction, { status: "idle" });
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};
  return (
    <form action={action} className="mt-4 flex flex-col gap-4">
      <input type="hidden" name="voltar" value={voltar ?? ""} />
      {state.status === "error" && <Alert tone="danger">{state.message}</Alert>}
      <Field label="Nome" htmlFor="name" error={fe.name}><Input id="name" name="name" autoComplete="name" required /></Field>
      <Field label="E-mail" htmlFor="email" error={fe.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Telefone (opcional)" htmlFor="phone"><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
      <Field label="Senha" htmlFor="password" hint="Mínimo de 12 caracteres, com letras e números." error={fe.password}><Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <label className="flex items-start gap-2 text-sm text-navy-600">
        <input type="checkbox" name="consent" className="mt-1 size-4 accent-brand-600" required />
        <span>Li e aceito os <a className="underline" href="/termos">termos de uso</a> e a <a className="underline" href="/privacidade">política de privacidade</a>.{fe.consent && <span className="block text-xs text-red-600">{fe.consent}</span>}</span>
      </label>
      <Button type="submit" size="lg" disabled={pending}>{pending ? "Criando conta…" : "Criar conta"}</Button>
    </form>
  );
}
