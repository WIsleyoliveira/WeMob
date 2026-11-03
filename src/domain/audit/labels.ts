/**
 * Textos legíveis da auditoria (regra pura). O código técnico da ação continua guardado e visível nos detalhes;
 * aqui só se traduz para quem consulta. Ação sem tradução específica cai no rótulo da área + verbo genérico.
 */
export const AUDIT_AREAS = {
  auth: "Acesso",
  password: "Acesso",
  password_reset: "Acesso",
  membership: "Usuários",
  lead: "CRM",
  pipeline_stage: "CRM",
  proposal: "Propostas",
  commercial_version: "Modelos comerciais",
  simulation: "Simulador",
  contract: "Contratos",
  finance: "Financeiro",
  platform_cost: "Custos da plataforma",
  payment: "Pagamentos",
  charge: "Recargas",
  session: "Recargas",
  driver: "Motoristas",
  site: "Unidades e estações",
  station: "Unidades e estações",
  connector: "Unidades e estações",
  tariff: "Unidades e estações",
  ticket: "Suporte",
  sla: "Suporte",
  work_order: "Manutenção",
  maintenance: "Manutenção",
  alert: "Alertas",
  attachment: "Anexos",
  partner: "Portal do parceiro",
} as const;

export type AuditArea = (typeof AUDIT_AREAS)[keyof typeof AUDIT_AREAS];
export const AREA_LIST: string[] = [...new Set(Object.values(AUDIT_AREAS))].sort((a, b) => a.localeCompare(b, "pt-BR"));
/** Prefixos de ação de cada área (para filtrar no banco). */
export const areaPrefixes = (area: string) => Object.entries(AUDIT_AREAS).filter(([, a]) => a === area).map(([p]) => `${p}.`);

const SPECIFIC: Record<string, string> = {
  "auth.login": "Entrou na plataforma",
  "auth.login_failed": "Tentativa de acesso recusada",
  "password.changed": "Trocou a senha",
  "password_reset.requested": "Pediu redefinição de senha",
  "password_reset.link_created": "Gerou link de redefinição de senha",
  "password_reset.completed": "Redefiniu a senha",
  "membership.revoked": "Revogou acesso de usuário",
  "membership.role_changed": "Alterou o perfil de usuário",
  "membership.sessions_revoked": "Encerrou as sessões de usuário",
  "lead.stage_changed": "Mudou a etapa do lead",
  "lead.converted": "Converteu o lead",
  "lead.company_linked": "Vinculou empresa ao lead",
  "lead.details_updated": "Atualizou dados do lead",
  "contract.version_approved": "Aprovou versão de contrato",
  "contract.version_rejected": "Recusou versão de contrato",
  "contract.amendment_created": "Criou aditivo de contrato",
  "contract.site_added": "Vinculou unidade ao contrato",
  "contract.status_changed": "Mudou a situação do contrato",
  "commercial_version.approved": "Aprovou versão de modelo comercial",
  "commercial_version.retired_legacy_14": "Tirou de vigência modelo com taxa de 14%",
  "finance.closing_requested": "Pediu fechamento do mês",
  "finance.closing_approved": "Aprovou fechamento do mês",
  "finance.closing_rejected": "Recusou fechamento do mês",
  "finance.closing_superseded": "Fechamento substituído (dados mudaram)",
  "finance.entry_settled": "Deu baixa em lançamento",
  "finance.adjustment_created": "Criou lançamento de ajuste",
  "payment.refund_requested": "Pediu estorno",
  "payment.refund_cancelled": "Cancelou estorno agendado",
  "payment.refund_scheduled": "Estorno agendado pelo gateway",
  "payment.status_changed": "Situação do pagamento mudou",
  "payment.reconciled": "Conciliou pagamentos",
  "payment.review_opened": "Abriu análise de pagamento",
  "payment.review_resolved": "Resolveu análise de pagamento",
  "payment.production_activation_requested": "Pediu ativação do gateway em produção",
  "payment.production_activation_approved": "Aprovou ativação do gateway em produção",
  "payment.production_activation_rejected": "Recusou ativação do gateway em produção",
  "station.command_requested": "Enviou comando ao carregador",
  "station.command_blocked": "Comando ao carregador bloqueado",
  "station.secret_rotated": "Trocou a senha do carregador",
  "session.limit_stop_requested": "Pediu parada no limite financeiro",
  "ticket.status_changed": "Mudou a situação do chamado",
  "work_order.completed": "Concluiu ordem de serviço",
  "platform_cost.budget_frozen": "Congelou o orçamento do mês",
  "platform_cost.import_applied": "Aplicou nova versão da planilha de custos",
  "attachment.downloaded": "Baixou anexo",
  "charge.requested": "Motorista pediu recarga",
  "charge.start_authorized": "Início de recarga autorizado",
  "charge.stop_requested": "Motorista pediu para encerrar a recarga",
  "driver.signup": "Motorista criou conta",
  "finance.tax_rule_ended": "Encerrou a vigência de tributo",
  "payment.recipient_validated": "Validou recebedor do split",
  "payment.refund_retried": "Reenviou estorno ao gateway",
  "payment.refund_retry_requested": "Pediu nova tentativa de estorno",
  "payment.split_status_changed": "Situação do split mudou",
  "platform_cost.actual_recorded": "Lançou custo realizado da plataforma",
  "platform_cost.actual_cancelled": "Cancelou custo realizado da plataforma",
  "platform_cost.import_previewed": "Enviou planilha de custos (prévia)",
  "platform_cost.import_discarded": "Descartou importação de planilha",
  "platform_cost.assumptions_updated": "Alterou premissas de custo",
  "proposal.revised": "Revisou proposta (nova versão)",
  "proposal.status_changed": "Mudou a situação da proposta",
  "session.limit_near": "Recarga perto do limite financeiro",
  "session.limit_stop_retried": "Repetiu pedido de parada no limite",
  "driver.account_deleted": "Motorista excluiu a conta",
  "driver.data_exported": "Motorista exportou os próprios dados",
};

const VERBS: [RegExp, string][] = [
  [/(^|_)created$/, "Criou"],
  [/(^|_)updated$|_saved$|^saved$/, "Alterou"],
  [/(^|_)approved$/, "Aprovou"],
  [/(^|_)rejected$/, "Recusou"],
  [/(^|_)cancelled$/, "Cancelou"],
  [/(^|_)deleted$|(^|_)revoked$|_deactivated$|_disabled$/, "Removeu"],
  [/exported$/, "Exportou"],
  [/(^|_)added$/, "Adicionou"],
  [/resolved$/, "Resolveu"],
  [/acknowledged$/, "Reconheceu"],
];

const ENTITY: Record<string, string> = {
  Session: "sessão", User: "usuário", Membership: "acesso", Lead: "lead", Proposal: "proposta", Contract: "contrato", ContractVersion: "versão de contrato",
  PeriodClosing: "fechamento", FinancialEntry: "lançamento", Payment: "pagamento", Refund: "estorno", ChargeRequest: "pedido de recarga", ChargingSession: "recarga",
  Site: "unidade", ChargingStation: "estação", Connector: "conector", Tariff: "tarifa", Ticket: "chamado", WorkOrder: "ordem de serviço", MaintenancePlan: "plano de manutenção",
  Alert: "alerta", AlertRule: "regra de alerta", Attachment: "anexo", Driver: "motorista", CommercialModelVersion: "versão de modelo comercial", Simulation: "simulação",
  TaxRule: "tributo", PlatformCostItem: "item de custo", PlatformCostAssumptions: "premissas de custo", PlatformCostActual: "custo realizado", PlatformCostBudget: "orçamento do mês",
  PlatformCostImport: "importação de planilha", GatewayActivation: "ativação do gateway", PaymentRecipient: "recebedor", SplitPolicy: "política de split", SlaPolicy: "política de SLA", PipelineStage: "etapa do funil",
};

export const entityLabel = (t: string) => ENTITY[t] ?? t;

export function auditArea(action: string): string {
  const prefix = action.split(".")[0];
  return (AUDIT_AREAS as Record<string, string>)[prefix] ?? "Outros";
}

export function auditLabel(action: string, entityType?: string | null): string {
  if (SPECIFIC[action]) return SPECIFIC[action];
  const verb = action.split(".").slice(1).join(".");
  const v = VERBS.find(([re]) => re.test(verb))?.[1];
  const what = entityType ? entityLabel(entityType) : auditArea(action).toLowerCase();
  return v ? `${v} ${what}` : `${auditArea(action)}: ${verb.replace(/_/g, " ")}`;
}
