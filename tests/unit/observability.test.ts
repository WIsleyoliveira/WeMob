import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { renderMetrics } from "@/domain/ops/metrics";
import { metricsAuthorized } from "@/server/modules/ops/metrics";
import { correlationId, isValidCorrelationId, withCorrelation } from "@/server/correlation";
import { log } from "@/server/log";
import { middleware } from "@/middleware";

describe("métricas (formato Prometheus)", () => {
  it("HELP/TYPE por métrica, rótulos escapados, sem NaN silencioso", () => {
    const txt = renderMetrics([
      { name: "wemob_up", help: "ok", type: "gauge", samples: [{ value: 1 }] },
      { name: "wemob_stations", help: "estações", type: "gauge", samples: [{ labels: { environment: "PRODUCTION", state: 'a"b\\c' }, value: 3 }] },
    ]);
    expect(txt).toBe('# HELP wemob_up ok\n# TYPE wemob_up gauge\nwemob_up 1\n# HELP wemob_stations estações\n# TYPE wemob_stations gauge\nwemob_stations{environment="PRODUCTION",state="a\\"b\\\\c"} 3\n');
    expect(() => renderMetrics([{ name: "nome inválido", help: "", type: "gauge", samples: [] }])).toThrow();
  });

  it("token: desligado sem configuração ou curto; exige Bearer exato", () => {
    const token = "x".repeat(32);
    expect(metricsAuthorized(`Bearer ${token}`, undefined)).toBe(false);
    expect(metricsAuthorized("Bearer curto", "curto")).toBe(false);
    expect(metricsAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(metricsAuthorized(`Bearer ${token}x`, token)).toBe(false);
    expect(metricsAuthorized(null, token)).toBe(false);
  });
});

describe("ID de correlação", () => {
  it("logs dentro do contexto levam o requestId; fora, não", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    withCorrelation("req-12345678", () => log.info("dentro", { x: 1 }));
    log.info("fora");
    const [inside, outside] = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
    spy.mockRestore();
    expect(inside).toMatchObject({ msg: "dentro", requestId: "req-12345678", x: 1 });
    expect(outside.requestId).toBeUndefined();
  });

  it("ID inválido (curto, com espaço ou injeção) é trocado por um novo; contexto vale dentro de await", async () => {
    expect(isValidCorrelationId("abc")).toBe(false);
    expect(isValidCorrelationId("a b c d e f g h")).toBe(false);
    expect(isValidCorrelationId("ok-id-12345\nInjetado")).toBe(false);
    const id = await withCorrelation("x\ny", async () => {
      await new Promise((r) => setTimeout(r, 1));
      return correlationId();
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("middleware: reaproveita x-request-id válido do proxy e gera um novo quando ausente ou inválido", () => {
    const keep = middleware(new NextRequest("http://localhost/app", { headers: { "x-request-id": "proxy-abc-123456" } }));
    expect(keep.headers.get("x-request-id")).toBe("proxy-abc-123456");
    expect(keep.headers.get("x-middleware-request-x-request-id")).toBe("proxy-abc-123456"); // repassado ao servidor
    const fresh = middleware(new NextRequest("http://localhost/app", { headers: { "x-request-id": "<script>" } }));
    expect(fresh.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
