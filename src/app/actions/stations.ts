"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentContext } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { addTariff, createSite, createStation, rotateStationSecret, updateSite, upsertConnector } from "@/server/modules/stations/service";
import { requestRemoteCommand } from "@/server/modules/stations/commands";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const siteFields = (f: FormData) => ({
  name: s(f, "name"), address: s(f, "address"), city: s(f, "city"), state: s(f, "state"),
  latitude: s(f, "latitude")?.replace(",", "."), longitude: s(f, "longitude")?.replace(",", "."),
  openingHours: s(f, "openingHours"), status: s(f, "status"), isPublic: f.get("isPublic") === "on", partnerOrganizationId: s(f, "partnerOrganizationId"),
});

export async function createSiteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => (await createSite(ctx, siteFields(f))).id);
  if (r.status === "ok" && r.data) redirect(`/app/unidades/${r.data}`);
  return r;
}

export async function updateSiteAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => updateSite(ctx, String(f.get("siteId")), siteFields(f)), "Unidade atualizada.");
  revalidatePath(`/app/unidades/${f.get("siteId")}`);
  return r;
}

export async function createStationAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() =>
    createStation(ctx, { siteId: s(f, "siteId"), ocppIdentity: s(f, "ocppIdentity"), environment: s(f, "environment"), protocol: s(f, "protocol"), vendor: s(f, "vendor"), model: s(f, "model"), serialNumber: s(f, "serialNumber"), heartbeatInterval: s(f, "heartbeatInterval") }),
  );
  revalidatePath(`/app/unidades/${f.get("siteId")}`);
  if (r.status !== "ok" || !r.data) return r as ActionState;
  return {
    status: "ok",
    message: r.data.secret
      ? `Estação ${r.data.station.ocppIdentity} criada. Senha OCPP (exibida uma única vez; configure no carregador e guarde em cofre): ${r.data.secret}`
      : `Estação ${r.data.station.ocppIdentity} criada sem credencial: protocolo sem adaptador implementado.`,
  };
}

export async function rotateSecretAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => rotateStationSecret(ctx, String(f.get("stationId"))));
  if (r.status !== "ok") return r as ActionState;
  return { status: "ok", message: `Nova senha OCPP (exibida uma única vez; a anterior deixou de valer para novas conexões): ${r.data}` };
}

export async function upsertConnectorAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(() => upsertConnector(ctx, { stationId: s(f, "stationId"), connectorId: s(f, "connectorId"), type: s(f, "type"), maxPowerKw: s(f, "maxPowerKw")?.replace(",", ".") }), "Conector salvo.");
  revalidatePath(`/app/estacoes/${f.get("stationId")}`);
  return r;
}

export async function addTariffAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const r = await toActionState(async () => void (await addTariff(ctx, { siteId: s(f, "siteId"), pricePerKwh: s(f, "pricePerKwh")?.replace(",", "."), pricePerMin: s(f, "pricePerMin")?.replace(",", ".") ?? 0, validFrom: s(f, "validFrom") })), "Tarifa registrada (versões anteriores preservadas).");
  revalidatePath(`/app/unidades/${f.get("siteId")}`);
  return r;
}

export async function remoteCommandAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await getCurrentContext();
  const raw = Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith("$")).map(([k, v]) => [k, v === "on" ? true : v]));
  const r = await toActionState(async () => void (await requestRemoteCommand(ctx, { ...raw, confirm: raw.confirm === true || raw.confirm === "true" })), "Comando registrado. Será entregue pelo servidor OCPP; acompanhe o resultado no histórico.");
  revalidatePath(`/app/estacoes/${f.get("stationId")}`);
  return r;
}
