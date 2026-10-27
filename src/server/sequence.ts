import type { Prisma } from "@prisma/client";

/**
 * Número sequencial legível por organização e ano (ex.: CTR-2026-0001), sem colisão concorrente:
 * trava consultiva na transação + contagem dos números já emitidos com o prefixo.
 */
export async function nextNumber(tx: Prisma.TransactionClient, scope: string, prefix: string, count: (startsWith: string) => Promise<number>, pad = 4) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seq:${prefix}:${scope}`}))`;
  const start = `${prefix}-${new Date().getFullYear()}-`;
  return `${start}${String((await count(start)) + 1).padStart(pad, "0")}`;
}
