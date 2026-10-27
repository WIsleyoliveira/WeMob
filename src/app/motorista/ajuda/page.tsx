import { getDriver } from "@/server/drivers/current";
import { listMySessions, listMySupport } from "@/server/drivers/service";
import { supportAction } from "@/app/actions/driver";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { ButtonLink } from "@/components/ui/button";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AjudaPage() {
  const driver = await getDriver();
  const [sessions, tickets] = driver ? await Promise.all([listMySessions(driver), listMySupport(driver)]) : [[], []];
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">Ajuda</h1>
      <details className="mt-4 rounded-xl border border-navy-100 bg-white p-4 text-sm"><summary className="cursor-pointer font-medium">A recarga não começou</summary><p className="mt-2 text-navy-600">Verifique se o cabo está bem conectado ao veículo. Se o pedido ficar mais de 3 minutos aguardando o carregador, ele é cancelado e a reserva de valor é liberada.</p></details>
      <details className="mt-2 rounded-xl border border-navy-100 bg-white p-4 text-sm"><summary className="cursor-pointer font-medium">O valor cobrado é diferente do estimado</summary><p className="mt-2 text-navy-600">Durante a recarga o custo é estimado. O valor final usa a leitura do medidor no encerramento e a tarifa vigente no início.</p></details>
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
          {tickets.length > 0 && <ul className="mt-4 space-y-1 text-xs text-navy-600">{tickets.map((t) => <li key={t.id}>{dateTime(t.createdAt)} · {t.subject} · {t.status === "OPEN" ? "aberto" : t.status}</li>)}</ul>}
        </section>
      ) : <ButtonLink href="/motorista/entrar?voltar=/motorista/ajuda" className="mt-4 w-full">Entrar para abrir um chamado</ButtonLink>}
    </>
  );
}
