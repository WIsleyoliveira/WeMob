import type { ClosingStatus } from "@prisma/client";
import { periodOf, previousPeriod } from "@/domain/finance/period";

export const CLOSING_STATUS_LABEL: Record<ClosingStatus, string> = { PENDING_APPROVAL: "Aguardando aprovação", APPROVED: "Fechado (aprovado)", REJECTED: "Recusado", SUPERSEDED: "Superado (dados mudaram)" };
export const defaultPeriod = () => previousPeriod(periodOf(new Date()));
export const isPeriod = (p: string | undefined): p is string => !!p && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
