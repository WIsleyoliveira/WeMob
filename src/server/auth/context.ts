import type { OrganizationKind } from "@prisma/client";
import { AppError, forbidden } from "@/server/errors";
import type { Permission } from "./permissions";

export interface AuthContext {
  sessionId: string;
  userId: string;
  userName: string;
  email: string;
  organizationId: string;
  organizationName: string;
  orgKind: OrganizationKind;
  roleKey: string;
  permissions: ReadonlySet<string>;
}

export function can(ctx: AuthContext | null, perm: Permission): boolean {
  return !!ctx && ctx.permissions.has(perm);
}

/** Autorização SEMPRE verificada no servidor. Esconder botão na interface não é autorização. */
export function requirePermission(ctx: AuthContext | null, perm: Permission): asserts ctx is AuthContext {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Sessão expirada ou inválida.");
  if (!ctx.permissions.has(perm)) throw forbidden();
}

export function requireOperator(ctx: AuthContext) {
  if (ctx.orgKind !== "OPERATOR") throw forbidden("Ação restrita à operadora da rede.");
}
