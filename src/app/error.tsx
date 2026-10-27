"use client";
export default function RootError({ reset }: { reset: () => void }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-white px-4 text-center">
      <div>
        <h1 className="font-display text-2xl font-semibold text-navy-900">Algo deu errado</h1>
        <p className="mt-2 text-navy-500">O serviço pode estar temporariamente indisponível.</p>
        <button onClick={reset} className="mt-6 rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">Tentar novamente</button>
      </div>
    </div>
  );
}
