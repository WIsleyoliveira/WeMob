import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { ALERT_STATUS_LABEL, listAlerts } from "@/server/modules/alerts/engine";
import { ALERT_KIND_LABEL, describeRule, listAlertRules } from "@/server/modules/alerts/rules";
import { listNotifications } from "@/server/modules/alerts/notifications";
import { listAutomationRuns } from "@/server/modules/automation/runner";
import { CHANNEL_LABEL, defaultChannelAdapters } from "@/server/integrations/notify";
import { PRIORITY_LABEL } from "@/server/modules/support/tickets";
import { ackAlertAction, resolveAlertAction, runOperationsAction, updateRuleAction } from "@/app/actions/support";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { dateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const NOTIF_STATUS = { PENDING: "Pendente", SENT: "Enviada", FAILED: "Falhou (tentativas esgotadas)", SKIPPED_NOT_CONFIGURED: "Não enviada — canal não configurado", SKIPPED_NO_CONSENT: "Não enviada — sem consentimento" } as const;
const PARAM_LABEL: Record<string, string> = { minutes: "Minutos além do limite", count: "Nº de falhas", windowMinutes: "Janela (min)", minAvailability: "Disponibilidade mínima (%)", windowHours: "Janela (h)", staleAuthorizationHours: "Autorização pendente (h)" };

export default async function AlertasPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const ctx = await requirePage("alert:read");
  const sp = await searchParams;
  const [alerts, rules, notifications, runs] = await Promise.all([listAlerts(ctx, { status: sp.todos === "1" ? "all" : "open" }), listAlertRules(ctx), listNotifications(ctx), listAutomationRuns(ctx)]);
  const adapters = defaultChannelAdapters();
  const canConfigure = ctx.permissions.has("alert:configure");
  return (
    <>
      <PageHeader title="Alertas e automações" description="Regras avaliadas a cada minuto pelo processo do servidor OCPP (npm run ocpp:server). Alertas são deduplicados por chave; reaparição dentro do cooldown reabre o mesmo alerta sem nova notificação." />
      <Alert tone="info" className="mb-6" title="Canais de notificação">
        {Object.values(adapters).map((a) => `${CHANNEL_LABEL[a.channel]}: ${a.status === "configured" ? `configurado (${a.name})` : "NÃO configurado"}`).join(" · ")}. Nenhuma integração externa foi testada com envio real. Notificações só vão para quem consentiu em <Link className="underline" href="/app/conta">Minha conta</Link>.
      </Alert>
      {canConfigure && <ActionForm action={runOperationsAction} submitLabel="Executar avaliação agora" pendingLabel="Avaliando…" variant="secondary" className="mb-6" />}
      <Card className="mb-6">
        <CardHeader title={sp.todos === "1" ? "Todos os alertas" : "Alertas não resolvidos"} actions={<Link className="text-sm text-brand-700 hover:underline" href={sp.todos === "1" ? "/app/alertas" : "/app/alertas?todos=1"}>{sp.todos === "1" ? "Só não resolvidos" : "Ver todos"}</Link>} />
        {alerts.length === 0 ? <EmptyState title="Nenhum alerta" /> : (
          <Table>
            <thead><tr><th>Alerta</th><th>Status</th><th>Visto</th><th>Ticket</th><th>Ações</th></tr></thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td><Badge tone={a.severity === "CRITICAL" ? "red" : "amber"}>{a.severity === "CRITICAL" ? "Crítico" : "Atenção"}</Badge> <span className="font-medium text-navy-900">{a.title}</span><p className="text-xs text-navy-500">{ALERT_KIND_LABEL[a.kind]} · {a.detail}</p></td>
                  <td className="text-xs">{ALERT_STATUS_LABEL[a.status]}{a.escalatedAt && <p className="text-red-700">escalonado {dateTime(a.escalatedAt)}</p>}{a.resolvedReason && <p>{a.resolvedReason}</p>}</td>
                  <td className="text-xs">desde {dateTime(a.firstSeenAt)}<p>último {dateTime(a.lastSeenAt)} · {a.occurrences}×</p></td>
                  <td className="text-xs">{a.ticket ? <Link className="text-brand-700 hover:underline" href={`/app/suporte/${a.ticket.id}`}>{a.ticket.number}</Link> : "—"}</td>
                  <td className="min-w-48">
                    {a.status === "OPEN" && <ActionForm action={ackAlertAction} submitLabel="Reconhecer" size="sm" variant="secondary"><input type="hidden" name="alertId" value={a.id} /></ActionForm>}
                    {a.status !== "RESOLVED" && (
                      <details className="mt-2 text-sm"><summary className="cursor-pointer text-brand-700">Resolver</summary>
                        <ActionForm action={resolveAlertAction} submitLabel="Marcar resolvido" size="sm" className="mt-2"><input type="hidden" name="alertId" value={a.id} /><Input name="reason" placeholder="Como foi resolvido" aria-label="Como foi resolvido" required minLength={5} /></ActionForm>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <h2 className="mb-3 font-display text-lg font-semibold text-navy-900">Regras</h2>
      <div className="mb-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {rules.map((r) => {
          const params = r.params as Record<string, number>;
          return (
            <Card key={r.id}>
              <CardHeader title={<>{r.name} {!r.enabled && <Badge>desligada</Badge>}</>} description={describeRule(r.kind, params)} />
              <CardBody>
                {canConfigure ? (
                  <ActionForm action={updateRuleAction} submitLabel="Salvar regra" size="sm">
                    <input type="hidden" name="ruleId" value={r.id} />
                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      {Object.entries(params).map(([k, v]) => <label key={k}>{PARAM_LABEL[k] ?? k}<Input name={`param_${k}`} type="number" step="any" defaultValue={k === "minAvailability" ? v * 100 : v} className="mt-1" /></label>)}
                      <label>Cooldown (min)<Input name="cooldownMinutes" type="number" min="0" defaultValue={r.cooldownMinutes} className="mt-1" /></label>
                      <label>Escalonar após (min)<Input name="escalateAfterMinutes" type="number" min="1" defaultValue={r.escalateAfterMinutes ?? ""} placeholder="não escalonar" className="mt-1" /></label>
                      <label>Severidade<Select name="severity" defaultValue={r.severity} className="mt-1"><option value="WARNING">Atenção</option><option value="CRITICAL">Crítico</option></Select></label>
                      <label>Prioridade do ticket<Select name="ticketPriority" defaultValue={r.ticketPriority} className="mt-1">{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></label>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-1"><input type="checkbox" name="enabled" defaultChecked={r.enabled} /> Ativa</label>
                      <label className="flex items-center gap-1"><input type="checkbox" name="createTicket" defaultChecked={r.createTicket} /> Abrir ticket</label>
                      <label className="flex items-center gap-1"><input type="checkbox" name="includeNonProduction" defaultChecked={r.includeNonProduction} /> Incluir teste/simulação</label>
                    </div>
                    <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="text-xs text-navy-500">Notificar por</legend>{(["EMAIL", "SMS", "WHATSAPP"] as const).map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" name="notifyChannels" value={c} defaultChecked={r.notifyChannels.includes(c)} /> {CHANNEL_LABEL[c]}{adapters[c].status !== "configured" && <span className="text-xs text-amber-700">(não configurado)</span>}</label>)}</fieldset>
                  </ActionForm>
                ) : <p className="text-sm text-navy-500">Cooldown {r.cooldownMinutes} min · escalonamento {r.escalateAfterMinutes ? `${r.escalateAfterMinutes} min` : "não"} · ticket {r.createTicket ? "sim" : "não"} · canais {r.notifyChannels.join(", ") || "nenhum"}</p>}
              </CardBody>
            </Card>
          );
        })}
      </div>
      <div className="grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Notificações (últimas 100)" description="Registro de cada tentativa; falhas são retentadas com espera exponencial até 5 vezes." />
          {notifications.length === 0 ? <CardBody><p className="text-sm text-navy-500">Nenhuma notificação.</p></CardBody> : <Table><thead><tr><th>Quando</th><th>Canal</th><th>Assunto</th><th>Situação</th></tr></thead><tbody>{notifications.map((n) => <tr key={n.id}><td className="text-xs">{dateTime(n.createdAt)}</td><td>{CHANNEL_LABEL[n.channel]}</td><td className="text-xs">{n.subject}</td><td className="text-xs">{NOTIF_STATUS[n.status]} · {n.attempts}/{n.maxAttempts}{n.lastError && <p className="break-all text-navy-400">{n.lastError}</p>}</td></tr>)}</tbody></Table>}
        </Card>
        <Card>
          <CardHeader title="Execuções de automação" description="Cada execução registra início, fim, resultado ou erro e a tentativa (falhas consecutivas)." />
          {runs.length === 0 ? <CardBody><p className="text-sm text-navy-500">Nenhuma execução registrada. O ciclo roda dentro de <code>npm run ocpp:server</code>.</p></CardBody> : <Table><thead><tr><th>Início</th><th>Tarefa</th><th>Resultado</th></tr></thead><tbody>{runs.map((r) => <tr key={r.id}><td className="text-xs">{dateTime(r.startedAt)}</td><td className="text-xs">{r.job}</td><td className="text-xs"><Badge tone={r.status === "SUCCEEDED" ? "green" : r.status === "FAILED" ? "red" : "amber"}>{r.status}</Badge> tentativa {r.attempt}{r.error && <p className="break-all text-red-700">{r.error}</p>}{r.stats && <p className="break-all text-navy-400">{JSON.stringify(r.stats)}</p>}</td></tr>)}</tbody></Table>}
        </Card>
      </div>
    </>
  );
}
