/**
 * Backup VERIFICÁVEL: gera o dump e prova que ele restaura com os mesmos dados.
 *
 *   npm run db:backup:verificar            # origem = DATABASE_URL; restauração no servidor do TEST_DATABASE_URL
 *   BACKUP_SOURCE_URL=... BACKUP_RESTORE_URL=... BACKUP_DIR=... npm run db:backup:verificar
 *
 * 1. Abre uma transação REPEATABLE READ na origem e exporta a "foto" (pg_export_snapshot): as contagens de linhas e o
 *    pg_dump usam exatamente o mesmo estado, mesmo com a aplicação gravando.
 * 2. pg_dump -Fc com essa foto → arquivo em BACKUP_DIR (padrão ./backups, fora do Git) + SHA-256.
 * 3. Cria um banco TEMPORÁRIO próprio (sansol_restore_check_<carimbo>), restaura com pg_restore e compara, tabela a
 *    tabela, as contagens e a lista de migrações. Diferença = falha (código de saída 1).
 * 4. Apaga só o banco temporário que ele mesmo criou. A origem só é lida.
 * Senhas nunca vão para a linha de comando (variáveis PG* do processo filho) nem para o relatório.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

type Counts = Record<string, number>;

function pgEnv(url: string) {
  const u = new URL(url);
  return {
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
    PGSSLMODE: u.searchParams.get("sslmode") ?? "prefer",
  };
}
const dbName = (url: string) => decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
const withDb = (url: string, name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  u.searchParams.delete("schema");
  return u.toString();
};
const safe = (url: string) => {
  const u = new URL(url);
  return `${u.hostname}:${u.port || 5432}/${dbName(url)}`;
};

function run(cmd: string, args: string[], env: Record<string, string>): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? ok(out) : fail(new Error(`${cmd} saiu com código ${code}: ${err.slice(-500)}`))));
  });
}

async function tableCounts(client: { $queryRawUnsafe: <T>(q: string) => Promise<T> }): Promise<Counts> {
  const tables = await client.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
  const counts: Counts = {};
  for (const t of tables) {
    const [{ n }] = await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "public"."${t.tablename.replace(/"/g, '""')}"`);
    counts[t.tablename] = Number(n);
  }
  return counts;
}

const sha256File = (path: string) =>
  new Promise<string>((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(path).on("data", (d) => h.update(d)).on("end", () => ok(h.digest("hex"))).on("error", fail);
  });

async function main() {
  const source = process.env.BACKUP_SOURCE_URL || process.env.DATABASE_URL;
  const restoreBase = process.env.BACKUP_RESTORE_URL || process.env.TEST_DATABASE_URL;
  if (!source) throw new Error("Defina BACKUP_SOURCE_URL ou DATABASE_URL.");
  if (!restoreBase) throw new Error("Defina BACKUP_RESTORE_URL (servidor onde a restauração de teste é feita) ou TEST_DATABASE_URL.");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const tempName = `sansol_restore_check_${stamp.toLowerCase()}`;
  if (tempName === dbName(source)) throw new Error("O banco temporário não pode ser a origem.");
  const dir = resolve(process.env.BACKUP_DIR || "backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${dbName(source)}-${stamp}.dump`);

  console.log(`Origem: ${safe(source)} · restauração de teste em ${safe(withDb(restoreBase, tempName))}`);
  const src = new PrismaClient({ datasourceUrl: source });
  const admin = new PrismaClient({ datasourceUrl: withDb(restoreBase, "postgres") });
  const restored = new PrismaClient({ datasourceUrl: withDb(restoreBase, tempName) });
  let created = false;
  const report: Record<string, unknown> = { startedAt: new Date().toISOString(), source: safe(source), file };
  try {
    // 1–2: contagens e dump na MESMA foto da origem.
    const sourceCounts = await src.$transaction(
      async (tx) => {
        const [{ snap }] = await tx.$queryRawUnsafe<{ snap: string }[]>(`SELECT pg_export_snapshot() AS snap`);
        const counts = await tableCounts(tx);
        await run("pg_dump", ["-Fc", "--no-owner", "--no-privileges", `--snapshot=${snap}`, "-f", file], pgEnv(source));
        return counts;
      },
      { isolationLevel: "RepeatableRead", timeout: 30 * 60_000, maxWait: 10_000 },
    );
    const sha = await sha256File(file);
    const listed = (await run("pg_restore", ["--list", file], {})).split("\n").filter((l) => l && !l.startsWith(";")).length;
    console.log(`Dump: ${file} (${(statSync(file).size / 1024).toFixed(0)} KB, ${listed} objetos, sha256 ${sha})`);

    // 3: restauração num banco temporário próprio e comparação.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${tempName}"`);
    created = true;
    await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "-d", tempName, file], { ...pgEnv(withDb(restoreBase, tempName)) });
    const restoredCounts = await tableCounts(restored);
    const tables = [...new Set([...Object.keys(sourceCounts), ...Object.keys(restoredCounts)])].sort();
    const diffs = tables.filter((t) => sourceCounts[t] !== restoredCounts[t]).map((t) => ({ table: t, source: sourceCounts[t] ?? null, restored: restoredCounts[t] ?? null }));
    const migSrc = (await src.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY 1`)).map((r) => r.migration_name);
    const migRes = (await restored.$queryRawUnsafe<{ migration_name: string }[]>(`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY 1`)).map((r) => r.migration_name);
    const rows = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
    Object.assign(report, { sha256: sha, bytes: statSync(file).size, objects: listed, tables: tables.length, rows, migrations: migSrc.length, lastMigration: migSrc.at(-1), migrationsMatch: JSON.stringify(migSrc) === JSON.stringify(migRes), diffs });
    console.log(`Restaurado: ${tables.length} tabelas, ${rows} linhas, ${migSrc.length} migrações (última ${migSrc.at(-1)}).`);
    if (diffs.length || !report.migrationsMatch) {
      console.error("FALHA: restauração diferente da origem.", JSON.stringify(diffs));
      process.exitCode = 1;
    } else console.log("OK: backup restaura com as mesmas contagens em todas as tabelas e as mesmas migrações.");
  } finally {
    await restored.$disconnect();
    if (created) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${tempName}" WITH (FORCE)`);
      console.log(`Banco temporário ${tempName} removido.`);
    }
    await admin.$disconnect();
    await src.$disconnect();
    report.finishedAt = new Date().toISOString();
    report.result = process.exitCode ? "FALHA" : "OK";
    writeFileSync(`${file}.verificacao.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
