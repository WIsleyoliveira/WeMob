import Link from "next/link";
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-white px-4 text-center">
      <div>
        <p className="font-display text-5xl font-bold text-brand-600">404</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-navy-900">Página não encontrada</h1>
        <p className="mt-2 text-navy-500">O endereço pode ter mudado ou o registro não existe para a sua organização.</p>
        <Link href="/" className="mt-6 inline-block rounded-lg bg-navy-900 px-4 py-2 font-medium text-white hover:bg-navy-800">Ir para o início</Link>
      </div>
    </div>
  );
}
