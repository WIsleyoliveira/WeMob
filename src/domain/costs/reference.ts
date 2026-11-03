import type { CostAssumptions, CostItemInput } from "./platform";

/**
 * Premissas da planilha "WeMob_Custos_Mensais_Detalhados.xlsx" (abas "Custos mensais" e "Cenarios de custo"),
 * SHA-256 00da01b7cae1ee40f55870535278edf11b831296262084acb8d715c828bd709f, recebida em 2026-11-03.
 * A própria planilha diz: "Valores de planejamento, nao cotacoes. Ajuste premissas conforme contratos e fornecedores."
 */
export const COST_SOURCE_NOTE =
  "Planilha WeMob_Custos_Mensais_Detalhados.xlsx (2026-11-03): valores de planejamento, não cotações. Hardware, energia, aluguel de ponto e tarifas por transação não incluídos.";

export const REFERENCE_COST_ITEMS: CostItemInput[] = [
  { key: "app-api", name: "Servidor app e API", category: "INFRASTRUCTURE", baseMonthly: 240, fxExposure: 1 },
  { key: "postgres", name: "Banco PostgreSQL", category: "INFRASTRUCTURE", baseMonthly: 140, fxExposure: 1 },
  { key: "workers", name: "Workers e automações", category: "INFRASTRUCTURE", baseMonthly: 60, fxExposure: 1 },
  { key: "backups", name: "Backups e armazenamento", category: "INFRASTRUCTURE", baseMonthly: 38, fxExposure: 1 },
  { key: "monitoring", name: "Monitoramento e logs", category: "INFRASTRUCTURE", baseMonthly: 30, fxExposure: 1 },
  { key: "domain-email", name: "Domínio, e-mail e auxiliares", category: "SERVICES", baseMonthly: 35, fxExposure: 0.5 },
  { key: "maps", name: "Mapas e geolocalização", category: "SERVICES", baseMonthly: 50, fxExposure: 0.5 },
  { key: "support", name: "Suporte e manutenção", category: "OPERATIONS", baseMonthly: 407, fxExposure: 0 },
];

export const REFERENCE_COST_ASSUMPTIONS: CostAssumptions & { budgetTolerance: number } = {
  fxStressRate: 0.4,
  reserveRate: 0.6,
  perStationCost: 250,
  perStationReserve: 150,
  /** Tolerância do alerta de orçamento (não está na planilha: padrão técnico de 10%, editável). */
  budgetTolerance: 0.1,
};

export const REFERENCE_SCENARIOS = [
  { name: "Piloto", stations: 1 },
  { name: "Rede pequena", stations: 3 },
  { name: "Rede em crescimento", stations: 5 },
  { name: "Rede média", stations: 10 },
  { name: "Rede maior", stations: 20 },
];
