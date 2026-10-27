import type { Metadata } from "next";
import Link from "next/link";
import { requestResetAction } from "@/app/actions/identity";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input } from "@/components/ui/field";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Recuperar senha", robots: { index: false } };

export default function RecuperarSenhaPage() {
  return (
    <AuthCard title="Recuperar senha" description="Informe o e-mail de acesso.">
      <ActionForm action={requestResetAction} submitLabel="Continuar" pendingLabel="Enviando…" className="mt-6">
        <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required /></Field>
      </ActionForm>
      <p className="mt-4 text-sm"><Link href="/login" className="text-brand-700 hover:underline">← Voltar para o login</Link></p>
    </AuthCard>
  );
}
