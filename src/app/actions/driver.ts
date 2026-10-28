"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requestMeta } from "@/server/auth/current";
import { toActionState, type ActionState } from "@/server/action-result";
import { DRIVER_COOKIE, loginDriver, logoutDriver, signupDriver } from "@/server/drivers/auth";
import { getDriver } from "@/server/drivers/current";
import { cancelChargeRequest, startCharge, stopCharge } from "@/server/drivers/charging";
import { addVehicle, createSupportRequest, deleteMyAccount, rateSession, refreshMyPayment, removeVehicle, setMyDocument, updateProfile } from "@/server/drivers/service";
import { PAYMENT_STATUS_LABEL } from "@/server/payments/service";

const s = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const safeNext = (v?: string) => (v && v.startsWith("/motorista") && !v.startsWith("//") ? v : "/motorista");

async function setCookie(token: string, expiresAt: Date) {
  (await cookies()).set(DRIVER_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

export async function driverSignupAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const meta = await requestMeta();
  const r = await toActionState(() => signupDriver({ name: s(f, "name"), email: s(f, "email"), phone: s(f, "phone"), password: f.get("password"), consent: f.get("consent") === "on" }, meta));
  if (r.status !== "ok" || !r.data) return r as ActionState;
  await setCookie(r.data.token, r.data.expiresAt);
  redirect(safeNext(s(f, "voltar")));
}

export async function driverLoginAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const r = await toActionState(() => loginDriver({ email: s(f, "email"), password: f.get("password") }));
  if (r.status !== "ok" || !r.data) return r as ActionState;
  await setCookie(r.data.token, r.data.expiresAt);
  redirect(safeNext(s(f, "voltar")));
}

export async function driverLogoutAction() {
  const jar = await cookies();
  await logoutDriver(jar.get(DRIVER_COOKIE)?.value);
  jar.delete(DRIVER_COOKIE);
  redirect("/motorista");
}

export async function startChargeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(async () => (await startCharge(driver, { identity: s(f, "identity"), connectorId: s(f, "connectorId"), method: f.get("method") ?? undefined })).id);
  if (r.status === "ok" && r.data) redirect(`/motorista/pedido/${r.data}`);
  return r;
}

export async function cancelChargeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(() => cancelChargeRequest(driver, String(f.get("requestId"))), "Pedido cancelado. A reserva de valor, se houver, foi liberada.");
  revalidatePath(`/motorista/pedido/${f.get("requestId")}`);
  return r;
}

export async function stopChargeAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(async () => void (await stopCharge(driver, String(f.get("sessionId")))), "Encerramento solicitado ao carregador. O valor final aparece quando ele confirmar.");
  revalidatePath(`/motorista/recarga/${f.get("sessionId")}`);
  return r;
}

export async function updateProfileAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(() => updateProfile(driver, { name: s(f, "name"), phone: s(f, "phone") }), "Perfil atualizado.");
  revalidatePath("/motorista/conta");
  return r;
}

export async function addVehicleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(async () => void (await addVehicle(driver, { label: s(f, "label"), connectorTypes: f.getAll("connectorTypes"), batteryKwh: s(f, "batteryKwh") })), "Veículo adicionado.");
  revalidatePath("/motorista/conta");
  return r;
}

export async function removeVehicleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(() => removeVehicle(driver, String(f.get("vehicleId"))), "Veículo removido.");
  revalidatePath("/motorista/conta");
  return r;
}

export async function rateSessionAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(async () => void (await rateSession(driver, { sessionId: s(f, "sessionId"), stars: s(f, "stars"), comment: s(f, "comment") })), "Obrigado pela avaliação!");
  revalidatePath(`/motorista/recarga/${f.get("sessionId")}`);
  return r;
}

export async function supportAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(async () => void (await createSupportRequest(driver, { subject: s(f, "subject"), message: s(f, "message"), sessionId: s(f, "sessionId") })), "Solicitação registrada. A equipe de suporte responderá pelo seu e-mail.");
  revalidatePath("/motorista/ajuda");
  return r;
}

export async function deleteDriverAccountAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(() => deleteMyAccount(driver, { password: f.get("password"), confirm: f.get("confirm") === "on" }));
  if (r.status !== "ok") return r;
  (await cookies()).delete(DRIVER_COOKIE);
  redirect("/motorista/entrar");
}

export async function setDocumentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(() => setMyDocument(driver, { document: f.get("document") }), "Documento salvo. Ele fica cifrado e só é enviado ao gateway para emitir a cobrança.");
  revalidatePath("/motorista/conta");
  return r;
}

export async function refreshPaymentAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const driver = await getDriver();
  const r = await toActionState(() => refreshMyPayment(driver, String(f.get("requestId"))));
  revalidatePath(`/motorista/pedido/${f.get("requestId")}`);
  if (r.status !== "ok" || !r.data) return r as ActionState;
  return { status: "ok", message: r.data.status === "PENDING" ? "O gateway ainda não confirmou o pagamento. Se você acabou de pagar, aguarde alguns instantes." : `Situação no gateway: ${PAYMENT_STATUS_LABEL[r.data.status]}.` };
}
