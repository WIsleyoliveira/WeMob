import { describe, expect, it } from "vitest";
import { safeInvoiceUrl } from "@/domain/payments/invoice-url";

describe("página de pagamento do cartão", () => {
  it("aceita só HTTPS do domínio do Asaas", () => {
    expect(safeInvoiceUrl("https://sandbox.asaas.com/i/abc123")).toBe("https://sandbox.asaas.com/i/abc123");
    expect(safeInvoiceUrl("https://www.asaas.com/i/abc123")).toBe("https://www.asaas.com/i/abc123");
  });
  it("recusa outros domínios, HTTP, javascript: e imitações", () => {
    for (const u of ["http://sandbox.asaas.com/i/x", "https://asaas.com.evil.io/i/x", "https://evilasaas.com/i/x", "javascript:alert(1)", "não é url", "", null]) {
      expect(safeInvoiceUrl(u)).toBeNull();
    }
  });
});
