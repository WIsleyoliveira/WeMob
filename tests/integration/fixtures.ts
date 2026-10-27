import type { OrganizationKind } from "@prisma/client";
import { db } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { login, resolveSession } from "@/server/auth/session";
import { ensureOperator, ensureReferenceModels, ensureStages, ensureSystemRoles } from "@/server/bootstrap";

export const PASSWORD = "senha-de-teste-123";

/** Limpa o banco de TESTE. Recusa-se a rodar fora dele. */
export async function resetDb() {
  if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
    throw new Error("resetDb só pode rodar no banco de teste.");
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function bootstrapOperator() {
  await ensureSystemRoles(db);
  const org = await ensureOperator(db);
  await ensureStages(db, org.id);
  await ensureReferenceModels(db, org.id);
  return org;
}

export async function createOrg(name: string, kind: OrganizationKind) {
  return db.organization.create({ data: { name, kind } });
}

let seq = 0;
export async function createUser(organizationId: string, roleKey: string) {
  seq++;
  const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key: roleKey } });
  const user = await db.user.create({
    data: { email: `u${seq}-${roleKey}@teste.local`, name: `Usuário ${seq}`, passwordHash: await hashPassword(PASSWORD) },
  });
  const membership = await db.membership.create({ data: { userId: user.id, organizationId, roleId: role.id } });
  const { token } = await login({ email: user.email, password: PASSWORD });
  const ctx = await resolveSession(token);
  if (!ctx) throw new Error("falha ao criar sessão de teste");
  return { user, membership, token, ctx };
}
