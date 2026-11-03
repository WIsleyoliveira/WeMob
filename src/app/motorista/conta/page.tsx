import { requireDriverPage } from "@/server/drivers/current";
import { getProfile } from "@/server/drivers/service";
import { setDocumentAction, addVehicleAction, deleteDriverAccountAction, driverLogoutAction, removeVehicleAction, revokeDeviceAction, revokeOtherDevicesAction, updateProfileAction } from "@/app/actions/driver";
import { listMyDevices } from "@/server/drivers/auth";
import { Badge } from "@/components/ui/badge";
import { dateTime } from "@/lib/format";
import { Field, Input } from "@/components/ui/field";
import { ActionForm } from "@/components/app/action-form";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";
const TYPES = ["CCS2", "TYPE2", "CHADEMO", "GBT"] as const;

export default async function ContaPage() {
  const driver = await requireDriverPage("/motorista/conta");
  const [p, devices] = await Promise.all([getProfile(driver), listMyDevices(driver)]);
  const others = devices.filter((d) => !d.current).length;
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">Minha conta</h1>
      <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4">
        <ActionForm action={updateProfileAction} submitLabel="Salvar" variant="secondary" size="sm">
          <Field label="Nome" htmlFor="name"><Input id="name" name="name" defaultValue={p.name} required /></Field>
          <Field label="Telefone" htmlFor="phone"><Input id="phone" name="phone" type="tel" defaultValue={p.phone ?? ""} /></Field>
          <p className="text-sm text-navy-500">E-mail: {p.email}</p>
        </ActionForm>
      </section>
      <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4">
        <h2 className="font-display font-semibold text-navy-900">Veículos</h2>
        <ul className="mt-2 divide-y divide-navy-50">
          {p.vehicles.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span>{v.label} <span className="text-navy-500">· {v.connectorTypes.join(", ")}{v.batteryKwh ? ` · ${v.batteryKwh} kWh` : ""}</span></span>
              <ActionForm action={removeVehicleAction} submitLabel="Remover" variant="secondary" size="sm"><input type="hidden" name="vehicleId" value={v.id} /></ActionForm>
            </li>
          ))}
          {p.vehicles.length === 0 && <li className="py-2 text-sm text-navy-500">Nenhum veículo cadastrado.</li>}
        </ul>
        <ActionForm action={addVehicleAction} submitLabel="Adicionar veículo" variant="secondary" size="sm" className="mt-3">
          <Field label="Veículo" htmlFor="label"><Input id="label" name="label" placeholder="Ex.: BYD Dolphin 2024" required /></Field>
          <fieldset className="text-sm"><legend className="mb-1 font-medium text-navy-800">Conectores compatíveis</legend>
            <div className="flex flex-wrap gap-3">{TYPES.map((t) => <label key={t} className="flex items-center gap-1.5"><input type="checkbox" name="connectorTypes" value={t} className="size-4 accent-brand-600" defaultChecked={t === "CCS2"} />{t}</label>)}</div>
          </fieldset>
          <Field label="Bateria (kWh, opcional)" htmlFor="batteryKwh"><Input id="batteryKwh" name="batteryKwh" inputMode="decimal" /></Field>
        </ActionForm>
      </section>
      <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4">
        <h2 className="font-display font-semibold text-navy-900">CPF/CNPJ para pagamento</h2>
        <p className="mt-1 text-sm text-navy-600">Exigido pelo gateway para emitir as cobranças (Pix ou cartão). Fica cifrado; exibimos só os últimos dígitos.</p>
        <p className="mt-1 text-sm">Atual: <b>{p.documentHint ?? "não informado"}</b></p>
        <ActionForm action={setDocumentAction} submitLabel={p.documentHint ? "Atualizar documento" : "Salvar documento"} variant="secondary" size="sm" className="mt-2">
          <Field label="CPF ou CNPJ" htmlFor="document"><Input id="document" name="document" inputMode="numeric" autoComplete="off" required minLength={11} maxLength={18} /></Field>
        </ActionForm>
      </section>
      <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4 text-sm">
        <h2 className="font-display font-semibold text-navy-900">Identificador de recarga</h2>
        <p className="mt-1 text-navy-600">Usado pelo carregador para reconhecer sua conta: <code className="font-mono">{p.idTags[0]?.idTag ?? "—"}</code></p>
        <p className="mt-2 text-xs text-navy-500">Cartões RFID ainda não estão disponíveis.</p>
      </section>
      <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4 text-sm" aria-labelledby="aparelhos">
        <h2 id="aparelhos" className="font-display font-semibold text-navy-900">Aparelhos conectados</h2>
        <p className="mt-1 text-navy-600">Onde sua conta está aberta. Não reconhece algum? Desconecte e troque a senha.</p>
        <ul className="mt-2 divide-y divide-navy-50" aria-label="Aparelhos conectados">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                <span className="block font-medium text-navy-900">{d.deviceLabel ?? "Aparelho não identificado"} {d.current && <Badge tone="green">este aparelho</Badge>}</span>
                <span className="block text-xs text-navy-500">Entrou em {dateTime(d.createdAt)}{d.lastSeenAt ? ` · último uso ${dateTime(d.lastSeenAt)}` : ""}</span>
              </span>
              {!d.current && (
                <ActionForm action={revokeDeviceAction} submitLabel="Desconectar" variant="secondary" size="sm" confirm="Desconectar este aparelho? Ele precisará entrar de novo com e-mail e senha.">
                  <input type="hidden" name="sessionId" value={d.id} />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        {others > 1 && (
          <ActionForm action={revokeOtherDevicesAction} submitLabel="Desconectar todos os outros" variant="secondary" size="sm" className="mt-2" confirm="Desconectar todos os outros aparelhos? Só este continuará conectado." />
        )}
      </section>
      <section className="mt-4 rounded-xl border border-navy-100 bg-white p-4 text-sm">
        <h2 className="font-display font-semibold text-navy-900">Seus dados (LGPD)</h2>
        <p className="mt-1 text-navy-600"><a className="font-medium text-brand-700 underline" href="/api/motorista/meus-dados">Baixar meus dados</a> (arquivo JSON com cadastro, veículos, favoritos, aparelhos, recargas, pagamentos e solicitações).</p>
        <details className="mt-3">
          <summary className="cursor-pointer font-medium text-red-700">Excluir minha conta</summary>
          <p className="mt-2 text-navy-600">Seus dados de identificação serão anonimizados e o acesso encerrado. Recargas e pagamentos ficam guardados sem identificação direta, para obrigações fiscais.</p>
          <ActionForm action={deleteDriverAccountAction} submitLabel="Excluir conta" variant="danger" size="sm" className="mt-2" confirm="Excluir sua conta? Esta ação não pode ser desfeita.">
            <Field label="Senha atual" htmlFor="del-password"><Input id="del-password" name="password" type="password" autoComplete="current-password" required /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" name="confirm" required /> Entendo que a exclusão é definitiva.</label>
          </ActionForm>
        </details>
      </section>
      <form action={driverLogoutAction} className="mt-6"><Button variant="secondary" className="w-full">Sair</Button></form>
    </>
  );
}
