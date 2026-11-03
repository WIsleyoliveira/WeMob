import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import { AREA_LIST, areaPrefixes } from "@/domain/audit/labels";

export const AUDIT_PAGE_SIZE = 50;

export const auditFilterSchema = z.object({
  area: z.enum(AREA_LIST as [string, ...string[]]).optional(),
  actor: z.string().max(40).optional(),
  q: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

/**
 * Trilha de auditoria da organização (somente leitura), com filtros por área, autor, período e texto (código da ação
 * ou da entidade) e paginação. Datas no fuso de Brasília. `actor=sistema` = ações sem usuário (site, automações).
 */
export async function listAuditEvents(ctx: AuthContext | null, raw: unknown = {}) {
  requirePermission(ctx, "audit:read");
  const f = auditFilterSchema.parse(raw ?? {});
  const where: Prisma.AuditEventWhereInput = {
    organizationId: ctx.organizationId,
    ...(f.area ? { OR: areaPrefixes(f.area).map((p) => ({ action: { startsWith: p } })) } : {}),
    ...(f.actor === "sistema" ? { actorUserId: null } : f.actor ? { actorUserId: f.actor } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00-03:00`) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999-03:00`) } : {}) } } : {}),
    ...(f.q ? { AND: [{ OR: [{ action: { contains: f.q, mode: "insensitive" } }, { entityType: { contains: f.q, mode: "insensitive" } }, { entityId: { contains: f.q } }] }] } : {}),
  };
  const [events, total, actorIds] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (f.page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
    db.auditEvent.count({ where }),
    db.auditEvent.findMany({ where: { organizationId: ctx.organizationId, actorUserId: { not: null } }, distinct: ["actorUserId"], select: { actorUserId: true }, take: 200 }),
  ]);
  const ids = [...new Set([...events.map((e) => e.actorUserId), ...actorIds.map((a) => a.actorUserId)].filter(Boolean))] as string[];
  const names = new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    filter: f,
    total,
    pageSize: AUDIT_PAGE_SIZE,
    rows: events.map((e) => ({ ...e, actorName: e.actorUserId ? names.get(e.actorUserId) ?? null : null })),
    actors: actorIds.map((a) => ({ id: a.actorUserId!, name: names.get(a.actorUserId!) ?? "—" })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}
