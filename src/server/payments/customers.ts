/**
 * Pagador no gateway. O Asaas permite clientes duplicados: reutilizamos o id gravado; sem ele, procuramos
 * por externalReference (cobre retry após timeout) e só então criamos. Lock por motorista+operadora evita
 * criação concorrente. O CPF/CNPJ fica cifrado na WeMob e só é decifrado para este envio.
 */
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { decryptField, sha256 } from "@/server/crypto";
import { AsaasError } from "./asaas/client";
import type { createAsaasProvider } from "./asaas/provider";

type Asaas = ReturnType<typeof createAsaasProvider>;
/**
 * Chave externa do pagador. Inclui um hash curto do documento: se o motorista trocar o CPF/CNPJ, a busca não
 * reaproveita o cadastro remoto antigo (com o documento anterior) — um novo cliente é criado/reaproveitado.
 */
export const customerReference = (driverId: string, documentDigits: string) => `wemob:driver:${driverId}:${sha256(documentDigits).slice(0, 12)}`;

export async function ensureGatewayCustomer(provider: Asaas, operatorId: string, driverId: string) {
  const env = provider.environment;
  const found = await db.gatewayCustomer.findUnique({ where: { provider_environment_operatorId_driverId: { provider: provider.name, environment: env, operatorId, driverId } } });
  if (found) return found.remoteId;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gwcustomer:${operatorId}:${driverId}`}))`;
    const again = await tx.gatewayCustomer.findUnique({ where: { provider_environment_operatorId_driverId: { provider: provider.name, environment: env, operatorId, driverId } } });
    if (again) return again.remoteId;
    const driver = await tx.driver.findUniqueOrThrow({ where: { id: driverId } });
    if (!driver.documentEnc) throw new AppError("VALIDATION", "Informe seu CPF em Minha conta para pagar a recarga.");
    const document = decryptField(driver.documentEnc);
    const ref = customerReference(driverId, document);
    let remoteId: string | undefined;
    try {
      const existing = await provider.client.request<{ data: { id: string }[] }>("GET", "/customers", undefined, { externalReference: ref, limit: 1 });
      remoteId = existing.data?.[0]?.id;
      if (!remoteId) {
        const created = await provider.client.request<{ id: string }>("POST", "/customers", {
          name: driver.name, cpfCnpj: document, email: driver.email, externalReference: ref, notificationDisabled: true,
        });
        remoteId = created.id;
      }
    } catch (e) {
      if (e instanceof AsaasError && e.kind === "VALIDATION") throw new AppError("VALIDATION", `Cadastro recusado pelo Asaas: ${e.message}`);
      if (e instanceof AsaasError && e.kind === "TIMEOUT") throw new AppError("VALIDATION", "O Asaas não respondeu ao cadastro. Tente novamente em instantes (o cadastro será reaproveitado).");
      throw e;
    }
    await tx.gatewayCustomer.create({ data: { provider: provider.name, environment: env, operatorId, driverId, remoteId } });
    return remoteId;
  }, { timeout: 45_000 });
}
