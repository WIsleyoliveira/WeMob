import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import { AppError, notFound } from "@/server/errors";
import { z } from "zod";
import { SYSTEM_ROLES } from "@/server/auth/permissions";
import { describeDevice } from "@/domain/drivers/device";

/** Revoga o vínculo de um usuário com a organização do contexto e encerra suas sessões nela. */
export async function revokeMembership(ctx: AuthContext | null, membershipId: string) {
  requirePermission(ctx, "user:manage");
  const m = await db.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId } });
  if (!m) throw notFound();
  if (m.userId === ctx.userId) throw new AppError("FORBIDDEN", "Você não pode revogar o próprio acesso.");
  if (m.revokedAt) throw new AppError("CONFLICT", "Este acesso já foi revogado.");
  const role = await db.role.findUniqueOrThrow({ where: { id: m.roleId } });
  if (role.permissions.includes("user:manage")) {
    const otherManagers = await db.membership.count({
      where: { organizationId: m.organizationId, revokedAt: null, id: { not: m.id }, role: { permissions: { has: "user:manage" } } },
    });
    if (otherManagers === 0) throw new AppError("CONFLICT", "Não é possível revogar o último administrador da organização.");
  }
  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { revokedAt: new Date() } });
    await tx.session.updateMany({
      where: { userId: m.userId, organizationId: m.organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "membership.revoked", entityType: "Membership", entityId: m.id }, tx);
  });
}

/** Perfis que podem ser dados nesta organização (operadora: equipe; parceiro/investidor: o perfil próprio). */
export function assignableRoles(ctx: AuthContext) {
  const operatorRoles = ["admin", "operations", "finance", "commercial", "support"];
  const keys = ctx.orgKind === "OPERATOR" ? (ctx.roleKey === "superadmin" ? ["superadmin", ...operatorRoles] : operatorRoles) : ctx.orgKind === "PARTNER" ? ["partner"] : ["investor"];
  return keys.map((k) => ({ key: k, name: SYSTEM_ROLES[k].name, permissions: SYSTEM_ROLES[k].permissions }));
}

/** Membros da organização com perfil, situação e aparelhos com sessão aberta (rótulo genérico, sem IP). */
export async function listMembers(ctx: AuthContext | null) {
  requirePermission(ctx, "user:manage");
  const now = new Date();
  const rows = await db.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: {
      user: { select: { id: true, name: true, email: true, disabledAt: true, sessions: { where: { organizationId: ctx.organizationId, revokedAt: null, expiresAt: { gt: now } }, select: { createdAt: true, userAgent: true }, orderBy: { createdAt: "desc" } } } },
      role: { select: { key: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(({ user: { sessions, ...user }, ...m }) => ({
    ...m,
    user,
    sessions: sessions.length,
    lastAccessAt: sessions[0]?.createdAt ?? null,
    devices: [...new Set(sessions.map((x) => describeDevice(x.userAgent)))],
  }));
}

/** Troca o perfil de um membro. Não vale para si mesmo; não deixa a organização sem quem administra usuários. */
export async function changeMemberRole(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "user:manage");
  const d = z.object({ membershipId: z.string().min(1), roleKey: z.string().min(1) }).parse(raw);
  const allowed = assignableRoles(ctx).map((r) => r.key);
  if (!allowed.includes(d.roleKey)) throw new AppError("FORBIDDEN", "Este perfil não pode ser atribuído nesta organização.");
  const m = await db.membership.findFirst({ where: { id: d.membershipId, organizationId: ctx.organizationId }, include: { role: true } });
  if (!m) throw notFound();
  if (m.userId === ctx.userId) throw new AppError("FORBIDDEN", "Você não pode alterar o próprio perfil.");
  if (m.revokedAt) throw new AppError("CONFLICT", "Acesso revogado: não é possível alterar o perfil.");
  if (m.role.key === d.roleKey) return;
  if (m.role.key === "superadmin" && ctx.roleKey !== "superadmin") throw new AppError("FORBIDDEN", "Só um superadministrador altera o perfil de outro superadministrador.");
  const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key: d.roleKey } });
  if (m.role.permissions.includes("user:manage") && !role.permissions.includes("user:manage")) {
    const others = await db.membership.count({ where: { organizationId: m.organizationId, revokedAt: null, id: { not: m.id }, role: { permissions: { has: "user:manage" } } } });
    if (others === 0) throw new AppError("CONFLICT", "Não é possível tirar a administração do último administrador da organização.");
  }
  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
    // Sessões abertas carregam as permissões do perfil antigo: encerradas para valer o novo perfil no próximo acesso.
    await tx.session.updateMany({ where: { userId: m.userId, organizationId: m.organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "membership.role_changed", entityType: "Membership", entityId: m.id, data: { from: m.role.key, to: role.key } }, tx);
  });
}

/** Encerra as sessões de um membro (todos os aparelhos) sem revogar o acesso: ele precisará entrar de novo. */
export async function revokeMemberSessions(ctx: AuthContext | null, membershipId: string) {
  requirePermission(ctx, "user:manage");
  const m = await db.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId } });
  if (!m) throw notFound();
  if (m.userId === ctx.userId) throw new AppError("FORBIDDEN", "Para sair dos seus aparelhos, use Minha conta.");
  const r = await db.session.updateMany({ where: { userId: m.userId, organizationId: m.organizationId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "membership.sessions_revoked", entityType: "Membership", entityId: m.id, data: { sessions: r.count } });
  return r.count;
}
