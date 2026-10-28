import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import type { E2EFixtures } from "./seed";

/** Dados criados pelo orquestrador (scripts/e2e-browser.ts) no banco temporário. */
export const fx = (): E2EFixtures => JSON.parse(readFileSync("e2e/.fixtures.json", "utf8"));

export async function staffLogin(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(who.email);
  await page.getByLabel("Senha").fill(who.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/app(\/|$)/);
}

export async function driverLogin(page: Page, who: { email: string; password: string }) {
  await page.goto("/motorista/entrar");
  await page.getByLabel("E-mail").fill(who.email);
  await page.getByLabel("Senha").fill(who.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  // Espera sair da tela de login (a própria /motorista/entrar não conta como logado).
  await expect(page).toHaveURL((u) => u.pathname.startsWith("/motorista") && !u.pathname.startsWith("/motorista/entrar"));
}

/** Envia um ActionForm com confirmação: clica no botão e confirma no diálogo. */
export async function submitConfirmed(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
}

/**
 * Executa uma operação do app (banco, carregador simulado, ciclos) num processo separado — o Playwright não
 * carrega o código do app. Só funciona no banco E2E temporário (definido pelo orquestrador).
 */
export function op<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!process.env.DATABASE_URL?.includes("sansol_e2e_")) throw new Error("Operações só no banco E2E temporário.");
  return new Promise((resolve, reject) => {
    execFile("npx", ["tsx", "--import", "./scripts/load-env.mjs", "e2e/support/ops.ts", name, JSON.stringify(args)], { env: process.env, maxBuffer: 10_000_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`op ${name} falhou: ${stderr.slice(-400)}`));
      const last = stdout.trim().split("\n").pop() ?? "null";
      resolve(JSON.parse(last) as T);
    });
  });
}

export const prisma = <T = unknown>(model: string, method: string, args: Record<string, unknown> = {}) => op<T>("prisma", { model, method, args });
