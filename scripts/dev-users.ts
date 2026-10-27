/**
 * Usuários de TESTE para verificação manual multi-perfil no banco de DESENVOLVIMENTO
 * (dois administradores para a regra dos quatro olhos, financeiro e parceiro).
 * A senha é gerada aleatoriamente e gravada em .env.dev-users (ignorado pelo git). Recusa produção.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { ensureOperator } from "../src/server/bootstrap";

const db = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Não use em produção.");
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || url === process.env.TEST_DATABASE_URL) throw new Error("Somente banco de desenvolvimento local.");
  const password = `Dev-${randomBytes(9).toString("base64url")}-9`;
  const hash = await hashPassword(password);
  const op = await ensureOperator(db);
  const partnerOrg = (await db.organization.findFirst({ where: { name: "Parceiro Demonstração", kind: "PARTNER" } })) ?? (await db.organization.create({ data: { name: "Parceiro Demonstração", kind: "PARTNER" } }));
  const users: [string, string, string][] = [
    ["dev.admin.a@sansolmob.local", "Admin A (teste)", "admin"],
    ["dev.admin.b@sansolmob.local", "Admin B (teste)", "admin"],
    ["dev.financeiro@sansolmob.local", "Financeiro (teste)", "finance"],
    ["dev.parceiro@sansolmob.local", "Parceiro (teste)", "partner"],
  ];
  for (const [email, name, roleKey] of users) {
    const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key: roleKey } });
    const user = await db.user.upsert({ where: { email }, create: { email, name, passwordHash: hash }, update: { passwordHash: hash, disabledAt: null } });
    const orgId = roleKey === "partner" ? partnerOrg.id : op.id;
    await db.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: orgId } }, create: { userId: user.id, organizationId: orgId, roleId: role.id }, update: { roleId: role.id, revokedAt: null } });
  }
  writeFileSync(".env.dev-users", `# Usuários de teste do banco de desenvolvimento (gerado por npm run dev:users). Não use em produção.\nDEV_USERS="${users.map((u) => u[0]).join(",")}"\nDEV_USERS_PASSWORD="${password}"\n`, { mode: 0o600 });
  console.log(`Usuários de teste prontos (${users.length}). Senha gravada em .env.dev-users.`);
}

main().finally(() => db.$disconnect());
