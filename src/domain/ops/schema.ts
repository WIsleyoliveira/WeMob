/**
 * Estado das migrações do banco (regra pura), para o health check. O app não migra ao iniciar: a migração é uma
 * etapa explícita do deploy. Este estado diz se essa etapa rodou até a versão que o código espera.
 *
 * LATEST_MIGRATION precisa ser a última pasta de `prisma/migrations` (garantido por tests/unit/schema-status.test.ts).
 */
export const LATEST_MIGRATION = "20261103140000_revenue_share_30_70";

export interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export type SchemaState = "ok" | "migrations_pending" | "migration_failed";

export function schemaState(rows: MigrationRow[], expected = LATEST_MIGRATION): SchemaState {
  // Iniciada e não concluída nem revertida = falhou (ou está rodando agora): nada de servir tráfego sobre ela.
  if (rows.some((r) => r.finished_at === null && r.rolled_back_at === null)) return "migration_failed";
  return rows.some((r) => r.migration_name === expected && r.finished_at !== null && r.rolled_back_at === null) ? "ok" : "migrations_pending";
}
