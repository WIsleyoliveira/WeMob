import { redirect } from "next/navigation";
import { getDriver } from "@/server/drivers/current";
import { DriverLoginForm } from "../auth-forms";

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const { voltar } = await searchParams;
  if (await getDriver()) redirect(voltar?.startsWith("/motorista") ? voltar : "/motorista");
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">Entrar</h1>
      <p className="text-sm text-navy-500">Acesse para iniciar recargas e ver seu histórico.</p>
      <DriverLoginForm voltar={voltar} />
    </>
  );
}
