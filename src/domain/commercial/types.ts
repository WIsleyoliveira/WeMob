import { z } from "zod";

export const FEE_BASES = ["GROSS_REVENUE", "GROSS_NET_OF_PAYMENT_FEES"] as const;
export type FeeBase = (typeof FEE_BASES)[number];

export const FEE_BASE_LABEL: Record<FeeBase, string> = {
  GROSS_REVENUE: "Faturamento bruto",
  GROSS_NET_OF_PAYMENT_FEES: "Bruto após taxa de sistema/gateway",
};

const fraction = z.coerce.number().min(0).max(1);

export const LOSS_TREATMENTS = ["SHARE_MONTHLY", "CARRY_FORWARD"] as const;
export const LOSS_TREATMENT_LABEL: Record<(typeof LOSS_TREATMENTS)[number], string> = {
  SHARE_MONTHLY: "Prejuízo rateado e aportado no próprio mês",
  CARRY_FORWARD: "Prejuízo acumulado e compensado antes de novas distribuições",
};

/** Condições comerciais aplicadas a uma simulação ou contrato (subconjunto de CommercialModelVersion). */
export const commercialTermsSchema = z.object({
  modelKey: z.string().min(1),
  modelName: z.string().min(1),
  versionId: z.string().optional(),
  version: z.number().int().positive().optional(),
  referenceInvestment: z.coerce.number().min(0),
  partnerCapitalShare: fraction,
  partnerResultShare: fraction,
  royaltyRate: fraction,
  royaltyBase: z.enum(FEE_BASES),
  platformFeeRate: fraction,
  platformFeeBase: z.enum(FEE_BASES),
  taxRate: fraction,
  taxBase: z.enum(FEE_BASES),
  /** true: a taxa de sistema já inclui o gateway — custo de gateway à parte é recusado (dupla contagem). */
  platformFeeIncludesGateway: z.boolean().default(true),
  /** Base da partilha: resultado operacional mensal. Tratamento de prejuízo configurável. */
  lossTreatment: z.enum(LOSS_TREATMENTS).default("SHARE_MONTHLY"),
});
export type CommercialTerms = z.infer<typeof commercialTermsSchema>;

export const commercialVersionDraftSchema = commercialTermsSchema
  .omit({ modelKey: true, modelName: true, versionId: true, version: true })
  .extend({
    maintenancePolicy: z.string().trim().min(3).max(500),
    sourceNote: z.string().trim().max(1000).optional(),
    effectiveFrom: z.coerce.date().optional(),
  })
  .refine((v) => v.platformFeeBase === "GROSS_REVENUE", {
    message: "A taxa de sistema/gateway só pode incidir sobre o faturamento bruto (evita base circular).",
    path: ["platformFeeBase"],
  });
export type CommercialVersionDraft = z.infer<typeof commercialVersionDraftSchema>;
