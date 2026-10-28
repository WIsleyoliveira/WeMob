import { getDriver } from "@/server/drivers/current";
import { listMySessions, listMySupport } from "@/server/drivers/service";
import { supportAction } from "@/app/actions/driver";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { ButtonLink } from "@/components/ui/button";
import { dateTime } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import { TICKET_STATUS_LABEL } from "@/server/modules/support/tickets";

export const dynamic = "force-dynamic";

const FAQ: [string, string][] = [
  ["Como pago a recarga?", "Por Pix (QR Code ou copia e cola) ou cartão de crédito, na página segura do Asaas, nosso parceiro de pagamentos. O valor máximo da recarga é cobrado antes do início; a recarga começa assim que o pagamento é confirmado."],
  ["Quando recebo de volta a diferença?", "Ao encerrar, calculamos o valor pelo medidor do carregador e devolvemos automaticamente o que não foi consumido, por estorno. No cartão, o estorno pode levar até 10 dias úteis para aparecer na fatura."],
  ["A recarga não começou", "Verifique se o cabo está bem conectado ao veículo. Se o carregador não iniciar em até 3 minutos, o pedido é encerrado. Se você já pagou, nossa equipe analisa o caso e faz o estorno — fale com o suporte abaixo se precisar."],
  ["Paguei, mas a tela não mudou", "A tela confere o pagamento sozinha a cada poucos segundos. Se demorar, toque em “Já paguei — verificar agora”. Nunca pague a mesma cobrança duas vezes."],
  ["O valor cobrado é diferente do estimado", "Durante a recarga o custo é estimado. O valor final usa a leitura do medidor no encerramento e a tarifa vigente no início."],
];

export default async function AjudaPage() {
  const driver = await getDriver();
  const [sessions, tickets] = driver ? await Promise.all([listMySessions(driver), listMySupport(driver)]) : [[], []];
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">Ajuda</h1>
      <section className="mt-4 flex flex-col gap-2" aria-label="Perguntas frequentes">
        {FAQ.map(([q, a]) => (
          <details key={q} className="group rounded-xl border border-navy-100 bg-white text-sm open:shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-medium text-navy-900 [&::-webkit-details-marker]:hidden">
              {q}
              <ChevronDown className="size-4 shrink-0 text-navy-500 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <p className="px-4 pb-4 leading-relaxed text-navy-600">{a}</p>
          </details>
        ))}
      </section>
      {driver ? (
        <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4">
          <h2 className="font-display font-semibold text-navy-900">Falar com o suporte</h2>
          <ActionForm action={supportAction} submitLabel="Enviar" className="mt-2">
            <Field label="Assunto" htmlFor="subject"><Input id="subject" name="subject" required minLength={3} /></Field>
            <Field label="Recarga relacionada (opcional)" htmlFor="sessionId">
              <Select id="sessionId" name="sessionId" defaultValue=""><option value="">—</option>{sessions.slice(0, 20).map((s) => <option key={s.id} value={s.id}>{dateTime(s.startedAt)} · {s.station.site.name}</option>)}</Select>
            </Field>
            <Field label="Mensagem" htmlFor="message"><Textarea id="message" name="message" required minLength={10} /></Field>
          </ActionForm>
          {tickets.length > 0 && <ul className="mt-4 space-y-1 text-xs text-navy-600">{tickets.map((t) => <li key={t.id}>{dateTime(t.createdAt)} · {t.subject} · {(TICKET_STATUS_LABEL[t.status as keyof typeof TICKET_STATUS_LABEL] ?? t.status).toLowerCase()}</li>)}</ul>}
        </section>
      ) : <ButtonLink href="/motorista/entrar?voltar=/motorista/ajuda" className="mt-4 w-full">Entrar para abrir um chamado</ButtonLink>}
    </>
  );
}
