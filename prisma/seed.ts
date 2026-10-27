import { PrismaClient } from "@prisma/client";
import { ensureOperationsDefaults, ensureOperator, ensureReferenceModels, ensureStages, ensureSystemRoles } from "../src/server/bootstrap";
import { hashPassword, passwordSchema } from "../src/server/auth/password";

// Seed de DESENVOLVIMENTO. Não cria dados operacionais fictícios (unidades, sessões, receitas).
const db = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed de desenvolvimento não deve rodar em produção.");
  await ensureSystemRoles(db);
  const org = await ensureOperator(db);
  await ensureStages(db, org.id);
  await ensureReferenceModels(db, org.id);
  await ensureOperationsDefaults(db, org.id);

  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@sansolmob.local").toLowerCase();
  const password = passwordSchema.parse(process.env.SEED_ADMIN_PASSWORD);
  const role = await db.role.findFirstOrThrow({ where: { organizationId: null, key: "superadmin" } });
  const user = await db.user.upsert({
    where: { email },
    create: { email, name: "Superadministrador", passwordHash: await hashPassword(password), isSuperAdmin: true },
    update: {},
  });
  await db.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    create: { userId: user.id, organizationId: org.id, roleId: role.id },
    update: {},
  });
  console.log(`Seed concluído. Operadora: ${org.name}. Superadmin: ${email} (senha em SEED_ADMIN_PASSWORD no .env).`);
}

main().finally(() => db.$disconnect());
