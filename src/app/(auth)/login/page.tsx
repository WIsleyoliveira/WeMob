import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/server/auth/current";
import { LoginForm } from "./login-form";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

export default async function LoginPage() {
  if (await getCurrentContext()) redirect("/app");
  return (
    <AuthCard title="Acesso à plataforma" description="Equipe Sansol Mob, investidores e parceiros.">
      <LoginForm />
      <p className="mt-4 text-sm"><Link href="/recuperar-senha" className="text-brand-700 hover:underline">Esqueci minha senha</Link></p>
    </AuthCard>
  );
}
