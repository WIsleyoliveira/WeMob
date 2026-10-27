import { DriverSignupForm } from "../auth-forms";

export default async function CadastroPage({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  const { voltar } = await searchParams;
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">Criar conta</h1>
      <p className="text-sm text-navy-500">Conta de motorista da rede Sansol Mob.</p>
      <DriverSignupForm voltar={voltar} />
    </>
  );
}
