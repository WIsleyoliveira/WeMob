export const PERMISSIONS = [
  "dashboard:read",
  "lead:read",
  "lead:write",
  "lead:assign",
  "commercial_model:read",
  "commercial_model:write",
  "commercial_model:approve",
  "simulation:run",
  "simulation:read",
  "site:read",
  "site:write",
  "audit:read",
  "user:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS];

/** Perfis de sistema iniciais. Perfis adicionais podem ser criados por organização (tabela Role). */
export const SYSTEM_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  superadmin: { name: "Superadministrador", permissions: all },
  admin: { name: "Administrador Sansol Mob", permissions: all },
  operations: { name: "Operações", permissions: ["dashboard:read", "site:read", "site:write"] },
  finance: {
    name: "Financeiro",
    permissions: ["dashboard:read", "commercial_model:read", "simulation:run", "simulation:read", "site:read", "audit:read"],
  },
  commercial: {
    name: "Comercial",
    permissions: ["dashboard:read", "lead:read", "lead:write", "lead:assign", "commercial_model:read", "simulation:run", "simulation:read"],
  },
  support: { name: "Suporte técnico", permissions: ["dashboard:read", "site:read"] },
  investor: { name: "Investidor", permissions: ["site:read"] },
  partner: { name: "Parceiro", permissions: ["site:read"] },
  driver: { name: "Motorista", permissions: [] },
};
