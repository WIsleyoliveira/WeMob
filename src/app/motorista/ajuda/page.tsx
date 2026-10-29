import Link from "next/link";
import { getDriver } from "@/server/drivers/current";
import { getMyChargeRequest, getMySession, listMySessions, listMySupport } from "@/server/drivers/service";
import { supportAction } from "@/app/actions/driver";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { ButtonLink } from "@/components/ui/button";
import { dateTime } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import { TICKET_STATUS_LABEL } from "@/server/modules/support/tickets";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/cn";
import { HELP_TOPICS, HELP_TOPIC_KEYS, PHYSICAL_SAFETY_TEXT, parseHelpContext, type HelpTopic } from "@/domain/support/driver-help";

export const dynamic = "force-dynamic";

const FAQ: [string, string][] = [
  ["Como pago a recarga?", "Por Pix (QR Code ou copia e cola) ou cartão de crédito, na página segura do Asaas, nosso parceiro de pagamentos. O valor máximo da recarga é cobrado antes do início; a recarga começa assim que o pagamento é confirmado."],
  ["Quando recebo de volta a diferença?", "Ao encerrar, calculamos o valor pelo medidor do carregador e devolvemos automaticamente o que não foi consumido, por estorno. No cartão, o estorno pode levar até 10 dias úteis para aparecer na fatura."],
  ["A recarga não começou", "Verifique se o cabo está bem conectado ao veículo. Se o carregador não iniciar em até 3 minutos, o pedido é encerrado. Se você já pagou, nossa equipe analisa o caso e faz o estorno — fale com o suporte abaixo se precisar."],
  ["Paguei, mas a tela não mudou", "A tela confere o pagamento sozinha a cada poucos segundos. Se demorar, toque em “Já paguei — verificar agora”. Nunca pague a mesma cobrança duas vezes."],
  ["O valor cobrado é diferente do estimado", "Durante a recarga o custo é estimado. O valor final usa a leitura do medidor no encerramento e a tarifa vigente no início."],
];

export default async function AjudaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = parseHelpContext(await searchParams);
  const driver = await getDriver();
  const [sessions, tickets] = driver ? await Promise.all([listMySessions(driver), listMySupport(driver)]) : [[], []];
  // Contexto vindo do link "Problema com esta recarga?": só vale se for do próprio motorista (senão é ignorado).
  const session = driver && ctx.sessao ? await getMySession(driver, ctx.sessao).catch(() => null) : null;
  const request = driver && ctx.pedido && !session ? await getMyChargeRequest(driver, ctx.pedido) : null;
  const topic: HelpTopic | undefined = ctx.tipo;
  const keep = (extra: Record<string, string>) => {
    const q = new URLSearchParams({ ...(session ? { sessao: session.session.id } : request ? { pedido: request.id } : {}), ...extra });
    return `/motorista/ajuda?${q.toString()}#chamado`;
  };
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
        <section id="chamado" className="mt-4 scroll-mt-20 rounded-xl border border-navy-100 bg-white p-4">
          <h2 className="font-display font-semibold text-navy-900">Falar com o suporte</h2>
          {session && (
            <p className="mt-2 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-700" role="status">
              Sobre a recarga de {dateTime(session.session.startedAt)} em <b>{session.session.station.site.name}</b> (conector {session.session.connectorId}, transação {session.session.transactionId}). Já temos os dados dela; conte só o que aconteceu.
            </p>
          )}
          {request && (
            <p className="mt-2 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-700" role="status">
              Sobre o pedido de recarga de {dateTime(request.createdAt)} (referência {request.id}). Já temos os dados do pedido e do pagamento.
            </p>
          )}
          <p className="mt-3 text-sm font-medium text-navy-800">O que aconteceu?</p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Tipo de problema">
            {HELP_TOPIC_KEYS.map((k) => (
              <li key={k}>
                <Link href={keep({ tipo: k })} aria-current={topic === k ? "true" : undefined} className={cn("inline-block rounded-full border px-3 py-1.5 text-xs font-medium", topic === k ? "border-brand-600 bg-brand-50 text-brand-800" : "border-navy-200 bg-white text-navy-700")}>
                  {HELP_TOPICS[k].label}
                </Link>
              </li>
            ))}
          </ul>
          {topic && HELP_TOPICS[topic].guidance && <Alert tone="info" className="mt-3" title={HELP_TOPICS[topic].label}>{HELP_TOPICS[topic].guidance}</Alert>}
          {(topic === "SEM_RESPOSTA" || topic === "NAO_ENCERRA") && <Alert tone="warning" className="mt-3" title="Segurança">{PHYSICAL_SAFETY_TEXT}</Alert>}
          <ActionForm action={supportAction} submitLabel="Enviar" className="mt-3">
            {topic && <input type="hidden" name="topic" value={topic} />}
            {request && <input type="hidden" name="requestId" value={request.id} />}
            <Field label={topic && topic !== "OUTRO" ? "Assunto (opcional)" : "Assunto"} htmlFor="subject" hint={topic && topic !== "OUTRO" ? `O tipo “${HELP_TOPICS[topic].label}” já vai no assunto.` : undefined}>
              <Input id="subject" name="subject" required={!topic || topic === "OUTRO"} minLength={topic && topic !== "OUTRO" ? undefined : 3} maxLength={120} />
            </Field>
            {session ? (
              <input type="hidden" name="sessionId" value={session.session.id} />
            ) : !request && (
              <Field label="Recarga relacionada (opcional)" htmlFor="sessionId">
                <Select id="sessionId" name="sessionId" defaultValue=""><option value="">—</option>{sessions.slice(0, 20).map((s) => <option key={s.id} value={s.id}>{dateTime(s.startedAt)} · {s.station.site.name}</option>)}</Select>
              </Field>
            )}
            <Field label="Mensagem" htmlFor="message"><Textarea id="message" name="message" required minLength={10} /></Field>
          </ActionForm>
          {tickets.length > 0 && <ul className="mt-4 space-y-1 text-xs text-navy-600">{tickets.map((t) => <li key={t.id}>{dateTime(t.createdAt)} · {t.subject} · {(TICKET_STATUS_LABEL[t.status as keyof typeof TICKET_STATUS_LABEL] ?? t.status).toLowerCase()}</li>)}</ul>}
        </section>
      ) : <ButtonLink href="/motorista/entrar?voltar=/motorista/ajuda" className="mt-4 w-full">Entrar para abrir um chamado</ButtonLink>}
    </>
  );
}
