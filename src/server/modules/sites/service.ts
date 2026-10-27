import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";

/** Escopo de unidades: operadora vê as suas; investidor/parceiro vê apenas as vinculadas à sua organização. */
function siteScope(ctx: AuthContext) {
  return ctx.orgKind === "OPERATOR" ? { operatorId: ctx.organizationId } : { partnerOrganizationId: ctx.organizationId };
}

export async function listSites(ctx: AuthContext | null) {
  requirePermission(ctx, "site:read");
  return db.site.findMany({
    where: { ...siteScope(ctx), deletedAt: null },
    include: { partnerOrganization: { select: { id: true, name: true, kind: true } }, _count: { select: { stations: { where: { deletedAt: null } } } } },
    orderBy: { name: "asc" },
  });
}

export async function getSite(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "site:read");
  const site = await db.site.findFirst({ where: { id, ...siteScope(ctx), deletedAt: null }, include: { partnerOrganization: true } });
  if (!site) throw notFound("Unidade não encontrada.");
  return site;
}
