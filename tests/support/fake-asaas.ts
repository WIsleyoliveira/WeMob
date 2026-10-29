/**
 * Servidor Asaas FALSO, em memória, para testes automatizados. Reproduz o formato documentado dos
 * endpoints usados (docs.asaas.com, 2026-10-27) — NÃO é prova de compatibilidade com a API real, que só
 * é verificada no sandbox oficial (npm run asaas:homologar).
 */
import type { FetchLike } from "@/server/payments/asaas/client";

type Split = { id: string; walletId: string; fixedValue?: number; percentualValue?: number; totalValue?: number; status: string; externalReference?: string; cancellationReason?: string | null };
type Refund = { status: string; value: number; description?: string | null; dateCreated: string };
type Pay = { id: string; customer: string; billingType: string; value: number; netValue: number; status: string; dueDate: string; externalReference?: string; deleted: boolean; refunds: Refund[]; split: Split[]; dateCreated: string; description?: string };

export function createFakeAsaas(opts: { apiKey: string; fee?: number; knownWallets?: string[] }) {
  const fee = opts.fee ?? 0.99;
  const customers = new Map<string, { id: string; name: string; cpfCnpj: string; externalReference?: string }>();
  const payments = new Map<string, Pay>();
  let seq = 0;
  const control = {
    /** Processa o próximo POST /payments mas não devolve resposta (simula timeout após o envio). */
    timeoutAfterProcessingNextPayment: false,
    /** Falha o próximo POST /payments antes de processar (timeout sem efeito). */
    timeoutBeforeProcessingNextPayment: false,
    rejectNextPayment: null as null | string,
    failAllRequests: false,
    failGetPayment: false,
    refundStatus: "DONE" as "DONE" | "PENDING" | "AWAITING_CRITICAL_ACTION_AUTHORIZATION",
    /** Estorno processado no gateway, mas a resposta se perde (timeout) — resultado incerto para a WeMob. */
    timeoutAfterProcessingNextRefund: false,
    /** Gateway responde 503 ANTES de processar o próximo estorno (nada foi estornado). */
    unavailableBeforeNextRefund: false,
    /** Atraso (ms) na resposta de POST /refund — permite sobrepor execuções concorrentes nos testes. */
    refundDelayMs: 0,
    /** Atraso (ms) na resposta de GET /payments/{id}. */
    getDelayMs: 0,
    rejectRefund: null as null | string,
    requests: [] as { method: string; path: string; userAgent?: string; body?: string }[],
  };
  const wallets = new Set(opts.knownWallets ?? []);

  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body), headers: { get: () => null } });
  const err = (status: number, description: string) => json(status, { errors: [{ code: "invalid_action", description }] });
  const abort = () => {
    const e = new Error("The operation was aborted");
    e.name = "AbortError";
    return Promise.reject(e);
  };
  const view = (p: Pay) => ({ object: "payment", ...p, invoiceUrl: `https://sandbox.asaas.com/i/${p.id.slice(4)}`, split: p.split.length ? p.split : undefined, refunds: p.refunds.length ? p.refunds : null });

  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v3/, "");
    control.requests.push({ method: init.method, path, userAgent: init.headers["User-Agent"], body: init.body });
    if (control.failAllRequests) throw new TypeError("fetch failed");
    if (init.headers.access_token !== opts.apiKey) return err(401, "A chave de API fornecida é inválida");
    const body = init.body ? JSON.parse(init.body) : {};
    let m: RegExpMatchArray | null;

    if (path === "/customers" && init.method === "GET") {
      const ref = u.searchParams.get("externalReference");
      return json(200, { object: "list", hasMore: false, data: [...customers.values()].filter((c) => !ref || c.externalReference === ref) });
    }
    if (path === "/customers" && init.method === "POST") {
      if (!body.name || !/^\d{11}$|^\d{14}$/.test(body.cpfCnpj ?? "")) return err(400, "O CPF/CNPJ informado é inválido.");
      const c = { id: `cus_${++seq}`, name: body.name, cpfCnpj: body.cpfCnpj, externalReference: body.externalReference };
      customers.set(c.id, c);
      return json(200, c);
    }
    if (path === "/payments" && init.method === "POST") {
      if (control.timeoutBeforeProcessingNextPayment) {
        control.timeoutBeforeProcessingNextPayment = false;
        return abort();
      }
      if (control.rejectNextPayment) {
        const d = control.rejectNextPayment;
        control.rejectNextPayment = null;
        return err(400, d);
      }
      if (!customers.has(body.customer)) return err(400, "Cliente inexistente.");
      if (!["PIX", "CREDIT_CARD"].includes(body.billingType) || !(body.value > 0)) return err(400, "Dados da cobrança inválidos.");
      const split: Split[] = [];
      for (const s of body.split ?? []) {
        if (!wallets.has(s.walletId)) return err(400, `A carteira ${s.walletId} não foi encontrada.`);
        split.push({ id: `spl_${++seq}`, walletId: s.walletId, fixedValue: s.fixedValue, percentualValue: s.percentualValue, externalReference: s.externalReference, status: "PENDING" });
      }
      const p: Pay = {
        id: `pay_${++seq}`, customer: body.customer, billingType: body.billingType, value: body.value, netValue: Math.round((body.value - fee) * 100) / 100, status: "PENDING",
        dueDate: body.dueDate, externalReference: body.externalReference, deleted: false, refunds: [], split, dateCreated: new Date().toISOString().slice(0, 10), description: body.description,
      };
      for (const s of p.split) s.totalValue = Math.round(((s.fixedValue ?? 0) + ((s.percentualValue ?? 0) * p.netValue) / 100) * 100) / 100;
      payments.set(p.id, p);
      if (control.timeoutAfterProcessingNextPayment) {
        control.timeoutAfterProcessingNextPayment = false;
        return abort();
      }
      return json(200, view(p));
    }
    if (path === "/payments" && init.method === "GET") {
      const ref = u.searchParams.get("externalReference");
      const list = [...payments.values()].filter((p) => !ref || p.externalReference === ref);
      return json(200, { object: "list", hasMore: false, totalCount: list.length, data: list.map(view) });
    }
    if ((m = path.match(/^\/payments\/([^/]+)\/pixQrCode$/))) {
      const p = payments.get(m[1]);
      return p ? json(200, { encodedImage: "iVBORw0KGgo=", payload: `00020126580014br.gov.bcb.pix0136${p.id}5204000053039865406${p.value.toFixed(2)}`, expirationDate: `${p.dueDate} 23:59:59` }) : err(404, "Não encontrado");
    }
    if ((m = path.match(/^\/payments\/([^/]+)\/refund$/)) && init.method === "POST") {
      const p = payments.get(m[1]);
      if (!p) return err(404, "Não encontrado");
      if (control.refundDelayMs) await new Promise((r) => setTimeout(r, control.refundDelayMs));
      // Como no Asaas: sem `value` o estorno é integral; a recusa de parcial no mesmo dia não se aplica a ele.
      const full = body.value === undefined;
      if (control.rejectRefund && !(full && control.rejectRefund.includes("parcialmente"))) return err(400, control.rejectRefund);
      if (control.unavailableBeforeNextRefund) {
        control.unavailableBeforeNextRefund = false;
        return json(503, { errors: [] });
      }
      if (!["RECEIVED", "CONFIRMED"].includes(p.status) && !p.refunds.length) return err(400, "Só é possível estornar cobranças recebidas.");
      const done = p.refunds.filter((r) => r.status !== "CANCELLED").reduce((a, r) => a + r.value, 0);
      const value = full ? p.value - done : body.value;
      if (value > p.value - done + 1e-9) return err(400, "Valor do estorno maior que o disponível.");
      // Visto no sandbox real (29/10/2026): no estorno integral (sem `value`) o Asaas devolve description: null.
      p.refunds.push({ status: control.refundStatus, value, description: full ? null : body.description, dateCreated: new Date().toISOString() });
      settleRefundStatus(p);
      if (control.timeoutAfterProcessingNextRefund) {
        control.timeoutAfterProcessingNextRefund = false;
        return abort();
      }
      return json(200, view(p));
    }
    if ((m = path.match(/^\/payments\/([^/]+)$/))) {
      const p = payments.get(m[1]);
      if (!p) return err(404, "Não encontrado");
      if (init.method === "GET") {
        if (control.failGetPayment) return json(503, { errors: [] });
        if (control.getDelayMs) await new Promise((r) => setTimeout(r, control.getDelayMs));
        return json(200, view(p));
      }
      if (init.method === "DELETE") {
        if (!["PENDING", "OVERDUE"].includes(p.status)) return err(400, "Não é possível remover cobrança já paga.");
        p.deleted = true;
        return json(200, { deleted: true, id: p.id });
      }
    }
    return err(404, `rota não simulada: ${init.method} ${path}`);
  };

  function settleRefundStatus(p: Pay) {
    const done = p.refunds.filter((r) => r.status === "DONE").reduce((a, r) => a + r.value, 0);
    if (done >= p.value - 1e-9) p.status = "REFUNDED";
    else if (p.refunds.some((r) => r.status === "PENDING")) p.status = "REFUND_IN_PROGRESS";
  }

  return {
    fetch,
    control,
    payments,
    customers,
    addWallet: (w: string) => wallets.add(w),
    /** Simula o pagamento do Pix pelo motorista (no app do banco). */
    pay(id: string, status: "RECEIVED" | "CONFIRMED" = "RECEIVED") {
      const p = payments.get(id)!;
      p.status = status;
      for (const s of p.split) s.status = "AWAITING_CREDIT";
    },
    completePendingRefunds(id: string) {
      const p = payments.get(id)!;
      for (const r of p.refunds) if (r.status === "PENDING") r.status = "DONE";
      settleRefundStatus(p);
      if (p.status === "REFUND_IN_PROGRESS") p.status = "RECEIVED";
    },
    settleSplits(id: string, status = "DONE") {
      for (const s of payments.get(id)!.split) s.status = status;
    },
    /** Cria cobrança direto no gateway (sem vínculo local) — para testar a conciliação. */
    createRemoteOnly(value: number, externalReference?: string) {
      const p: Pay = { id: `pay_${++seq}`, customer: "cus_x", billingType: "PIX", value, netValue: value - fee, status: "RECEIVED", dueDate: "2026-10-27", externalReference, deleted: false, refunds: [], split: [], dateCreated: new Date().toISOString().slice(0, 10) };
      payments.set(p.id, p);
      return p;
    },
    webhook(event: string, paymentId: string, token: string, eventId = `evt_${++seq}`) {
      const body = JSON.stringify({ id: eventId, event, dateCreated: "2026-10-27 12:00:00", payment: { object: "payment", id: paymentId, customer: "cus_pii", value: payments.get(paymentId)?.value } });
      return { body, headers: { "asaas-access-token": token } as Record<string, string> };
    },
  };
}
