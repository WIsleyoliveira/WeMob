import type { MigrationRow } from "@/domain/ops/schema";

type RawClient = { $queryRaw: <T>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T> };

/**
 * Migrações aplicadas. Banco recém-criado (sem a tabela `_prisma_migrations`) = nenhuma — o health responde
 * `migrations_pending`, não "banco inacessível" (a consulta direta falharia com 42P01).
 */
export async function readMigrations(client: RawClient): Promise<MigrationRow[]> {
  const [{ present }] = await client.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
  if (!present) return [];
  return client.$queryRaw<MigrationRow[]>`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`;
}
