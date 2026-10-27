import { db } from "./db";

/**
 * Limite por janela fixa persistido no Postgres (dispensa Redis no estágio atual).
 * Upsert atômico: seguro com requisições concorrentes. Retorna true se a ação é permitida.
 */
export async function hit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" = EXCLUDED."windowStart" THEN "RateLimitBucket"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"`;
  if (Math.random() < 0.01) {
    // Limpeza oportunista de janelas antigas (evita crescimento indefinido da tabela).
    await db.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "windowStart" < ${new Date(Date.now() - 86400000)}`;
  }
  return rows[0].count <= limit;
}
