/**
 * Implantação inicial (qualquer ambiente, inclusive produção): perfis de sistema, operadora, funil,
 * regras de alerta/SLA padrão e o PRIMEIRO superadministrador. Não cria modelos comerciais aprovados
 * nem dados de demonstração. Recusa-se a rodar se já existir superadministrador.
 *
 * Uso: ADMIN_EMAIL=… ADMIN_PASSWORD=… OPERATOR_NAME="Sansol Mob" npm run setup:first-admin
 * (passe as variáveis pelo ambiente/cofre de segredos; não grave a senha em arquivo nem no histórico do shell.)
 */
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ensureOperationsDefaults, ensureOperator, ensureStages, ensureSystemRoles } from "../src/server/bootstrap";
import { hashPassword, passwordSchema } from "../src/server/auth/password";

const db = new PrismaClient();

async function main() {
  const email = z.string().trim().toLowerCase().email("ADMIN_EMAIL inválido.").parse(process.env.ADMIN_EMAIL);
  const password = passwordSchema.parse(process.env.ADMIN_PASSWORD);
  const role = await (async () => {
    await ensureSystemRoles(db);
    return db.role.findFirstOrThrow({ where: { organizationId: null, key: "superadmin" } });
  })();
  if (await db.membership.findFirst({ where: { roleId: role.id, revokedAt: null } })) {
    throw new Error("Já existe superadministrador ativo. Crie novos usuários pela tela de usuários.");
  }
  const org = await ensureOperator(db, process.env.OPERATOR_NAME || "Sansol Mob");
  await ensureStages(db, org.id);
  await ensureOperationsDefaults(db, org.id);
  const user = await db.user.create({ data: { email, name: "Superadministrador", passwordHash: await hashPassword(password), isSuperAdmin: true } });
  await db.membership.create({ data: { userId: user.id, organizationId: org.id, roleId: role.id } });
  await db.auditEvent.create({ data: { organizationId: org.id, action: "bootstrap.first_admin_created", entityType: "User", entityId: user.id } });
  console.log(`Implantação inicial concluída. Operadora: ${org.name}. Superadministrador: ${email}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof z.ZodError ? e.issues.map((i) => i.message).join(" ") : e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
