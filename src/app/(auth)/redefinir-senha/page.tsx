import type { Metadata } from "next";
import Link from "next/link";
import { resetPasswordAction } from "@/app/actions/identity";
import { ActionForm } from "@/components/app/action-form";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Redefinir senha", robots: { index: false }, referrer: "no-referrer" };

export default async function RedefinirSenhaPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Definir nova senha" description="Mínimo de 12 caracteres, com letras e números.">
      {!token ? (
        <Alert tone="danger" className="mt-6">Link incompleto. Solicite um novo link ao administrador.</Alert>
      ) : (
        <ActionForm action={resetPasswordAction} submitLabel="Salvar nova senha" className="mt-6">
          <input type="hidden" name="token" value={token} />
          <Field label="Nova senha" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
          <Field label="Confirme a nova senha" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
        </ActionForm>
      )}
      <p className="mt-4 text-sm"><Link href="/login" className="text-brand-700 hover:underline">Ir para o login</Link></p>
    </AuthCard>
  );
}
