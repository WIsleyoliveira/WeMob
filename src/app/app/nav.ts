import { Activity, Bell, Building2, Calculator, ClipboardList, CreditCard, FileSignature, FileStack, Handshake, LayoutDashboard, Landmark, LifeBuoy, ScrollText, Users, Wrench } from "lucide-react";
import type { Permission } from "@/server/auth/permissions";

export type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; perm?: Permission; operatorOnly?: boolean };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * Navegação da equipe agrupada pela tarefa (e não por tabela): o que está acontecendo agora, a rede física,
 * o dinheiro, o comercial, o atendimento e a administração. Cada item só aparece com a permissão correspondente.
 */
export const NAV_GROUPS: NavGroup[] = [
  { label: "Visão geral", items: [{ href: "/app", label: "Painel", icon: LayoutDashboard }, { href: "/app/alertas", label: "Alertas", icon: Bell, perm: "alert:read" }] },
  {
    label: "Rede de recarga",
    items: [
      { href: "/app/operacao", label: "Operação ao vivo", icon: Activity, perm: "site:read" },
      { href: "/app/unidades", label: "Unidades e estações", icon: Building2, perm: "site:read" },
      { href: "/app/manutencao", label: "Manutenção", icon: Wrench, perm: "maintenance:read" },
    ],
  },
  {
    label: "Financeiro",
    items: [
      { href: "/app/pagamentos", label: "Pagamentos", icon: CreditCard, perm: "payment:read" },
      { href: "/app/financeiro", label: "Financeiro e custos", icon: Landmark, perm: "finance:read" },
      { href: "/app/contratos", label: "Contratos 30/70", icon: FileSignature, perm: "contract:read" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/app/crm", label: "CRM", icon: ClipboardList, perm: "lead:read" },
      { href: "/app/simulador", label: "Simulador", icon: Calculator, perm: "simulation:run" },
      { href: "/app/modelos", label: "Modelos comerciais", icon: FileStack, perm: "commercial_model:read" },
    ],
  },
  { label: "Atendimento", items: [{ href: "/app/suporte", label: "Suporte e SLA", icon: LifeBuoy, perm: "support:read" }] },
  { label: "Meu posto", items: [{ href: "/app/portal", label: "Portal do parceiro", icon: Handshake, perm: "partner_portal:read" }] },
  {
    label: "Administração",
    items: [
      { href: "/app/usuarios", label: "Usuários e acessos", icon: Users, perm: "user:manage" },
      { href: "/app/auditoria", label: "Auditoria", icon: ScrollText, perm: "audit:read" },
    ],
  },
];

export function visibleNav(perms: ReadonlySet<string>) {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || perms.has(i.perm)) })).filter((g) => g.items.length > 0);
}
