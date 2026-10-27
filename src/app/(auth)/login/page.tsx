import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/server/auth/current";
import { Logo } from "@/components/ui/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

export default async function LoginPage() {
  if (await getCurrentContext()) redirect("/app");
  return (
    <div className="grid min-h-dvh place-items-center bg-navy-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center"><Logo inverted /></div>
        <div className="rounded-[var(--radius-card)] bg-white p-6 shadow-xl">
          <h1 className="font-display text-xl font-semibold text-navy-900">Acesso à plataforma</h1>
          <p className="mt-1 text-sm text-navy-500">Equipe Sansol Mob, investidores e parceiros.</p>
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-navy-400">Esqueceu a senha? Solicite a redefinição ao administrador da sua organização.</p>
      </div>
    </div>
  );
}
