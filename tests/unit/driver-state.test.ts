import { describe, expect, it } from "vitest";
import { canRequestStop, startStage, stopStage } from "@/domain/charging/driver-state";

describe("estados da recarga vistos pelo motorista (P23 B1)", () => {
  it("início: enviada ≠ aceita ≠ iniciada; só STARTED conta como recarga iniciada", () => {
    expect(startStage("AWAITING_PAYMENT", null)).toBe("PAYMENT_PENDING");
    expect(startStage("START_REQUESTED", null)).toBe("START_SENDING");
    expect(startStage("START_REQUESTED", "PENDING")).toBe("START_SENDING");
    expect(startStage("START_REQUESTED", "SENT")).toBe("START_SENDING");
    expect(startStage("START_REQUESTED", "ACCEPTED")).toBe("START_ACCEPTED");
    for (const c of ["REJECTED", "TIMEOUT", "FAILED", "BLOCKED"] as const) expect(startStage("START_REQUESTED", c)).toBe("START_REFUSED");
    expect(startStage("STARTED", "ACCEPTED")).toBe("STARTED");
    for (const r of ["FAILED", "CANCELLED", "EXPIRED"] as const) expect(startStage(r, "ACCEPTED")).toBe("ENDED");
  });

  it("encerramento: solicitado/aceito não é encerrado; só a sessão concluída é STOPPED", () => {
    expect(stopStage("ACTIVE", null)).toBe("NONE");
    expect(stopStage("ACTIVE", "PENDING")).toBe("STOP_SENDING");
    expect(stopStage("ACTIVE", "SENT")).toBe("STOP_SENDING");
    expect(stopStage("ACTIVE", "ACCEPTED")).toBe("STOP_ACCEPTED");
    expect(stopStage("ACTIVE", "TIMEOUT")).toBe("STOP_REFUSED");
    expect(stopStage("COMMUNICATION_LOST", "ACCEPTED")).toBe("STOP_ACCEPTED");
    expect(stopStage("COMPLETED", null)).toBe("STOPPED");
    expect(stopStage("COMPLETED", "PENDING")).toBe("STOPPED");
  });

  it("o botão de encerrar não reaparece com pedido em curso nem sem comunicação", () => {
    expect(canRequestStop("ACTIVE", "NONE")).toBe(true);
    expect(canRequestStop("ACTIVE", "STOP_SENDING")).toBe(false);
    expect(canRequestStop("ACTIVE", "STOP_ACCEPTED")).toBe(false);
    expect(canRequestStop("ACTIVE", "STOP_REFUSED")).toBe(true);
    expect(canRequestStop("COMMUNICATION_LOST", "NONE")).toBe(false);
    expect(canRequestStop("COMPLETED", "STOPPED")).toBe(false);
  });
});
