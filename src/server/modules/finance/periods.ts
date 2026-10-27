import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";

type Tx = PrismaClient | Prisma.TransactionClient;

/** Período fechado = existe fechamento APROVADO (índice único parcial garante no máximo um). */
export async function isPeriodClosed(operatorId: string, period: string, tx: Tx = db) {
  return !!(await tx.periodClosing.findFirst({ where: { operatorId, period, status: "APPROVED" }, select: { id: true } }));
}

/** Trava o período (lançamentos × aprovação concorrente) e recusa alteração em período fechado. */
export async function lockOpenPeriod(tx: Prisma.TransactionClient, operatorId: string, period: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`period:${operatorId}:${period}`}))`;
  if (await isPeriodClosed(operatorId, period, tx))
    throw new AppError("CONFLICT", `O período ${period} está fechado. Correções devem ser feitas por lançamento de ajuste em período aberto.`);
}
