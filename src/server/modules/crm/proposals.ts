import Decimal from "decimal.js";
import { z } from "zod";
import type { ProposalStatus } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  DRAFT: "Rascunho", SENT: "Enviada", ACCEPTED: "Aceita", REJECTED: "Recusada", CANCELLED: "Cancelada",
};

/** Transições permitidas. Estados finais (aceita, recusada, cancelada) não mudam mais. */
export const TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: [],
  REJECTED: [],
  CANCELLED: [],
};

const itemSchema = z.object({
  description: z.string().trim().min(2).max(200),
  quantity: z.coerce.number().gt(0).max(100000),
  unitPrice: z.coerce.number().min(0).max(1e9),
});

export const proposalContentSchema = z.object({
  title: z.string().trim().min(3).max(160),
  items: z.array(itemSchema).min(1, "Inclua ao menos um item.").max(50),
  validUntil: z.coerce.date(),
  conditions: z.string().trim().min(10, "Descreva as condições comerciais.").max(5000),
  modelVersionId: z.string().optional(),
  simulationId: z.string().optional(),
});

/** Totais em Decimal, arredondados por item (ROUND_HALF_UP) e somados. */
export function computeItems(items: z.infer<typeof itemSchema>[]) {
  const rows = items.map((i) => {
    const total = new Decimal(i.quantity).mul(i.unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return { description: i.description, quantity: String(i.quantity), unitPrice: new Decimal(i.unitPrice).toFixed(2), total: total.toFixed(2) };
  });
  const total = rows.reduce((a, r) => a.plus(r.total), new Decimal(0));
  return { rows, total: total.toFixed(2) };
}

async function validateRefs(ctx: AuthContext, d: z.infer<typeof proposalContentSchema>) {
  if (d.validUntil.getTime() < Date.now() - 86400000) throw new AppError("VALIDATION", "A validade não pode estar no passado.");
  if (d.modelVersionId && !(await db.commercialModelVersion.findFirst({ where: { id: d.modelVersionId, model: { organizationId: ctx.organizationId } } })))
    throw notFound("Versão de modelo comercial não encontrada.");
  if (d.simulationId && !(await db.simulation.findFirst({ where: { id: d.simulationId, organizationId: ctx.organizationId } })))
    throw notFound("Simulação não encontrada.");
}

export async function createProposal(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const { leadId, ...rest } = z.object({ leadId: z.string() }).passthrough().parse(raw);
  const d = proposalContentSchema.parse(rest);
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId, deletedAt: null } });
  if (!lead) throw notFound();
  await validateRefs(ctx, d);
  const { rows, total } = computeItems(d.items);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"proposal-seq:" + ctx.organizationId}))`;
    const year = new Date().getFullYear();
    const count = await tx.proposal.count({ where: { organizationId: ctx.organizationId, number: { startsWith: `PROP-${year}-` } } });
    const number = `PROP-${year}-${String(count + 1).padStart(4, "0")}`;
    const p = await tx.proposal.create({ data: { organizationId: ctx.organizationId, leadId, number, title: d.title } });
    await tx.proposalVersion.create({
      data: { proposalId: p.id, version: 1, items: rows, total, validUntil: d.validUntil, conditions: d.conditions, modelVersionId: d.modelVersionId, simulationId: d.simulationId, createdById: ctx.userId },
    });
    await tx.leadActivity.create({ data: { leadId, kind: "PROPOSAL", authorId: ctx.userId, body: `${number} criada (v1, R$ ${total})`, data: { proposalId: p.id } } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "proposal.created", entityType: "Proposal", entityId: p.id, data: { number, total } }, tx);
    return p;
  });
}

/** Revisão: cria nova versão imutável. Proposta enviada volta a rascunho (precisa ser reenviada). */
export async function reviseProposal(ctx: AuthContext | null, proposalId: string, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const d = proposalContentSchema.parse(raw);
  const p = await db.proposal.findFirst({ where: { id: proposalId, organizationId: ctx.organizationId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!p) throw notFound();
  if (!["DRAFT", "SENT"].includes(p.status)) throw new AppError("CONFLICT", "Propostas aceitas, recusadas ou canceladas não podem ser revisadas.");
  await validateRefs(ctx, d);
  const { rows, total } = computeItems(d.items);
  const version = p.versions[0].version + 1;
  return db.$transaction(async (tx) => {
    await tx.proposalVersion.create({
      data: { proposalId: p.id, version, items: rows, total, validUntil: d.validUntil, conditions: d.conditions, modelVersionId: d.modelVersionId, simulationId: d.simulationId, createdById: ctx.userId },
    });
    await tx.proposal.update({ where: { id: p.id }, data: { title: d.title, status: "DRAFT", sentAt: null } });
    await tx.leadActivity.create({ data: { leadId: p.leadId, kind: "PROPOSAL", authorId: ctx.userId, body: `${p.number} revisada (v${version}, R$ ${total})`, data: { proposalId: p.id } } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "proposal.revised", entityType: "Proposal", entityId: p.id, data: { version, total } }, tx);
  });
}

/**
 * Muda o status. "Enviada" significa que o comercial enviou por um canal externo: a plataforma
 * NÃO envia e-mail/WhatsApp (adaptadores não configurados).
 */
export async function setProposalStatus(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const { proposalId, status } = z.object({ proposalId: z.string(), status: z.enum(["SENT", "ACCEPTED", "REJECTED", "CANCELLED"]) }).parse(raw);
  const p = await db.proposal.findFirst({ where: { id: proposalId, organizationId: ctx.organizationId }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!p) throw notFound();
  if (!TRANSITIONS[p.status].includes(status)) throw new AppError("CONFLICT", `Transição inválida: ${PROPOSAL_STATUS_LABEL[p.status]} → ${PROPOSAL_STATUS_LABEL[status]}.`);
  if (status === "SENT" && p.versions[0].validUntil < new Date()) throw new AppError("VALIDATION", "A validade desta versão expirou. Revise a proposta antes de enviar.");
  const now = new Date();
  await db.$transaction(async (tx) => {
    // Atualização condicional: protege contra duas mudanças simultâneas a partir do mesmo estado.
    const r = await tx.proposal.updateMany({
      where: { id: p.id, status: p.status },
      data: { status, ...(status === "SENT" ? { sentAt: now } : { decidedAt: now }) },
    });
    if (r.count !== 1) throw new AppError("CONFLICT", "A proposta foi alterada por outra pessoa. Recarregue a página.");
    await tx.leadActivity.create({ data: { leadId: p.leadId, kind: "PROPOSAL", authorId: ctx.userId, body: `${p.number}: ${PROPOSAL_STATUS_LABEL[status]}`, data: { proposalId: p.id, status } } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "proposal.status_changed", entityType: "Proposal", entityId: p.id, data: { from: p.status, to: status } }, tx);
  });
}

export async function getProposal(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "lead:read");
  const p = await db.proposal.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { versions: { orderBy: { version: "desc" } }, lead: { select: { id: true, contactName: true, companyName: true, email: true, city: true, state: true } } },
  });
  if (!p) throw notFound("Proposta não encontrada.");
  return p;
}

export async function listProposals(ctx: AuthContext | null, opts: { leadId?: string; status?: ProposalStatus } = {}) {
  requirePermission(ctx, "lead:read");
  return db.proposal.findMany({
    where: { organizationId: ctx.organizationId, ...(opts.leadId ? { leadId: opts.leadId } : {}), ...(opts.status ? { status: opts.status } : {}) },
    include: { versions: { orderBy: { version: "desc" }, take: 1 }, lead: { select: { id: true, contactName: true, companyName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
