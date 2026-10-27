import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import { AppError, notFound } from "@/server/errors";

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

export async function listMembers(ctx: AuthContext | null) {
  requirePermission(ctx, "user:manage");
  return db.membership.findMany({
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true, disabledAt: true } }, role: { select: { key: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}
