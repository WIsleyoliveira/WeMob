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

async function openSession(driverId: string) {
  const token = newToken();
  const s = await db.driverSession.create({ data: { driverId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + DRIVER_SESSION_TTL_MS) } });
  return { token, expiresAt: s.expiresAt };
}

export async function signupDriver(raw: unknown, meta: { ip?: string } = {}) {
  const d = signupSchema.parse(raw);
  if (meta.ip && !(await hit(`driver-signup:${keyedHash(meta.ip)}`, 5, 3600_000))) throw new AppError("RATE_LIMITED", "Muitos cadastros deste endereço. Tente mais tarde.");
  if (!(await hit("driver-signup-global", 500, 3600_000))) throw new AppError("RATE_LIMITED", "Cadastro temporariamente indisponível. Tente em alguns minutos.");
  if (await db.driver.findUnique({ where: { email: d.email } })) throw new AppError("CONFLICT", "Já existe conta com este e-mail. Use “Entrar”.");
  const driver = await db.driver.create({
    data: { name: d.name, email: d.email, phone: d.phone, passwordHash: await hashPassword(d.password), consentAt: new Date(), consentVer: PRIVACY_POLICY_VERSION, idTags: { create: { idTag: newIdTag() } } },
  });
  await audit({ action: "driver.signup", entityType: "Driver", entityId: driver.id });
  return openSession(driver.id);
}

export async function loginDriver(raw: unknown) {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase().email("E-mail inválido."), password: z.string().min(1).max(128) }).parse(raw);
  if (!(await hit(`driver-login:${sha256(email)}`, 10, 15 * 60_000))) throw new AppError("RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.");
  const driver = await db.driver.findUnique({ where: { email } });
  const ok = await verifyPassword(password, driver?.passwordHash ?? DUMMY_HASH);
  if (!driver || !ok || driver.disabledAt) throw new AppError("UNAUTHENTICATED", "E-mail ou senha inválidos.");
  return openSession(driver.id);
}

export async function resolveDriver(token: string | undefined | null): Promise<DriverContext | null> {
  if (!token) return null;
  const s = await db.driverSession.findUnique({ where: { tokenHash: sha256(token) }, include: { driver: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || s.driver.disabledAt) return null;
  return { driverId: s.driverId, name: s.driver.name, email: s.driver.email, sessionId: s.id };
}

export async function logoutDriver(token: string | undefined | null) {
  if (token) await db.driverSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

export function requireDriver(d: DriverContext | null): asserts d is DriverContext {
  if (!d) throw new AppError("UNAUTHENTICATED", "Entre na sua conta para continuar.");
}
