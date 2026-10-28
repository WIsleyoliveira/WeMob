import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function loadingFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...loadingFiles(p));
    else if (name === "loading.tsx" || name === "loading.ts") out.push(p);
  }
  return out;
}

describe("fronteiras de carregamento", () => {
  // P19 (reproduzido no build de produção, Next 15.5): com src/app/app/loading.tsx, toda server action que
  // devolve estado e chama revalidatePath deixava o formulário em "Salvando…" para sempre, e router.refresh()
  // era descartado. Sem a fronteira, as mesmas ações concluem em ~1 s (E2E de navegador).
  it("a área /app não tem loading.tsx (quebra server actions com revalidatePath no build de produção)", () => {
    expect(existsSync("src/app/app")).toBe(true);
    expect(loadingFiles("src/app/app")).toEqual([]);
  });
});
