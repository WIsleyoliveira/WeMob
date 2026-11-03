import { readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION, schemaState } from "@/domain/ops/schema";

const done = (name: string) => ({ migration_name: name, finished_at: new Date(), rolled_back_at: null });

describe("estado das migrações (health check)", () => {
  it("LATEST_MIGRATION é a última pasta de prisma/migrations (atualize ao criar migração)", () => {
    const dirs = readdirSync("prisma/migrations").filter((d) => statSync(`prisma/migrations/${d}`).isDirectory()).sort();
    expect(LATEST_MIGRATION).toBe(dirs.at(-1));
  });

  it("ok só com a última migração concluída; pendente sem ela; falha com migração iniciada e não concluída", () => {
    expect(schemaState([done("a"), done(LATEST_MIGRATION)])).toBe("ok");
    expect(schemaState([done("a")])).toBe("migrations_pending");
    expect(schemaState([])).toBe("migrations_pending");
    expect(schemaState([done(LATEST_MIGRATION), { migration_name: "x", finished_at: null, rolled_back_at: null }])).toBe("migration_failed");
    // revertida (resolve --rolled-back) não conta como aplicada nem como falha em curso
    expect(schemaState([done("a"), { migration_name: LATEST_MIGRATION, finished_at: new Date(), rolled_back_at: new Date() }])).toBe("migrations_pending");
    expect(schemaState([{ migration_name: "x", finished_at: null, rolled_back_at: new Date() }, done(LATEST_MIGRATION)])).toBe("ok");
  });
});
