import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePage } from "@/server/auth/current";
import { getStationDetail, sessionEnergyWh } from "@/server/modules/stations/service";
import { COMMAND_LABEL } from "@/server/modules/stations/commands";
import { remoteCommandAction, rotateSecretAction, upsertConnectorAction } from "@/app/actions/stations";
import { STATUS_LABEL, type ConnectorStatus } from "@/domain/stations/status";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { ConnectionBadge, ConnectorStatusBadge, EnvironmentBadge } from "@/components/app/station-badges";
import { dateTime, num } from "@/lib/format";

export const dynamic = "force-dynamic";
const CMD_TONE = { PENDING: "amber", SENT: "tiffany", ACCEPTED: "green", REJECTED: "red", TIMEOUT: "red", FAILED: "red", BLOCKED: "neutral" } as const;
const SESSION_LABEL = { ACTIVE: ["Ativa", "tiffany"], COMPLETED: ["Concluída", "green"], COMMUNICATION_LOST: ["Sem comunicação", "red"] } as const;

export default async function EstacaoPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePage("site:read");
  const s = await getStationDetail(ctx, (await params).id).catch(() => notFound());
  const isOp = ctx.orgKind === "OPERATOR";
  const canWrite = isOp && ctx.permissions.has("site:write");
  const canCommand = isOp && ctx.permissions.has("station:command");
  const commands = "commands" in s ? (s.commands as { id: string; type: keyof typeof COMMAND_LABEL; status: keyof typeof CMD_TONE; reason: string | null; createdAt: Date; completedAt: Date | null; response: unknown }[]) : [];
  const messages = "messages" in s ? (s.messages as { id: string; direction: string; action: string | null; messageId: string; receivedAt: Date; error: string | null }[]) : [];
  const active = s.sessions.filter((x) => x.status !== "COMPLETED");
  const wsUrl = `${process.env.OCPP_PUBLIC_URL ?? "ws://<host>:9220"}/ocpp/${s.ocppIdentity}`;
  const prodConfirm = s.environment === "PRODUCTION";

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Unidades", href: "/app/unidades" }, { label: s.site.name, href: `/app/unidades/${s.site.id}` }, { label: s.ocppIdentity }]}
        title={s.ocppIdentity}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EnvironmentBadge env={s.environment} /> <ConnectionBadge fresh={s.fresh} state={s.connectionState} />
            {[s.vendor, s.model, s.serialNumber && `nº ${s.serialNumber}`, s.firmwareVersion && `firmware ${s.firmwareVersion}`].filter(Boolean).join(" · ") || "Equipamento ainda não se identificou (BootNotification)"}
          </span>
        }
      />
      {s.environment !== "PRODUCTION" && <Alert tone="warning" className="mb-4" title={`Estação ${s.environment === "SIMULATED" ? "simulada" : "de teste"}`}>Sessões e telemetria desta estação não entram nos indicadores de produção.</Alert>}
      {s.protocol !== "OCPP16J" && <Alert tone="info" className="mb-4" title="Sem adaptador de protocolo">{s.protocol === "OCPP201" ? "OCPP 2.0.1 está cadastrado mas o adaptador não foi implementado nem testado." : "Estação sem integração: status desconhecido."}</Alert>}
      {s.clockSkewMs && s.clockSkewMs > 60_000 && <Alert tone="warning" className="mb-4" title="Relógio do carregador adiantado">~{Math.round(s.clockSkewMs / 1000)} s à frente do servidor. A ordem dos eventos usa o relógio do carregador; a detecção de falta de comunicação usa o do servidor.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Conectores" description={s.fresh ? `Última mensagem ${s.lastSeenAt ? dateTime(s.lastSeenAt) : "—"}` : "Sem comunicação recente: status exibido como desconhecido."} />
            <Table>
              <thead><tr><th>#</th><th>Tipo</th><th className="text-right">Potência</th><th>Status</th><th>Último reporte</th></tr></thead>
              <tbody>
                {s.connectors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.connectorId}</td>
                    <td>{c.type} {Number(c.maxPowerKw) === 0 && <Badge tone="amber">cadastro incompleto</Badge>}</td>
                    <td className="tabular text-right">{num(Number(c.maxPowerKw), 0)} kW</td>
                    <td><ConnectorStatusBadge status={c.effective.status} />{c.errorCode && <span className="ml-1 text-xs text-red-700">{c.errorCode}</span>}{c.effective.stale && c.status !== "UNKNOWN" && <p className="text-xs text-navy-500">último reportado: {STATUS_LABEL[c.status as ConnectorStatus]}</p>}</td>
                    <td className="text-xs">{c.statusReceivedAt ? dateTime(c.statusReceivedAt) : "nunca"}</td>
                  </tr>
                ))}
                {s.connectors.length === 0 && <tr><td colSpan={5} className="text-navy-500">Nenhum conector cadastrado.</td></tr>}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Sessões de recarga" description="Energia = medidor final (ou última leitura) − medidor inicial." />
            <Table>
              <thead><tr><th>Transação</th><th>Conector</th><th>Início</th><th>Fim</th><th className="text-right">Energia</th><th>Status</th></tr></thead>
              <tbody>
                {s.sessions.map((x) => (
                  <tr key={x.id}>
                    <td className="tabular">{x.transactionId}</td>
                    <td>{x.connectorId}</td>
                    <td className="text-xs">{dateTime(x.startedAt)}</td>
                    <td className="text-xs">{x.stoppedAt ? dateTime(x.stoppedAt) : "—"}{x.stopReason && <span className="block text-navy-500">{x.stopReason}</span>}</td>
                    <td className="tabular text-right">{num(sessionEnergyWh(x) / 1000, 3)} kWh{x.status !== "COMPLETED" && <span className="block text-xs text-navy-500">parcial</span>}</td>
                    <td><Badge tone={SESSION_LABEL[x.status][1]}>{SESSION_LABEL[x.status][0]}</Badge></td>
                  </tr>
                ))}
                {s.sessions.length === 0 && <tr><td colSpan={6} className="text-navy-500">Nenhuma sessão registrada.</td></tr>}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Histórico de status (últimos eventos por conector)" />
            <Table>
              <thead><tr><th>Conector</th><th>Status</th><th>Horário do carregador</th><th>Recebido</th><th>Aplicado</th></tr></thead>
              <tbody>
                {s.connectors.flatMap((c) => c.statusEvents.map((e) => (
                  <tr key={e.id}>
                    <td>{c.connectorId}</td>
                    <td><ConnectorStatusBadge status={e.status as ConnectorStatus} />{e.errorCode && <span className="ml-1 text-xs">{e.errorCode}</span>}</td>
                    <td className="text-xs">{e.chargerTime ? dateTime(e.chargerTime) : "—"}</td>
                    <td className="text-xs">{dateTime(e.receivedAt)}</td>
                    <td>{e.applied ? "sim" : <Badge tone="amber">fora de ordem</Badge>}</td>
                  </tr>
                )))}
              </tbody>
            </Table>
          </Card>
          {isOp && (
            <Card>
              <CardHeader title="Mensagens OCPP recentes" description="Correlação por UniqueId. Payloads ficam no banco para auditoria." />
              <Table className="text-xs">
                <thead><tr><th>Recebida</th><th>Direção</th><th>Ação</th><th>UniqueId</th><th>Observação</th></tr></thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id}><td>{dateTime(m.receivedAt)}</td><td>{m.direction === "IN" ? "carregador → CSMS" : "CSMS → carregador"}</td><td>{m.action ?? "—"}</td><td className="font-mono">{m.messageId.slice(0, 12)}</td><td className={m.error ? "text-amber-800" : ""}>{m.error ?? ""}</td></tr>
                  ))}
                  {messages.length === 0 && <tr><td colSpan={5} className="text-navy-500">Nenhuma mensagem recebida.</td></tr>}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {canCommand && s.protocol === "OCPP16J" && (
            <Card>
              <CardHeader title="Comandos remotos" description="Validados no servidor (permissão, comunicação e estado) e registrados com solicitante e resposta." />
              <CardBody className="flex flex-col gap-5">
                {prodConfirm && <Alert tone="danger" title="Equipamento de produção">Comandos exigem permissão específica, habilitação do ambiente (OCPP_ALLOW_PRODUCTION_COMMANDS) e confirmação.</Alert>}
                {active.map((x) => (
                  <ActionForm key={x.id} action={remoteCommandAction} submitLabel={`Encerrar transação ${x.transactionId}`} variant="secondary" size="sm" confirm={`Encerrar remotamente a transação ${x.transactionId}?`}>
                    <input type="hidden" name="type" value="REMOTE_STOP" /><input type="hidden" name="stationId" value={s.id} /><input type="hidden" name="transactionId" value={x.transactionId} />
                    {prodConfirm && <input type="hidden" name="confirm" value="true" />}
                  </ActionForm>
                ))}
                <ActionForm action={remoteCommandAction} submitLabel="Iniciar recarga remota" variant="secondary" size="sm" confirm="Iniciar recarga remota neste conector?">
                  <input type="hidden" name="type" value="REMOTE_START" /><input type="hidden" name="stationId" value={s.id} />
                  {prodConfirm && <input type="hidden" name="confirm" value="true" />}
                  <div className="grid grid-cols-[5rem_1fr] gap-2">
                    <Field label="Conector" htmlFor="rs-c"><Input id="rs-c" name="connectorId" inputMode="numeric" defaultValue="1" /></Field>
                    <Field label="idTag" htmlFor="rs-t" hint={s.environment === "PRODUCTION" ? "Produção: sem cadastro de cartões, será recusado." : "Simulado/teste: use prefixo SIM- ou TEST-."}><Input id="rs-t" name="idTag" required maxLength={20} /></Field>
                  </div>
                </ActionForm>
                <ActionForm action={remoteCommandAction} submitLabel="Destravar conector" variant="secondary" size="sm" confirm="Destravar o conector informado?">
                  <input type="hidden" name="type" value="UNLOCK_CONNECTOR" /><input type="hidden" name="stationId" value={s.id} />
                  {prodConfirm && <input type="hidden" name="confirm" value="true" />}
                  <Field label="Conector" htmlFor="ul-c"><Input id="ul-c" name="connectorId" inputMode="numeric" defaultValue="1" /></Field>
                </ActionForm>
                <ActionForm action={remoteCommandAction} submitLabel="Alterar disponibilidade" variant="secondary" size="sm" confirm="Alterar a disponibilidade do conector?">
                  <input type="hidden" name="type" value="CHANGE_AVAILABILITY" /><input type="hidden" name="stationId" value={s.id} />
                  {prodConfirm && <input type="hidden" name="confirm" value="true" />}
                  <div className="grid grid-cols-[5rem_1fr] gap-2">
                    <Field label="Conector" htmlFor="ca-c" hint="0 = estação"><Input id="ca-c" name="connectorId" inputMode="numeric" defaultValue="1" /></Field>
                    <Field label="Disponibilidade" htmlFor="ca-a"><Select id="ca-a" name="availability"><option value="Operative">Operante</option><option value="Inoperative">Inoperante</option></Select></Field>
                  </div>
                </ActionForm>
                <ActionForm action={remoteCommandAction} submitLabel="Reiniciar carregador" variant="danger" size="sm" confirm="Reiniciar o carregador? Sessões em andamento podem ser interrompidas.">
                  <input type="hidden" name="type" value="RESET" /><input type="hidden" name="stationId" value={s.id} /><input type="hidden" name="confirm" value="true" />
                  <Select name="resetType" aria-label="Tipo de reinício" defaultValue="Soft"><option value="Soft">Suave (Soft)</option><option value="Hard">Completo (Hard)</option></Select>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {isOp && (
            <Card>
              <CardHeader title="Histórico de comandos" />
              <CardBody>
                {commands.length === 0 ? <p className="text-sm text-navy-500">Nenhum comando.</p> : (
                  <ul className="divide-y divide-navy-50 text-sm">
                    {commands.map((c) => (
                      <li key={c.id} className="py-2">
                        <div className="flex items-center justify-between gap-2"><span>{COMMAND_LABEL[c.type]}</span><Badge tone={CMD_TONE[c.status]}>{c.status}</Badge></div>
                        <p className="text-xs text-navy-500">{dateTime(c.createdAt)}{c.completedAt ? ` → ${dateTime(c.completedAt)}` : ""}{c.reason ? ` · ${c.reason}` : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}
          {canWrite && (
            <Card>
              <CardHeader title="Conector" description="Cadastro técnico. O status vem somente do carregador." />
              <CardBody>
                <ActionForm action={upsertConnectorAction} submitLabel="Salvar conector" variant="secondary" size="sm">
                  <input type="hidden" name="stationId" value={s.id} />
                  <div className="grid grid-cols-3 gap-2">
                    <Field label="Nº" htmlFor="cn"><Input id="cn" name="connectorId" inputMode="numeric" required /></Field>
                    <Field label="Tipo" htmlFor="ct"><Select id="ct" name="type"><option>CCS2</option><option>TYPE2</option><option>CHADEMO</option><option>GBT</option><option>OTHER</option></Select></Field>
                    <Field label="kW" htmlFor="ck"><Input id="ck" name="maxPowerKw" inputMode="decimal" required /></Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {canWrite && s.protocol === "OCPP16J" && (
            <Card>
              <CardHeader title="Conexão OCPP 1.6-J" />
              <CardBody className="flex flex-col gap-3 text-sm">
                <dl className="space-y-1 text-xs">
                  <div><dt className="inline text-navy-500">URL: </dt><dd className="inline break-all font-mono">{wsUrl}</dd></div>
                  <div><dt className="inline text-navy-500">Subprotocolo: </dt><dd className="inline font-mono">ocpp1.6</dd></div>
                  <div><dt className="inline text-navy-500">Autenticação: </dt><dd className="inline">HTTP Basic (usuário = identidade). {s.hasSecret ? "Senha configurada." : "Sem senha."}</dd></div>
                </dl>
                <p className="text-xs text-navy-500">Em produção use wss:// (TLS no proxy). Para testar localmente: <code>npm run ocpp:server</code> e <code>npm run ocpp:simulate -- {s.ocppIdentity} &lt;senha&gt;</code> (só para estações simuladas).</p>
                <ActionForm action={rotateSecretAction} submitLabel="Gerar nova senha" variant="secondary" size="sm" confirm="Gerar nova senha OCPP? O carregador precisará ser reconfigurado.">
                  <input type="hidden" name="stationId" value={s.id} />
                </ActionForm>
              </CardBody>
            </Card>
          )}
          <p className="text-xs text-navy-500"><Link className="underline" href="/app/operacao">Ver painel de operação →</Link></p>
        </div>
      </div>
    </>
  );
}
