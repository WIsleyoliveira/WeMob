export const PERMISSIONS = [
  "dashboard:read",
  "lead:read",
  "lead:write",
  "lead:assign",
  "lead:export",
  "crm:configure",
  "commercial_model:read",
  "commercial_model:write",
  "commercial_model:approve",
  "simulation:run",
  "simulation:read",
  "site:read",
  "site:write",
  "station:command",
  "station:command_production",
  "payment:read",
  "payment:refund",
  "payment:reconcile",
  "payment:review",
  "payment:split_configure",
  "payment:recipients_manage",
  "payment:enable_production",
  "contract:read",
  "contract:write",
  "contract:approve",
  "finance:read",
  "finance:write",
  "finance:close",
  "finance:approve",
  "finance:export",
  "partner_portal:read",
  "support:read",
  "support:write",
  "support:configure",
  "maintenance:read",
  "maintenance:write",
  "alert:read",
  "alert:configure",
  "audit:read",
  "user:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS];
/**
 * Comandos em carregadores de PRODUÇÃO e habilitação de pagamentos reais: somente superadministrador
 * (e ainda exigem OCPP_ALLOW_PRODUCTION_COMMANDS=1 / ASAAS_PRODUCTION_ENABLED=1, respectivamente).
 * O portal do parceiro é exclusivo de organizações parceiras/investidoras (perfis partner/investor).
 */
const SUPERADMIN_ONLY: Permission[] = ["station:command_production", "payment:enable_production"];
const allButProductionCommands = all.filter((p) => !SUPERADMIN_ONLY.includes(p) && p !== "partner_portal:read");
const staffAll = all.filter((p) => p !== "partner_portal:read");

/** Perfis de sistema iniciais. Perfis adicionais podem ser criados por organização (tabela Role). */
export const SYSTEM_ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  superadmin: { name: "Superadministrador", permissions: staffAll },
  admin: { name: "Administrador Sansol Mob", permissions: allButProductionCommands },
  operations: {
    name: "Operações",
    permissions: ["dashboard:read", "site:read", "site:write", "station:command", "support:read", "support:write", "maintenance:read", "maintenance:write", "alert:read", "alert:configure", "support:configure"],
  },
  finance: {
    name: "Financeiro",
    permissions: ["dashboard:read", "commercial_model:read", "simulation:run", "simulation:read", "site:read", "audit:read", "payment:read", "payment:refund", "payment:reconcile", "payment:review", "payment:split_configure", "payment:recipients_manage",
      "contract:read", "contract:write", "contract:approve", "finance:read", "finance:write", "finance:close", "finance:approve", "finance:export"],
  },
  commercial: {
    name: "Comercial",
    permissions: ["dashboard:read", "lead:read", "lead:write", "lead:assign", "commercial_model:read", "simulation:run", "simulation:read", "contract:read"],
  },
  support: { name: "Suporte técnico", permissions: ["dashboard:read", "site:read", "support:read", "support:write", "maintenance:read", "maintenance:write", "alert:read"] },
  investor: { name: "Investidor", permissions: ["site:read", "partner_portal:read"] },
  partner: { name: "Parceiro", permissions: ["site:read", "partner_portal:read"] },
  driver: { name: "Motorista", permissions: [] },
};
