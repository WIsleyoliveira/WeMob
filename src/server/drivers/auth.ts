/**
 * Autenticação de MOTORISTAS — separada da equipe (tabela Driver, cookie e sessões próprios).
 * Um motorista nunca recebe AuthContext de backoffice.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { keyedHash, newToken, sha256 } from "@/server/crypto";
import { hit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { DUMMY_HASH, hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";
import { PRIVACY_POLICY_VERSION } from "@/server/modules/leads/service";
import { describeDevice, shouldTouchDevice } from "@/domain/drivers/device";

export const DRIVER_COOKIE = "sm_driver";
export const DRIVER_SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export interface DriverContext {
  driverId: string;
  name: string;
  email: string;
  sessionId: string;
}

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(200),
  phone: z.string().trim().max(20).optional().transform((v) => (v ? v.replace(/\D/g, "") : undefined)),
  password: passwordSchema,
  consent: z.literal(true, { error: "É necessário aceitar os termos e a política de privacidade." }),
});

/** Identificador OCPP do app: 20 caracteres no máximo (limite do idTag em OCPP 1.6). */
const newIdTag = () => "APP" + randomBytes(8).toString("hex").toUpperCase().slice(0, 16);

type LoginMeta = { ip?: string; userAgent?: string };

async function openSession(driverId: string, meta: LoginMeta) {
  const token = newToken();
  const now = new Date();
  const s = await db.driverSession.create({
    data: { driverId, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + DRIVER_SESSION_TTL_MS), deviceLabel: describeDevice(meta.userAgent), lastSeenAt: now },
  });
  return { token, expiresAt: s.expiresAt };
}

export async function signupDriver(raw: unknown, meta: LoginMeta = {}) {
  const d = signupSchema.parse(raw);
  if (meta.ip && !(await hit(`driver-signup:${keyedHash(meta.ip)}`, 5, 3600_000))) throw new AppError("RATE_LIMITED", "Muitos cadastros deste endereço. Tente mais tarde.");
  if (!(await hit("driver-signup-global", 500, 3600_000))) throw new AppError("RATE_LIMITED", "Cadastro temporariamente indisponível. Tente em alguns minutos.");
  if (await db.driver.findUnique({ where: { email: d.email } })) throw new AppError("CONFLICT", "Já existe conta com este e-mail. Use “Entrar”.");
  const driver = await db.driver.create({
    data: { name: d.name, email: d.email, phone: d.phone, passwordHash: await hashPassword(d.password), consentAt: new Date(), consentVer: PRIVACY_POLICY_VERSION, idTags: { create: { idTag: newIdTag() } } },
  });
  await audit({ action: "driver.signup", entityType: "Driver", entityId: driver.id });
  return openSession(driver.id, meta);
}

export async function loginDriver(raw: unknown, meta: LoginMeta = {}) {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido."), password: z.string().min(1).max(128) }).parse(raw);
  // Por conta e por IP (o mesmo IP testando muitas contas também é barrado).
  if (!(await hit(`driver-login:${sha256(email)}`, 10, 15 * 60_000)) || !(await hit(`driver-login-ip:${meta.ip ? keyedHash(meta.ip) : "unknown"}`, 30, 15 * 60_000)))
    throw new AppError("RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.");
  const driver = await db.driver.findUnique({ where: { email } });
  const ok = await verifyPassword(password, driver?.passwordHash ?? DUMMY_HASH);
  if (!driver || !ok || driver.disabledAt) throw new AppError("UNAUTHENTICATED", "E-mail ou senha inválidos.");
  return openSession(driver.id, meta);
}

export async function resolveDriver(token: string | undefined | null): Promise<DriverContext | null> {
  if (!token) return null;
  const s = await db.driverSession.findUnique({ where: { tokenHash: sha256(token) }, include: { driver: true } });
  const now = new Date();
  if (!s || s.revokedAt || s.expiresAt < now || s.driver.disabledAt) return null;
  // "Último uso" para a lista de aparelhos: no máximo uma escrita a cada 5 min por sessão.
  if (shouldTouchDevice(s.lastSeenAt, now)) await db.driverSession.updateMany({ where: { id: s.id, revokedAt: null }, data: { lastSeenAt: now } });
  return { driverId: s.driverId, name: s.driver.name, email: s.driver.email, sessionId: s.id };
}

export async function logoutDriver(token: string | undefined | null) {
  if (token) await db.driverSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export function requireDriver(d: DriverContext | null): asserts d is DriverContext {
  if (!d) throw new AppError("UNAUTHENTICATED", "Entre na sua conta para continuar.");
}

// ── Aparelhos conectados: sessões abertas do próprio motorista ──

export async function listMyDevices(driver: DriverContext | null, now = new Date()) {
  requireDriver(driver);
  const rows = await db.driverSession.findMany({
    where: { driverId: driver.driverId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, deviceLabel: true, createdAt: true, lastSeenAt: true },
    orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });
  return rows.map((r) => ({ ...r, current: r.id === driver.sessionId }));
}

/** Encerra o acesso de OUTRO aparelho do próprio motorista. O atual sai pelo botão "Sair" (apaga o cookie). */
export async function revokeMyDevice(driver: DriverContext | null, sessionId: string) {
  requireDriver(driver);
  if (sessionId === driver.sessionId) throw new AppError("VALIDATION", "Este é o aparelho que você está usando. Para sair dele, use “Sair”.");
  const r = await db.driverSession.updateMany({ where: { id: sessionId, driverId: driver.driverId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (r.count === 0) throw new AppError("NOT_FOUND", "Aparelho não encontrado ou já desconectado.");
  await audit({ action: "driver.session_revoked", entityType: "Driver", entityId: driver.driverId, data: { sessionId } });
}

/** Encerra todos os acessos do motorista, menos o deste aparelho. Devolve quantos foram encerrados. */
export async function revokeOtherDevices(driver: DriverContext | null) {
  requireDriver(driver);
  const r = await db.driverSession.updateMany({ where: { driverId: driver.driverId, revokedAt: null, id: { not: driver.sessionId } }, data: { revokedAt: new Date() } });
  if (r.count > 0) await audit({ action: "driver.other_sessions_revoked", entityType: "Driver", entityId: driver.driverId, data: { count: r.count } });
  return r.count;
}
