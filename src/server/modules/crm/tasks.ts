import { z } from "zod";
import { db } from "@/server/db";
import { AppError, notFound } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";

export const taskSchema = z.object({
  leadId: z.string().min(1),
  title: z.string().trim().min(3, "Descreva a tarefa.").max(200),
  dueAt: z.coerce.date({ error: "Informe a data." }),
  assigneeId: z.string().optional(),
});

export async function createTask(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const d = taskSchema.parse(raw);
  const lead = await db.lead.findFirst({ where: { id: d.leadId, organizationId: ctx.organizationId, deletedAt: null } });
  if (!lead) throw notFound();
  const assigneeId = d.assigneeId || ctx.userId;
  const member = await db.membership.findFirst({ where: { userId: assigneeId, organizationId: ctx.organizationId, revokedAt: null } });
  if (!member) throw new AppError("VALIDATION", "Responsável não pertence à organização.");
  return db.$transaction(async (tx) => {
    const t = await tx.crmTask.create({ data: { organizationId: ctx.organizationId, leadId: lead.id, title: d.title, dueAt: d.dueAt, assigneeId, createdById: ctx.userId } });
    await tx.leadActivity.create({ data: { leadId: lead.id, kind: "TASK", authorId: ctx.userId, body: d.title, data: { taskId: t.id, dueAt: d.dueAt.toISOString(), event: "created" } } });
    return t;
  });
}

export async function completeTask(ctx: AuthContext | null, taskId: string) {
  requirePermission(ctx, "lead:write");
  const t = await db.crmTask.findFirst({ where: { id: taskId, organizationId: ctx.organizationId } });
  if (!t) throw notFound();
  if (t.completedAt) return t;
  return db.$transaction(async (tx) => {
    const done = await tx.crmTask.update({ where: { id: t.id }, data: { completedAt: new Date() } });
    await tx.leadActivity.create({ data: { leadId: t.leadId, kind: "TASK", authorId: ctx.userId, body: t.title, data: { taskId: t.id, event: "completed" } } });
    return done;
  });
}

/** Tarefas em aberto da organização (ou do usuário), ordenadas por vencimento. */
export async function listOpenTasks(ctx: AuthContext | null, opts: { mine?: boolean; leadId?: string } = {}) {
  requirePermission(ctx, "lead:read");
  return db.crmTask.findMany({
    where: { organizationId: ctx.organizationId, completedAt: null, ...(opts.mine ? { assigneeId: ctx.userId } : {}), ...(opts.leadId ? { leadId: opts.leadId } : {}) },
    include: { lead: { select: { id: true, contactName: true, companyName: true } }, assignee: { select: { name: true } } },
    orderBy: { dueAt: "asc" },
    take: 200,
  });
}

export async function listLeadTasks(ctx: AuthContext | null, leadId: string) {
  requirePermission(ctx, "lead:read");
  return db.crmTask.findMany({
    where: { organizationId: ctx.organizationId, leadId },
    include: { assignee: { select: { name: true } } },
    orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }],
  });
}
