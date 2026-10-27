import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { newToken, sha256 } from "@/server/crypto";
import { hit } from "@/server/rate-limit";
import { AppError, notFound } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import { hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";
import { getEmailAdapter, type EmailAdapter } from "@/server/integrations/email";

export const RESET_TTL_MS = 60 * 60 * 1000;

async function issueToken(userId: string, createdById: string | null) {
  const token = newToken();
  await db.$transaction([
    // Apenas um link válido por usuário: invalida os anteriores.
    db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    db.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS), createdById } }),
  ]);
  return token;
}

/**
 * Administrador gera um link de uso único (válido por 1 h) para um membro da própria organização.
 * Bloqueado se o usuário também pertence a outra organização: um admin não pode assumir uma conta
 * que dá acesso a dados de outro tenant.
 */
export async function createPasswordResetLink(ctx: AuthContext | null, membershipId: string) {
  requirePermission(ctx, "user:manage");
  const m = await db.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId, revokedAt: null } });
  if (!m) throw notFound();
  const otherOrgs = await db.membership.count({ where: { userId: m.userId, revokedAt: null, organizationId: { not: ctx.organizationId } } });
  if (otherOrgs > 0) throw new AppError("FORBIDDEN", "Usuário vinculado a outras organizações: a redefinição deve ser feita pelo suporte da plataforma.");
  const token = await issueToken(m.userId, ctx.userId);
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "password_reset.link_created", entityType: "User", entityId: m.userId });
  return { token, expiresInMinutes: RESET_TTL_MS / 60000 };
}

/** Solicitação pública. Resposta sempre neutra (não revela se o e-mail existe). */
export async function requestPasswordReset(rawEmail: unknown, deps: { email?: EmailAdapter; baseUrl?: string } = {}) {
  const email = z.string().trim().toLowerCase().email("E-mail inválido.").parse(rawEmail);
  const adapter = deps.email ?? getEmailAdapter();
  if (!(await hit(`reset:${sha256(email)}`, 3, 60 * 60 * 1000))) return { emailChannel: adapter.status };
  if (adapter.status !== "configured") return { emailChannel: adapter.status }; // nada é gerado sem canal de entrega
  const user = await db.user.findUnique({ where: { email } });
  if (user && !user.disabledAt) {
    const token = await issueToken(user.id, null);
    const link = `${deps.baseUrl ?? ""}/redefinir-senha?token=${token}`;
    await adapter.send({ to: email, subject: "Redefinição de senha — Sansol Mob", text: `Use o link em até 1 hora: ${link}\nSe não foi você, ignore esta mensagem.` });
    await audit({ action: "password_reset.requested", entityType: "User", entityId: user.id });
  }
  return { emailChannel: adapter.status };
}

export const resetSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "As senhas não conferem.", path: ["confirm"] });

/** Consome o token, troca a senha e encerra todas as sessões do usuário. */
export async function resetPasswordWithToken(raw: unknown) {
  const { token, password } = resetSchema.parse(raw);
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError("VALIDATION", "Link inválido ou expirado. Solicite um novo.");
  const passwordHash = await hashPassword(password);
  await db.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) throw new AppError("VALIDATION", "Link inválido ou expirado. Solicite um novo.");
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ action: "password_reset.completed", entityType: "User", entityId: row.userId }, tx);
  });
}

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, "Informe a senha atual."), password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "As senhas não conferem.", path: ["confirm"] });

/** Troca de senha pelo próprio usuário; encerra as demais sessões. */
export async function changePassword(ctx: AuthContext | null, raw: unknown) {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Sessão expirada ou inválida.");
  const { currentPassword, password } = changePasswordSchema.parse(raw);
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new AppError("VALIDATION", "Senha atual incorreta.");
  await db.$transaction([
    db.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(password) } }),
    db.session.updateMany({ where: { userId: ctx.userId, revokedAt: null, id: { not: ctx.sessionId } }, data: { revokedAt: new Date() } }),
  ]);
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "password.changed", entityType: "User", entityId: ctx.userId });
}
