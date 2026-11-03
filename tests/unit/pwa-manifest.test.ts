import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("PWA do motorista", () => {
  it("manifest instalável: escopo do motorista, standalone e ícones 192/512 (inclui maskable) que existem em public/", () => {
    const m = manifest();
    expect(m).toMatchObject({ start_url: "/motorista", scope: "/motorista", display: "standalone", lang: "pt-BR" });
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect((m.icons ?? []).some((i) => i.purpose === "maskable")).toBe(true);
    for (const i of m.icons ?? []) expect(existsSync(`public${i.src}`)).toBe(true);
  });

  it("sem service worker: nenhuma resposta financeira fica em cache do app", () => {
    expect(existsSync("public/sw.js")).toBe(false);
    expect(existsSync("public/service-worker.js")).toBe(false);
  });
});
