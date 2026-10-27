import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";

type Tx = PrismaClient | Prisma.TransactionClient;

export async function audit(
  e: { organizationId?: string | null; actorUserId?: string | null; action: string; entityType: string; entityId?: string | null; data?: Prisma.InputJsonValue },
  tx: Tx = db,
) {
  await tx.auditEvent.create({ data: { ...e, organizationId: e.organizationId ?? null } });
}
