import { describe, expect, it } from "vitest";
import { DEVICE_TOUCH_INTERVAL_MS, UNKNOWN_DEVICE, describeDevice, shouldTouchDevice } from "@/domain/drivers/device";
import { readingFreshness } from "@/domain/charging/driver-state";

describe("aparelhos conectados do motorista", () => {
  it("rótulo só com navegador e sistema (sem versão nem modelo do aparelho)", () => {
    const cases: [string, string][] = [
      ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Chrome no Android"],
      ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet no Android"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari no iPhone"],
      ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1", "Chrome no iPhone"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge no Windows"],
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox no macOS"],
      ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0", "Opera no Linux"],
      ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36", "Chrome no Linux"],
    ];
    for (const [ua, label] of cases) expect(describeDevice(ua)).toBe(label);
    expect(describeDevice("Mozilla/5.0 (Linux; Android 14; SM-S918B)")).toBe("Android");
    expect(describeDevice("curl/8.7.1")).toBe(UNKNOWN_DEVICE);
    expect(describeDevice(undefined)).toBe(UNKNOWN_DEVICE);
    expect(describeDevice("")).toBe(UNKNOWN_DEVICE);
    expect(describeDevice("SM-S918B")).not.toContain("SM-S918B");
  });

  it("último uso: grava no primeiro acesso e depois no máximo a cada 5 minutos", () => {
    const now = new Date("2026-11-03T12:00:00Z");
    expect(shouldTouchDevice(null, now)).toBe(true);
    expect(shouldTouchDevice(new Date(now.getTime() - DEVICE_TOUCH_INTERVAL_MS + 1000), now)).toBe(false);
    expect(shouldTouchDevice(new Date(now.getTime() - DEVICE_TOUCH_INTERVAL_MS), now)).toBe(true);
  });
});

describe("confiabilidade da leitura durante a recarga", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it("com comunicação em dia, ou recarga encerrada, os valores valem como estão", () => {
    expect(readingFreshness("ACTIVE", true, ago(1), now)).toEqual({ kind: "LIVE" });
    expect(readingFreshness("COMPLETED", false, ago(90), now)).toEqual({ kind: "LIVE" });
  });

  it("sessão ainda ativa mas estação fora do prazo: atrasada, com minutos desde a última comunicação", () => {
    expect(readingFreshness("ACTIVE", false, ago(12), now)).toEqual({ kind: "DELAYED", minutesSinceSeen: 12 });
    expect(readingFreshness("ACTIVE", false, null, now)).toEqual({ kind: "DELAYED", minutesSinceSeen: null });
  });

  it("sessão marcada sem comunicação é sempre LOST, mesmo que a estação volte a parecer em dia", () => {
    expect(readingFreshness("COMMUNICATION_LOST", false, ago(30), now)).toEqual({ kind: "LOST", minutesSinceSeen: 30 });
    expect(readingFreshness("COMMUNICATION_LOST", true, ago(0), now)).toEqual({ kind: "LOST", minutesSinceSeen: 0 });
    // relógio adiantado no registro não gera minutos negativos
    expect(readingFreshness("COMMUNICATION_LOST", false, new Date(now.getTime() + 60_000), now)).toEqual({ kind: "LOST", minutesSinceSeen: 0 });
  });
});
