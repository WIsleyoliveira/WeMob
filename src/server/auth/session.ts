import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { keyedHash, newToken, sha256 } from "@/server/crypto";
import { hit } from "@/server/rate-limit";
import { AppError } from "@/server/errors";
import { DUMMY_HASH, verifyPassword } from "./password";
import type { AuthContext } from "./context";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  password: z.string().min(1, "Informe a senha.").max(128),
});

export async function login(raw: unknown, meta: { ip?: string; userAgent?: string } = {}) {
  const { email, password } = loginSchema.parse(raw);
  const ipKey = meta.ip ? keyedHash(meta.ip) : "unknown";
  if (!(await hit(`login:${sha256(email)}`, 10, 15 * 60 * 1000)) || !(await hit(`login-ip:${ipKey}`, 30, 15 * 60 * 1000))) {
    throw new AppError("RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.");
  }
  const user = await db.user.findUnique({
    where: { email },
    include: { memberships: { where: { revokedAt: null }, orderBy: { createdAt: "asc" }, include: { organization: true } } },
  });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  const membership = user?.memberships.find((m) => !m.organization.deletedAt);
  if (!user || !ok || user.disabledAt || !membership) {
    await audit({ action: "auth.login_failed", entityType: "User", entityId: user?.id, data: { reason: "invalid" } });
    throw new AppError("UNAUTHENTICATED", "E-mail ou senha inválidos.");
  }
  const token = newToken();
  const session = await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId: user.id,
      organizationId: membership.organizationId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipHash: meta.ip ? ipKey : null,
      userAgent: meta.userAgent?.slice(0, 300),
    },
  });
  await audit({ organizationId: membership.organizationId, actorUserId: user.id, action: "auth.login", entityType: "Session", entityId: session.id });
  return { token, expiresAt: session.expiresAt };
}

/** Resolve a sessão a partir do token. Revalida usuário, vínculo e perfil a cada requisição. */
export async function resolveSession(token: string | undefined | null): Promise<AuthContext | null> {
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.disabledAt) return null;
  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: session.userId, organizationId: session.organizationId } },
    include: { role: true, organization: true },
  });
  if (!membership || membership.revokedAt || membership.organization.deletedAt) return null;
  return {
    sessionId: session.id,
    userId: session.userId,
    userName: session.user.name,
    email: session.user.email,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    orgKind: membership.organization.kind,
    roleKey: membership.role.key,
    permissions: new Set(membership.role.permissions),
  };
}

export async function logout(token: string | undefined | null) {
  if (!token) return;
  const s = await db.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  return s.count;
}
