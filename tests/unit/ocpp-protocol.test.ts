import { describe, expect, it } from "vitest";
import { parseFrame, readSample, SUPPORTED_INCOMING } from "@/server/ocpp/protocol";
import { connectorTimeShares, effectiveStatus } from "@/domain/stations/status";

describe("OCPP 1.6-J — enquadramento", () => {
  it("interpreta CALL, CALLRESULT e CALLERROR", () => {
    expect(parseFrame('[2,"a1","Heartbeat",{}]')).toEqual({ type: "CALL", id: "a1", action: "Heartbeat", payload: {} });
    expect(parseFrame('[3,"a1",{"currentTime":"x"}]')).toMatchObject({ type: "RESULT", id: "a1" });
    expect(parseFrame('[4,"a1","NotImplemented","x",{}]')).toMatchObject({ type: "ERROR", code: "NotImplemented" });
  });
  it("recusa mensagens malformadas com FormationViolation/ProtocolError", () => {
    expect(() => parseFrame("{")).toThrow(/JSON inválido/);
    expect(() => parseFrame('[2,"a1","Heartbeat"]')).toThrow(/CALL malformado/);
    expect(() => parseFrame('[2,"a1","Heartbeat",[]]')).toThrow(/Payload deve ser objeto/);
    expect(() => parseFrame('[9,"a1",{}]')).toThrow(/MessageTypeId/);
    expect(() => parseFrame(`[2,"${"x".repeat(40)}","Heartbeat",{}]`)).toThrow(/UniqueId/);
  });
  it("valida payloads das ações suportadas", () => {
    expect(SUPPORTED_INCOMING.StatusNotification.safeParse({ connectorId: 1, errorCode: "NoError", status: "Charging" }).success).toBe(true);
    expect(SUPPORTED_INCOMING.StatusNotification.safeParse({ connectorId: 1, errorCode: "NoError", status: "Ligado" }).success).toBe(false);
    expect(SUPPORTED_INCOMING.StartTransaction.safeParse({ connectorId: 0, idTag: "x", meterStart: 0, timestamp: new Date().toISOString() }).success).toBe(false);
    expect(SUPPORTED_INCOMING.Heartbeat.safeParse({ extra: 1 }).success).toBe(false);
  });
  it("converte amostras de energia e potência para Wh/W", () => {
    expect(readSample([{ value: "12.5", unit: "kWh", measurand: "Energy.Active.Import.Register" }], "Energy.Active.Import.Register")).toBe(12500);
    expect(readSample([{ value: "7400" }], "Energy.Active.Import.Register")).toBe(7400);
    expect(readSample([{ value: "22", unit: "kW", measurand: "Power.Active.Import" }], "Power.Active.Import")).toBe(22000);
    expect(readSample([{ value: "abc" }], "Energy.Active.Import.Register")).toBeNull();
    expect(readSample([{ value: "1", unit: "varh" }], "Energy.Active.Import.Register")).toBeNull();
  });
});

describe("regras de status", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const st = (lastSeenSec: number | null, state = "CONNECTED") => ({ connectionState: state, lastSeenAt: lastSeenSec === null ? null : new Date(now.getTime() - lastSeenSec * 1000), heartbeatInterval: 60 });
  it("sem comunicação nunca é disponível", () => {
    expect(effectiveStatus({ status: "AVAILABLE" }, st(30), now)).toEqual({ status: "AVAILABLE", stale: false });
    expect(effectiveStatus({ status: "AVAILABLE" }, st(181), now)).toEqual({ status: "UNKNOWN", stale: true }); // > 2×60 s + 60 s
    expect(effectiveStatus({ status: "AVAILABLE" }, st(10, "DISCONNECTED"), now).status).toBe("UNKNOWN");
    expect(effectiveStatus({ status: "AVAILABLE" }, st(null, "NEVER_CONNECTED"), now).status).toBe("UNKNOWN");
  });
  it("calcula utilização e disponibilidade por tempo em cada estado", () => {
    const from = new Date("2026-10-27T00:00:00Z");
    const to = new Date("2026-10-27T10:00:00Z");
    const at = (h: number) => new Date(from.getTime() + h * 3600_000);
    // 0–2 h desconhecido (antes do 1º evento), 2–4 disponível, 4–7 carregando, 7–8 falha, 8–10 disponível
    const r = connectorTimeShares(
      [{ status: "AVAILABLE", at: at(2) }, { status: "CHARGING", at: at(4) }, { status: "FAULTED", at: at(7) }, { status: "AVAILABLE", at: at(8) }],
      from, to,
    );
    expect(r.utilization).toBeCloseTo(0.3);
    expect(r.availability).toBeCloseTo(0.7);
    expect(r.unknownShare).toBeCloseTo(0.2);
  });
});
