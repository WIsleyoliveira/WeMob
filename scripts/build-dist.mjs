// Build de produção numa pasta própria (ex.: .next-e2e) sem parar o `npm run dev`.
// O Next acrescenta a pasta ao "include" do tsconfig.json: o conteúdo original é guardado e devolvido
// exatamente como estava (inclusive edições não commitadas).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const dir = process.argv[2];
if (!dir || !/^\.next-[a-z0-9-]+$/.test(dir)) throw new Error("Uso: node scripts/build-dist.mjs .next-<nome>");
const original = readFileSync("tsconfig.json", "utf8");
let status = 1;
try {
  status = spawnSync("npx", ["next", "build"], { stdio: "inherit", env: { ...process.env, NEXT_DIST_DIR: dir } }).status ?? 1;
} finally {
  writeFileSync("tsconfig.json", original);
}
process.exit(status);
