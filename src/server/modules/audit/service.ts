import { db } from "@/server/db";
import { requirePermission, type AuthContext } from "@/server/auth/context";

export async function listAuditEvents(ctx: AuthContext | null, take = 200) {
  requirePermission(ctx, "audit:read");
  const events = await db.auditEvent.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take });
  const actorIds = [...new Set(events.map((e) => e.actorUserId).filter(Boolean))] as string[];
  const actors = new Map((await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return events.map((e) => ({ ...e, actorName: e.actorUserId ? actors.get(e.actorUserId) ?? null : null }));
}
