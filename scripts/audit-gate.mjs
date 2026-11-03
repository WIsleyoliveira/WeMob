#!/usr/bin/env node
/**
 * Portão de dependências do CI. Produção: zero vulnerabilidades (sem exceção). Desenvolvimento: zero a partir de
 * "moderada", EXCETO avisos listados em ALLOWED — cada um com pacote, justificativa e validade. Exceção vencida, aviso
 * novo, ou aviso permitido que apareça em dependência de produção → falha.
 */
import { execFileSync } from "node:child_process";

const ALLOWED = [
  {
    id: "GHSA-g3hv-75wg-m249",
    package: "minimatch",
    expires: "2026-12-31",
    reason:
      "DoS por padrões de glob em minimatch < 11.0.1. Restam cópias 3.1.5 em eslint, @eslint/eslintrc e nos plugins import/jsx-a11y/react, que só aceitam a API do minimatch 3; usadas apenas no lint, com os padrões do próprio eslint.config.mjs (sem entrada de usuário). Revisar quando esses pacotes atualizarem.",
  },
];

const SEVERITY = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function audit(args) {
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (e) {
    // npm audit sai com código ≠ 0 quando há vulnerabilidades; o JSON vem no stdout.
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  }
}

const advisoryId = (url) => url?.split("/").pop();
const today = new Date().toISOString().slice(0, 10);
let failed = false;

const prod = audit(["--omit=dev"]);
const prodCount = Object.keys(prod.vulnerabilities ?? {}).length;
if (prodCount > 0) {
  console.error(`FALHA: ${prodCount} pacote(s) vulnerável(is) em dependências de PRODUÇÃO (sem exceção possível).`);
  failed = true;
}

const all = audit([]);
const seen = new Map();
for (const [name, v] of Object.entries(all.vulnerabilities ?? {})) {
  for (const via of v.via ?? []) {
    if (typeof via !== "object" || SEVERITY[via.severity] < SEVERITY.moderate) continue;
    const id = advisoryId(via.url);
    const cur = seen.get(id) ?? { id, title: via.title, severity: via.severity, packages: new Set() };
    cur.packages.add(via.name ?? name);
    seen.set(id, cur);
  }
}
for (const a of seen.values()) {
  const allow = ALLOWED.find((x) => x.id === a.id);
  const pkgs = [...a.packages].join(", ");
  if (!allow) {
    console.error(`FALHA: ${a.id} (${a.severity}) em ${pkgs} — ${a.title}`);
    failed = true;
  } else if (allow.expires < today) {
    console.error(`FALHA: exceção de ${a.id} venceu em ${allow.expires}; revise a dependência ou renove com justificativa.`);
    failed = true;
  } else if ([...a.packages].some((p) => p !== allow.package)) {
    console.error(`FALHA: ${a.id} apareceu em pacote fora da exceção (${pkgs}).`);
    failed = true;
  } else console.log(`Exceção aceita até ${allow.expires}: ${a.id} (${a.severity}) em ${pkgs} — ${allow.reason}`);
}
if (!failed) console.log(`OK: produção 0; desenvolvimento ${seen.size} aviso(s), todos com exceção válida.`);
process.exit(failed ? 1 : 0);
