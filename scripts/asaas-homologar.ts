/**
 * Homologação no SANDBOX OFICIAL do Asaas (Etapa B). Fala com a API real de testes — não com o servidor falso
 * dos testes automatizados. Recusa-se a rodar em produção.
 *
 * Uso: npm run asaas:homologar [-- --aguardar-pagamento=10]
 *   Sem a opção, cria cliente e cobrança Pix, confere idempotência e QR Code e REMOVE a cobrança pendente.
 *   Com a opção, espera até N minutos você confirmar o pagamento no painel do sandbox; confirmado, faz um
 *   estorno parcial de R$ 1,00 e acompanha seu status.
 * Relatório (sem chaves, sem documento completo): docs/homologacao/asaas-sandbox-<data>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { readAsaasConfig } from "../src/server/payments/asaas/config";
import { createAsaasProvider } from "../src/server/payments/asaas/provider";
import { AsaasError } from "../src/server/payments/asaas/client";
import { documentHint } from "../src/domain/br/document";
import { safeInvoiceUrl } from "../src/domain/payments/invoice-url";

type Step = { step: string; ok: boolean; ms: number; detail?: Record<string, unknown>; error?: string };

/** CPF válido gerado para o sandbox (dígitos verificadores corretos; não pertence a ninguém conhecido). */
function testCpf() {
  const base = Array.from({ length: 9 }, () => randomInt(0, 10));
  const dv = (digits: number[]) => {
    const r = (digits.reduce((a, d, i) => a + d * (digits.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join("");
}

async function main() {
  const waitArg = process.argv.find((a) => a.startsWith("--aguardar-pagamento"));
  const waitMinutes = waitArg ? Math.min(30, Math.max(1, Number(waitArg.split("=")[1] ?? 10) || 10)) : 0;

  const cfgR = readAsaasConfig();
  if (!cfgR.ok) throw new Error(`Configuração do Asaas incompleta: ${cfgR.errors.join(" ")}`);
  if (cfgR.config.environment !== "SANDBOX") throw new Error("Recusado: a homologação só roda com ASAAS_ENVIRONMENT=sandbox.");
  const asaas = createAsaasProvider(cfgR.config);
  const steps: Step[] = [];
  const run = async <T>(step: string, fn: () => Promise<{ value: T; detail?: Record<string, unknown> }>): Promise<T | null> => {
    const t = Date.now();
    try {
      const { value, detail } = await fn();
      steps.push({ step, ok: true, ms: Date.now() - t, detail });
      console.log(`✓ ${step}`, detail ?? "");
      return value;
    } catch (e) {
      const error = e instanceof AsaasError ? `${e.kind} ${e.httpStatus ?? ""} ${e.message}` : e instanceof Error ? e.message : String(e);
      steps.push({ step, ok: false, ms: Date.now() - t, error });
      console.log(`✗ ${step}: ${error}`);
      return null;
    }
  };

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13);
  const custRef = `wemob:homologacao:${stamp}`;
  const chargeRef = `homolog:${stamp}`;

  await run("autenticação (GET /customers)", async () => {
    const r = await asaas.client.request<{ totalCount?: number }>("GET", "/customers", undefined, { limit: 1 });
    return { value: true, detail: { totalCount: r.totalCount ?? null } };
  });

  const cpf = testCpf();
  const customerId = await run("criação de cliente (POST /customers)", async () => {
    const c = await asaas.client.request<{ id: string }>("POST", "/customers", { name: "Homologação WeMob", cpfCnpj: cpf, externalReference: custRef, notificationDisabled: true });
    return { value: c.id, detail: { customerId: c.id, documento: documentHint(cpf) } };
  });

  const charge = customerId
    ? await run("cobrança Pix R$ 5,00 (POST /payments)", async () => {
        const p = await asaas.authorize("5.00", {}, { externalReference: chargeRef, customerRemoteId: customerId, description: "Homologação WeMob — não é recarga real" });
        return { value: p, detail: { paymentId: p.providerRef, remoteStatus: p.remoteStatus, local: p.status } };
      })
    : null;

  if (charge) {
    await run("idempotência: busca pela chave externa", async () => {
      const found = await asaas.findByExternalReference!(chargeRef);
      if (found.length !== 1) throw new Error(`Esperada 1 cobrança para a chave, encontradas ${found.length}.`);
      return { value: true, detail: { encontradas: found.length } };
    });
    await run("QR Code Pix (GET /payments/{id}/pixQrCode)", async () => {
      const q = await asaas.getPixQrCode!(charge.providerRef);
      if (!q.payload?.startsWith("000201")) throw new Error("payload Pix inesperado.");
      return { value: true, detail: { payloadPrefix: q.payload.slice(0, 6), expira: q.expirationDate } };
    });

    let paid = false;
    if (waitMinutes) {
      console.log(`\nConfirme o pagamento da cobrança ${charge.providerRef} no painel do sandbox do Asaas. Aguardando até ${waitMinutes} min…`);
      await run("confirmação do pagamento (consulta autenticada)", async () => {
        const until = Date.now() + waitMinutes * 60_000;
        let falhasDeRede = 0;
        let ultimoStatus = "";
        while (Date.now() < until) {
          try {
            const p = await asaas.fetch(charge.providerRef);
            if (p.remoteStatus !== ultimoStatus) console.log(`  status no Asaas: ${(ultimoStatus = p.remoteStatus ?? "")}`);
            if (p.status === "CAPTURED") {
              paid = true;
              return { value: true, detail: { remoteStatus: p.remoteStatus, netValue: p.netValue, falhasDeRede } };
            }
          } catch (e) {
            // Rede instável (ex.: máquina em repouso) não encerra a espera; erros de validação/autenticação sim.
            if (!(e instanceof AsaasError) || !["UNAVAILABLE", "TIMEOUT", "RATE_LIMIT"].includes(e.kind)) throw e;
            falhasDeRede++;
            console.log(`  (consulta falhou: ${e.kind}; tentando de novo)`);
          }
          await new Promise((r) => setTimeout(r, 15_000));
        }
        throw new Error("Pagamento não confirmado no prazo.");
      });
    }

    if (paid) {
      await run("estorno parcial R$ 1,00 (POST /payments/{id}/refund)", async () => {
        const p = await asaas.refund(charge.providerRef, "1.00", { description: "Homologação WeMob" });
        return { value: true, detail: { local: p.status, estornos: p.refunds?.map((r) => r.status) ?? [] } };
      });
    } else {
      await run("remoção da cobrança pendente (DELETE /payments/{id})", async () => {
        const p = await asaas.cancel(charge.providerRef);
        return { value: true, detail: { local: p.status, remoteStatus: p.remoteStatus } };
      });
    }
  }

  // Cartão: cobrança CREDIT_CARD paga na página do Asaas (invoiceUrl). Nenhum dado de cartão é enviado; é removida em seguida.
  const card = customerId
    ? await run("cobrança cartão R$ 5,00 (POST /payments, CREDIT_CARD)", async () => {
        const p = await asaas.authorize("5.00", {}, { externalReference: `${chargeRef}:cartao`, customerRemoteId: customerId, description: "Homologação WeMob (cartão) — não é recarga real", billingType: "CREDIT_CARD" });
        if (!safeInvoiceUrl(p.invoiceUrl ?? null)) throw new Error("O Asaas não devolveu uma página de pagamento HTTPS do próprio Asaas.");
        return { value: p, detail: { paymentId: p.providerRef, remoteStatus: p.remoteStatus, paginaDePagamento: new URL(p.invoiceUrl!).hostname } };
      })
    : null;
  if (card) {
    await run("remoção da cobrança de cartão (DELETE /payments/{id})", async () => {
      const p = await asaas.cancel(card.providerRef);
      return { value: true, detail: { local: p.status, remoteStatus: p.remoteStatus } };
    });
  }

  const report = {
    executadoEm: new Date().toISOString(),
    ambiente: "SANDBOX",
    baseUrl: cfgR.config.baseUrl,
    observacao: "Webhook e split exigem endpoint público e carteiras de teste: registrar manualmente (ver docs/asaas.md).",
    passos: steps,
    aprovado: steps.every((s) => s.ok),
  };
  mkdirSync("docs/homologacao", { recursive: true });
  const file = `docs/homologacao/asaas-sandbox-${stamp}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nRelatório: ${file} — ${report.aprovado ? "todos os passos OK" : "há passos com falha"}`);
  process.exit(report.aprovado ? 0 : 2);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
