import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/server/auth/permissions";
import { PERMISSION_GROUPS } from "@/domain/auth/permission-labels";
import { AREA_LIST, areaPrefixes, auditArea, auditLabel } from "@/domain/audit/labels";

describe("textos da administração", () => {
  it("toda permissão do sistema tem descrição em linguagem simples (e nenhuma descrição sobra)", () => {
    const labelled = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key)).sort();
    expect(labelled).toEqual([...PERMISSIONS].sort());
  });

  it("auditoria: ações conhecidas com texto próprio; demais com verbo + entidade; área pelo prefixo", () => {
    expect(auditLabel("auth.login")).toBe("Entrou na plataforma");
    expect(auditLabel("contract.version_approved", "Contract")).toBe("Aprovou versão de contrato");
    expect(auditLabel("tariff.created", "Tariff")).toBe("Criou tarifa");
    expect(auditLabel("connector.saved", "Connector")).toBe("Alterou conector");
    expect(auditLabel("algo.novo_evento")).toBe("Outros: novo evento");
    expect(auditArea("payment.refund_requested")).toBe("Pagamentos");
    expect(auditArea("desconhecido.x")).toBe("Outros");
  });

  it("filtro por área usa todos os prefixos da área", () => {
    expect(areaPrefixes("Acesso").sort()).toEqual(["auth.", "password.", "password_reset."]);
    expect(AREA_LIST).toContain("Unidades e estações");
    expect(areaPrefixes("Unidades e estações").sort()).toEqual(["connector.", "site.", "station.", "tariff."]);
  });

  it("toda ação auditada no código tem texto legível (nenhuma cai no código técnico)", () => {
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : /\.(ts|tsx)$/.test(n) && files.push(join(d, n))));
    walk("src");
    const actions = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/action: "([a-z_]+\.[a-z_.0-9]+)"|"([a-z_]+\.[a-z_]+_(?:approved|rejected))"/g)) actions.add(m[1] ?? m[2]);
    expect(actions.size).toBeGreaterThan(80);
    const raw = [...actions].filter((a) => auditLabel(a).includes(": "));
    expect(raw).toEqual([]);
  });
});
