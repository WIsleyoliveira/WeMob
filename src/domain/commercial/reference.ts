import type { CommercialTerms } from "./types";

/**
 * Parâmetros de REFERÊNCIA extraídos do "Portfólio Comercial Sansol Mob" (slides 4, 11, 12 e 13).
 * Não são condições contratuais: valem apenas como ponto de partida para versões em rascunho,
 * que precisam ser revisadas e aprovadas por um administrador autorizado.
 */
export const PORTFOLIO_SOURCE_NOTE =
  "Portfólio Comercial Sansol Mob (.pptx), slides 4, 11, 12 e 13. Parâmetros de referência, sujeitos a contrato.";

/**
 * Regra comercial OFICIAL (informada pela WAPE em 2026-11-03): a WeMob recebe 30% do faturamento bruto total mensal
 * de cada posto; o operador do posto, 70%. Substitui a antiga "taxa de sistema + gateway de 14%". A participação não é
 * lucro: tarifas do gateway, tributos e custos são registrados à parte. Ainda dependem da WAPE (registrar em aditivo):
 * quem suporta as tarifas do Asaas e quais transações compõem o faturamento bruto elegível.
 */
export const OFFICIAL_REVENUE_SHARE = {
  wemobRate: "0.30",
  wemobPercent: 30,
  modelKey: "participacao-30-70",
  modelName: "Participação 30/70 sobre o faturamento bruto",
  sourceNote: "Regra comercial oficial informada pela WAPE em 2026-11-03: WeMob 30% / posto 70% do faturamento bruto mensal. Substitui a taxa de 14% (sistema + gateway). Responsável pelas tarifas do Asaas e base elegível: pendentes de decisão da WAPE.",
} as const;

/** Modelos com a taxa de 14% (sistema + gateway), SUBSTITUÍDOS pela participação 30/70 — mantidos só como histórico. */
export const LEGACY_14_MODEL_KEYS = ["compra-integral", "parceria-50-50"] as const;

export const REFERENCE_TERMS: Record<"compra-integral" | "parceria-50-50", CommercialTerms> = {
  "compra-integral": {
    modelKey: "compra-integral",
    modelName: "Compra integral (100%)",
    referenceInvestment: 150000,
    partnerCapitalShare: 1,
    partnerResultShare: 1,
    royaltyRate: 0.05,
    royaltyBase: "GROSS_REVENUE",
    platformFeeRate: 0.14,
    platformFeeBase: "GROSS_REVENUE",
    taxRate: 0.06,
    taxBase: "GROSS_REVENUE",
    // Portfólio: "taxa de sistema + gateway de pagamento: 14% por transação" → gateway incluso.
    platformFeeIncludesGateway: true,
    lossTreatment: "SHARE_MONTHLY",
  },
  "parceria-50-50": {
    modelKey: "parceria-50-50",
    modelName: "Parceria 50/50",
    // O portfólio informa R$ 75.000 para o parceiro = 50% de uma implantação de R$ 150.000.
    referenceInvestment: 150000,
    partnerCapitalShare: 0.5,
    partnerResultShare: 0.5,
    // Slide 13: "8% sobre o faturamento bruto recebido". Interpretado como bruto; ajuste a base se o contrato definir outra.
    royaltyRate: 0.08,
    royaltyBase: "GROSS_REVENUE",
    platformFeeRate: 0.14,
    platformFeeBase: "GROSS_REVENUE",
    taxRate: 0.06,
    taxBase: "GROSS_REVENUE",
    // Portfólio: "taxa de sistema + gateway de pagamento: 14% por transação" → gateway incluso.
    platformFeeIncludesGateway: true,
    lossTreatment: "SHARE_MONTHLY",
  },
};

/**
 * Termos de referência da participação 30/70 para o SIMULADOR: a participação da WeMob entra como "taxa de sistema"
 * sobre o bruto (mesmo valor), sem royalty, e o posto fica com todo o resultado depois dela. Tarifas do gateway ficam à
 * parte (responsável pendente). Investimento e tributos são REFERÊNCIA do portfólio (a divisão do investimento no
 * modelo 30/70 ainda não foi informada pela WAPE).
 */
export const REVENUE_SHARE_TERMS: CommercialTerms = {
  modelKey: OFFICIAL_REVENUE_SHARE.modelKey,
  modelName: OFFICIAL_REVENUE_SHARE.modelName,
  referenceInvestment: 150000,
  partnerCapitalShare: 1,
  partnerResultShare: 1,
  royaltyRate: 0,
  royaltyBase: "GROSS_REVENUE",
  platformFeeRate: 0.3,
  platformFeeBase: "GROSS_REVENUE",
  taxRate: 0.06,
  taxBase: "GROSS_REVENUE",
  platformFeeIncludesGateway: false,
  lossTreatment: "SHARE_MONTHLY",
  revenueShareRate: 0.3,
};

export const REFERENCE_RESPONSIBILITIES = {
  [OFFICIAL_REVENUE_SHARE.modelKey]: {
    sansol: ["Recebe 30% do faturamento bruto mensal do posto", "Marca, aplicativo, sistema de gestão e meios de pagamento", "Monitoramento da rede e suporte ao motorista"],
    partner: ["Recebe 70% do faturamento bruto mensal do posto", "Responsabilidades de investimento, energia e manutenção: conforme contrato (a definir pela WAPE)"],
  },
  "compra-integral": {
    sansol: ["Estudo de viabilidade e projeto técnico", "Implantação contratada", "Marca, aplicativo e sistema de gestão", "Suporte e manutenção conforme contrato"],
    partner: ["Investimento integral da implantação", "Custos operacionais da unidade", "Manutenção cobrada quando houver"],
  },
  "parceria-50-50": {
    sansol: ["Investe 50% da implantação", "Desenvolve e coordena o projeto", "Negocia e gerencia fornecedores", "Disponibiliza marca, aplicativo e sistema", "Viabiliza energia competitiva", "Suporte técnico e manutenção", "Participa de 50% dos custos e do resultado líquido"],
    partner: ["Investe 50% da implantação", "Disponibiliza o espaço físico", "Viabiliza a infraestrutura elétrica local", "Mantém a identidade Sansol Mob no ponto", "Contribui com fluxo e divulgação local", "Apoia a operação cotidiana", "Participa de 50% dos custos e do resultado líquido"],
  },
} as const;
