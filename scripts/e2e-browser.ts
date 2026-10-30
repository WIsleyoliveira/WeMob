/**
 * Orquestrador dos testes E2E de navegador (Playwright). Isolado de tudo que existe:
 *   1. cria um banco PRÓPRIO e temporário (sansol_e2e_<carimbo>) no mesmo servidor do TEST_DATABASE_URL;
 *   2. aplica as migrações (etapa explícita, como no deploy) e monta os dados de teste pelos serviços do app;
 *   3. sobe o BUILD DE PRODUÇÃO (`npm run e2e:build` → .next-e2e) como na imagem (`node server.js`), com o gateway local
 *      SIMULADO (PAYMENT_PROVIDER=sandbox) e a configuração do Asaas anulada — nenhum clique chega a um gateway real;
 *   4. roda `playwright test`; 5. encerra o servidor, APAGA o banco temporário e o arquivo de dados de teste.
 *
 *   npm run e2e:build && npm run e2e:browser            # local
 *   E2E_PORT=3100 npm run e2e:browser -- e2e/auth.spec.ts
 * Senhas dos usuários de teste são aleatórias, existem só no banco temporário e nunca são impressas.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURES = "e2e/.fixtures.json";

function e2eUrl() {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error("TEST_DATABASE_URL não definido: o banco E2E é criado no mesmo servidor do banco de teste.");
  const u = new URL(base);
  const maintenance = new URL(base);
  maintenance.pathname = "/postgres";
  u.pathname = `/sansol_e2e_${Date.now()}`;
  return { url: u.toString(), name: u.pathname.slice(1), maintenance: maintenance.toString() };
}

async function admin(maintenanceUrl: string, sql: string) {
  const { PrismaClient } = await import("@prisma/client");
  const c = new PrismaClient({ datasources: { db: { url: maintenanceUrl } } });
  try {
    await c.$executeRawUnsafe(sql);
  } finally {
    await c.$disconnect();
  }
}

async function main() {
  if (!existsSync(".next-e2e/BUILD_ID")) throw new Error("Build E2E ausente: rode `npm run e2e:build` antes.");
  const db = e2eUrl();
  if ([process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].includes(db.url)) throw new Error("Banco E2E não pode coincidir com os bancos existentes.");
  const sandboxSecret = randomBytes(24).toString("hex");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: db.url,
    NODE_ENV: "production",
    PAYMENT_PROVIDER: "sandbox",
    PAYMENT_SANDBOX_WEBHOOK_SECRET: sandboxSecret,
    PAYMENT_PREAUTH_AMOUNT: "50",
    // B3: perfil de EXEMPLO (R$ 5–500, sugerido R$ 50 — NÃO comerciais; WAPE não definiu). Permitido porque o gateway
    // é o simulado local e a estação é de TESTE; nunca vale com gateway ou estação de produção.
    CHARGE_AMOUNT_MODE: "example",
    // Asaas anulado: o servidor de teste não tem como chamar o gateway real.
    ASAAS_ENVIRONMENT: "",
    ASAAS_SANDBOX_API_KEY: "",
    ASAAS_PRODUCTION_API_KEY: "",
    ASAAS_WEBHOOK_TOKEN: "",
    APP_SECRET: randomBytes(24).toString("hex"),
    NEXT_DIST_DIR: ".next-e2e",
  };
  let server: ReturnType<typeof spawn> | null = null;
  let code = 1;
  await admin(db.maintenance, `CREATE DATABASE "${db.name}"`);
  console.log(`banco E2E temporário: ${db.name}`);
  try {
    const mig = spawnSync("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, encoding: "utf8" });
    if (mig.status !== 0) throw new Error(`migrate deploy falhou: ${mig.stderr.slice(-500)}`);
    Object.assign(process.env, env);
    const { seedE2E } = await import("../e2e/support/seed");
    writeFileSync(FIXTURES, JSON.stringify(await seedE2E()), { mode: 0o600 });
    // Mesmo modo da imagem Docker (output "standalone": `node server.js` + estáticos copiados).
    // `next start` não é suportado com standalone e deixa as server actions sem concluir no navegador.
    cpSync(".next-e2e/static", ".next-e2e/standalone/.next-e2e/static", { recursive: true });
    if (existsSync("public")) cpSync("public", ".next-e2e/standalone/public", { recursive: true });
    rmSync(".next-e2e/standalone/.env", { force: true }); // o standalone copia o .env do projeto: o E2E não o usa
    const child = spawn("node", ["server.js"], { cwd: ".next-e2e/standalone", env: { ...env, PORT: String(PORT), HOSTNAME: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
    server = child;
    child.stderr?.on("data", (d) => process.env.E2E_SERVER_LOG && process.stderr.write(d));
    for (let i = 0; i < 60; i++) {
      if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(await fetch(`${BASE}/api/health`).catch(() => null))?.ok) throw new Error("Servidor E2E não respondeu.");
    const pw = spawnSync("npx", ["playwright", "test", ...process.argv.slice(2)], { env: { ...env, E2E_BASE: BASE, E2E_DATABASE_URL: db.url }, stdio: "inherit" });
    code = pw.status ?? 1;
  } finally {
    server?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    rmSync(FIXTURES, { force: true });
    const { db: client } = await import("../src/server/db");
    await client.$disconnect().catch(() => undefined);
    await admin(db.maintenance, `DROP DATABASE IF EXISTS "${db.name}" WITH (FORCE)`);
    console.log(`banco E2E temporário removido: ${db.name}`);
  }
  process.exit(code);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
