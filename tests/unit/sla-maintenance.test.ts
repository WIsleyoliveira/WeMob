import { describe, expect, it } from "vitest";
import { CALENDAR_24X7, calendarMs, pausesFromEvents, slaElapsedMinutes, slaState } from "@/domain/support/sla";
import { planDue } from "@/domain/maintenance/plan";

const at = (s: string) => new Date(`${s}-03:00`);
const BUSINESS = { businessHoursOnly: true, workStartHour: 8, workEndHour: 18, workDays: [1, 2, 3, 4, 5] };

describe("SLA", () => {
  it("24×7 desconta pausas", () => {
    const created = at("2026-10-20T10:00:00");
    const pauses = pausesFromEvents([
      { kind: "PAUSE", createdAt: at("2026-10-20T10:30:00") },
      { kind: "RESUME", createdAt: at("2026-10-20T11:00:00") },
    ]);
    expect(slaElapsedMinutes(created, at("2026-10-20T11:30:00"), pauses, CALENDAR_24X7)).toBe(60);
  });

  it("pausa em aberto conta até o instante consultado", () => {
    const pauses = pausesFromEvents([{ kind: "PAUSE", createdAt: at("2026-10-20T10:15:00") }]);
    expect(slaElapsedMinutes(at("2026-10-20T10:00:00"), at("2026-10-20T12:00:00"), pauses, CALENDAR_24X7)).toBe(15);
  });

  it("horário útil seg–sex 8–18 (America/Belem): sexta 17h → segunda 9h = 120 min", () => {
    // 2026-10-23 é sexta-feira
    expect(calendarMs(at("2026-10-23T17:00:00"), at("2026-10-26T09:00:00"), BUSINESS) / 60000).toBe(120);
    expect(calendarMs(at("2026-10-24T09:00:00"), at("2026-10-25T20:00:00"), BUSINESS)).toBe(0); // fim de semana
  });

  it("estado: no prazo, em risco (≥ 80%), estourado, cumprido", () => {
    expect(slaState(100, 50, false)).toBe("OK");
    expect(slaState(100, 80, false)).toBe("AT_RISK");
    expect(slaState(100, 101, false)).toBe("BREACHED");
    expect(slaState(100, 100, true)).toBe("MET");
    expect(slaState(100, 120, true)).toBe("BREACHED");
    expect(slaState(null, 10, false)).toBe("NO_SLA");
  });
});

describe("preventiva", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("por tempo vence após o intervalo", () => {
    expect(planDue({ trigger: "TIME", intervalDays: 30, intervalKwh: null, intervalSessions: null }, { since: new Date("2026-09-26T12:00:00Z"), kwh: 0, sessions: 0, reliable: false }, now).due).toBe(true);
    expect(planDue({ trigger: "TIME", intervalDays: 30, intervalKwh: null, intervalSessions: null }, { since: new Date("2026-10-20T12:00:00Z"), kwh: 0, sessions: 0, reliable: false }, now).due).toBe(false);
  });
  it("por uso só vence com telemetria confiável", () => {
    const plan = { trigger: "ENERGY_KWH" as const, intervalDays: null, intervalKwh: 1000, intervalSessions: null };
    expect(planDue(plan, { since: now, kwh: 1500, sessions: 10, reliable: false, unreliableReason: "estação não é de produção" }, now)).toMatchObject({ due: false, reason: expect.stringContaining("Sem telemetria confiável") });
    expect(planDue(plan, { since: now, kwh: 1500, sessions: 10, reliable: true }, now).due).toBe(true);
    expect(planDue({ ...plan, trigger: "SESSIONS", intervalSessions: 20 }, { since: now, kwh: 0, sessions: 19, reliable: true }, now).due).toBe(false);
  });
});
