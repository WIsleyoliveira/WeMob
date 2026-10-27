import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Termos de uso" };

export default function TermosPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14 text-navy-700 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-navy-900 [&_p]:mt-3">
      <h1 className="font-display text-3xl font-bold text-navy-900">Termos de uso</h1>
      <Alert tone="warning" className="mt-6">Minuta técnica sujeita a revisão jurídica.</Alert>
      <h2>Simulações e projeções</h2>
      <p>O simulador produz estimativas a partir das premissas informadas pelo usuário e das condições comerciais vigentes publicadas. Projeções não constituem oferta, garantia de rentabilidade nem recomendação de investimento. As condições efetivas dependem de estudo de viabilidade e de contrato.</p>
      <h2>Informações comerciais</h2>
      <p>Valores de investimento, royalties, taxas e tributos são de referência e podem ser alterados para novos contratos, sem efeito sobre contratos já assinados.</p>
      <h2>Uso adequado</h2>
      <p>É proibido utilizar meios automatizados para enviar formulários ou tentar acessar áreas restritas sem autorização.</p>
    </article>
  );
}
