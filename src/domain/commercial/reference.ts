import type { CommercialTerms } from "./types";

/**
 * Parâmetros de REFERÊNCIA extraídos do "Portfólio Comercial Sansol Mob" (slides 4, 11, 12 e 13).
 * Não são condições contratuais: valem apenas como ponto de partida para versões em rascunho,
 * que precisam ser revisadas e aprovadas por um administrador autorizado.
 */
export const PORTFOLIO_SOURCE_NOTE =
  "Portfólio Comercial Sansol Mob (.pptx), slides 4, 11, 12 e 13. Parâmetros de referência, sujeitos a contrato.";

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

export const REFERENCE_RESPONSIBILITIES = {
  "compra-integral": {
    sansol: ["Estudo de viabilidade e projeto técnico", "Implantação contratada", "Marca, aplicativo e sistema de gestão", "Suporte e manutenção conforme contrato"],
    partner: ["Investimento integral da implantação", "Custos operacionais da unidade", "Manutenção cobrada quando houver"],
  },
  "parceria-50-50": {
    sansol: ["Investe 50% da implantação", "Desenvolve e coordena o projeto", "Negocia e gerencia fornecedores", "Disponibiliza marca, aplicativo e sistema", "Viabiliza energia competitiva", "Suporte técnico e manutenção", "Participa de 50% dos custos e do resultado líquido"],
    partner: ["Investe 50% da implantação", "Disponibiliza o espaço físico", "Viabiliza a infraestrutura elétrica local", "Mantém a identidade Sansol Mob no ponto", "Contribui com fluxo e divulgação local", "Apoia a operação cotidiana", "Participa de 50% dos custos e do resultado líquido"],
  },
} as const;
