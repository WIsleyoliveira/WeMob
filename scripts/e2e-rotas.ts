/**
 * E2E de rotas e permissões (HTTP real contra um servidor em execução). Somente banco de DESENVOLVIMENTO.
 *
 *   npm run e2e:rotas                         # contra http://localhost:3001 (npm run dev)
 *   E2E_BASE=http://localhost:3002 npm run e2e:rotas   # ex.: build de produção (node .next/standalone/server.js)
 *
 * Para cada perfil (visitante, motorista e cada papel da equipe) cria sessões temporárias — e usuários de teste
 * para papéis sem usuário, com senha aleatória nunca usada —, percorre todas as páginas e classifica a resposta.
 * Falha (código 1) se houver erro 500, tela de erro ou redirecionamento em laço. Ao final revoga as sessões e
 * desativa os usuários de teste. Use o build de produção para varreduras completas: o `next dev` reinicia sozinho
 * ao se aproximar do limite de memória ao compilar dezenas de rotas.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/auth/password";

const BASE = process.env.E2E_BASE ?? "http://localhost:3001";
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const NONE = "naoexiste000000000000000";

async function sampleIds() {
  const pick = async <T extends { id: string }>(p: Promise<T | null>) => (await p)?.id ?? NONE;
  const session = await db.chargingSession.findFirst({ where: { driverId: { not: null } }, orderBy: { startedAt: "desc" }, include: { driver: true } });
  const station = await db.chargingStation.findFirst({ where: { environment: { in: ["TEST", "SIMULATED"] }, deletedAt: null }, orderBy: { environment: "asc" } });
  return {
    lead: await pick(db.lead.findFirst({ where: { deletedAt: null } })),
    proposal: await pick(db.proposal.findFirst()),
    contract: await pick(db.contract.findFirst()),
    company: await pick(db.company.findFirst()),
    station: station?.id ?? NONE,
    identity: station?.ocppIdentity ?? NONE,
    site: await pick(db.site.findFirst()),
    workOrder: await pick(db.workOrder.findFirst()),
    ticket: await pick(db.ticket.findFirst()),
    simulation: await pick(db.simulation.findFirst()),
    closing: await pick(db.periodClosing.findFirst()),
    payment: await pick(db.payment.findFirst({ orderBy: { createdAt: "desc" } })),
    session: session?.id ?? NONE,
    request: (await db.chargeRequest.findFirst({ where: session?.driverId ? { driverId: session.driverId } : {}, orderBy: { createdAt: "desc" } }))?.id ?? NONE,
    driverId: session?.driverId ?? (await db.driver.findFirst())?.id ?? null,
  };
}

function routes(i: Awaited<ReturnType<typeof sampleIds>>) {
  const pub = ["/", "/contato", "/modelos", "/privacidade", "/simulador", "/termos", "/login", "/recuperar-senha", "/redefinir-senha", "/robots.txt", "/sitemap.xml", "/api/health"];
  const driver = ["/motorista", "/motorista?modo=demo", "/motorista/ajuda", "/motorista/cadastro", `/motorista/carregar/${i.identity}/1`, "/motorista/conta", "/motorista/entrar", `/motorista/estacoes/${i.identity}`, "/motorista/historico", `/motorista/pedido/${i.request}`, `/motorista/recarga/${i.session}`, `/motorista/recibo/${i.session}`];
  const staff = [
    "/app", "/app/alertas", "/app/auditoria", "/app/conta", "/app/contratos", "/app/contratos/novo", `/app/contratos/${i.contract}`, "/app/crm", "/app/crm/configurar", "/app/crm/empresas", `/app/crm/empresas/${i.company}`, "/app/crm/metricas", "/app/crm/novo", `/app/crm/${i.lead}`,
    "/app/crm/propostas", `/app/crm/propostas/nova?leadId=${i.lead}`, `/app/crm/propostas/${i.proposal}`, `/app/crm/propostas/${i.proposal}/imprimir`, "/app/crm/tarefas", `/app/estacoes/${i.station}`, "/app/financeiro", "/app/financeiro/demonstrativo",
    "/app/financeiro/fechamento", `/app/financeiro/fechamento/${i.closing}`, "/app/financeiro/lancamentos", "/app/financeiro/tributos", "/app/manutencao", `/app/manutencao/os/${i.workOrder}`, "/app/modelos", "/app/operacao", "/app/pagamentos",
    `/app/pagamentos/${i.payment}`, "/app/pagamentos/gateway", "/app/pagamentos/split", "/app/portal", "/app/sem-permissao", "/app/simulador", `/app/simulador/${i.simulation}`, "/app/suporte", `/app/suporte/${i.ticket}`, "/app/suporte/configurar", "/app/suporte/novo",
    "/app/suporte/painel", "/app/unidades", `/app/unidades/${i.site}`, "/app/usuarios",
  ];
  return [...pub, ...driver, ...staff];
}

async function classify(path: string, cookie: string): Promise<string> {
  let url = `${BASE}${path}`;
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      url = new URL(loc, url).toString();
      continue;
    }
    if (r.status >= 500) return "500";
    if (r.status === 404) return "404";
    const body = r.status === 200 ? await r.text() : "";
    const final = new URL(url).pathname;
    if (body.includes("NEXT_HTTP_ERROR_FALLBACK;404")) return "404";
    // Redirecionamento durante o streaming chega como 200 com NEXT_REDIRECT;<tipo>;<destino> no corpo.
    const streamed = /NEXT_REDIRECT;[a-z]+;([^;"\\]+)/.exec(body)?.[1] ?? "";
    const to = (p: string) => (final.startsWith(p) || streamed.startsWith(p)) && !path.startsWith(p);
    if (to("/app/sem-permissao")) return "sem-permissão";
    if (to("/login")) return "→login";
    if (to("/motorista/entrar")) return "→entrar";
    return String(r.status);
  }
  return "loop";
}

async function main() {
  if (!process.env.DATABASE_URL?.includes("_dev")) throw new Error("Recusado: o E2E de rotas só roda contra o banco de desenvolvimento (DATABASE_URL com _dev).");
  if ((await fetch(`${BASE}/api/health`).catch(() => null))?.ok !== true) throw new Error(`Servidor indisponível em ${BASE}.`);
  const ids = await sampleIds();
  const paths = routes(ids);
  const created: string[] = [];
  const staffSessions: string[] = [];
  let driverSession: string | null = null;
  const profiles: Record<string, string> = { visitante: "" };
  try {
    const op = await db.organization.findFirstOrThrow({ where: { kind: "OPERATOR" } });
    for (const role of await db.role.findMany({ where: { organizationId: null } })) {
      if (role.key === "driver") continue;
      let m = await db.membership.findFirst({ where: { roleId: role.id, revokedAt: null, user: { disabledAt: null } } });
      if (!m) {
        const email = `e2e.${role.key}@teste.local`;
        const org = role.key === "partner" ? await db.organization.findFirst({ where: { kind: "PARTNER" } }) : role.key === "investor" ? await db.organization.findFirst({ where: { kind: "INVESTOR" } }) : op;
        const u = await db.user.upsert({ where: { email }, create: { email, name: `E2E ${role.key}`, passwordHash: await hashPassword(randomBytes(24).toString("base64url")) }, update: { disabledAt: null } });
        created.push(u.id);
        m = (await db.membership.findFirst({ where: { userId: u.id, revokedAt: null } })) ?? (await db.membership.create({ data: { userId: u.id, organizationId: (org ?? op).id, roleId: role.id } }));
      }
      const t = randomBytes(32).toString("base64url");
      staffSessions.push((await db.session.create({ data: { tokenHash: sha(t), userId: m.userId, organizationId: m.organizationId, expiresAt: new Date(Date.now() + 3600_000) } })).id);
      profiles[role.key] = `sm_session=${t}`;
    }
    if (ids.driverId) {
      const t = randomBytes(32).toString("base64url");
      driverSession = (await db.driverSession.create({ data: { tokenHash: sha(t), driverId: ids.driverId, expiresAt: new Date(Date.now() + 3600_000) } })).id;
      profiles.motorista = `sm_driver=${t}`;
    }
    const failures: string[] = [];
    for (const [name, cookie] of Object.entries(profiles)) {
      const counts: Record<string, number> = {};
      for (const p of paths) {
        const v = await classify(p, cookie).catch((e) => `falha-rede (${String(e).slice(0, 40)})`);
        counts[v] = (counts[v] ?? 0) + 1;
        if (v === "500" || v === "loop" || v.startsWith("falha")) failures.push(`${name} ${p}: ${v}`);
      }
      console.log(`${name.padEnd(11)} ${JSON.stringify(counts)}`);
    }
    console.log(`\n${Object.keys(profiles).length} perfis × ${paths.length} rotas = ${Object.keys(profiles).length * paths.length} verificações; falhas: ${failures.length}`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    await db.session.updateMany({ where: { id: { in: staffSessions } }, data: { revokedAt: new Date() } });
    if (driverSession) await db.driverSession.update({ where: { id: driverSession }, data: { revokedAt: new Date() } });
    await db.user.updateMany({ where: { id: { in: created } }, data: { disabledAt: new Date() } });
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
