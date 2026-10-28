/**
 * Transferências bancárias (repasses). NENHUM provedor está contratado: a plataforma nunca
 * inicia transferência. O fluxo suportado é pagar pelo banco e registrar a baixa manual.
 * Um adaptador real precisará: credenciais do banco/PSP, autorização explícita (finance:approve),
 * confirmação final do valor e do favorecido, e idempotência por lançamento.
 */
import { z } from "zod";
import { AppError } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";

export function payoutProviderStatus() {
  return { status: "not_configured" as const, name: "nenhum", message: "Transferência bancária não configurada: nenhuma transferência é iniciada pela plataforma. Pague pelo banco e registre a baixa." };
}

export async function initiatePayout(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "finance:approve");
  requireOperator(ctx);
  z.object({ entryId: z.string(), confirm: z.literal(true, { error: "Confirmação final obrigatória." }) }).parse(raw);
  const p = payoutProviderStatus();
  if (p.status === "not_configured") throw new AppError("CONFLICT", p.message);
}
