import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Todas as page.tsx sob uma rota dinâmica ([id], [identity]…). */
function dynamicPages(dir: string, inDynamic = false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...dynamicPages(p, inDynamic || name.startsWith("[")));
    else if (name === "page.tsx" && inDynamic) out.push(p);
  }
  return out;
}

describe("páginas de detalhe", () => {
  // P17: id inexistente mostrava a tela de erro genérica em vez de 404 (OS, chamado, contrato, fechamento).
  it("toda página que busca um registro pelo id trata o 'não encontrado' com notFound()", () => {
    const missing = dynamicPages("src/app").filter((p) => {
      const s = readFileSync(p, "utf8");
      return /await (get|load|find)[A-Z]\w*\(/.test(s) && !/notFound\(\)/.test(s);
    });
    expect(missing).toEqual([]);
  });
});
