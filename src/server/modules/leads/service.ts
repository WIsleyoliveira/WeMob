import { z } from "zod";
import type { LeadActivityKind, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { hit } from "@/server/rate-limit";
import { keyedHash } from "@/server/crypto";
import { AppError, notFound } from "@/server/errors";
import { requireOperator, requirePermission, type AuthContext } from "@/server/auth/context";

export const PRIVACY_POLICY_VERSION = "2026-10-27";
export const MIN_FORM_FILL_MS = 2500;
export const STALE_LEAD_DAYS = 7;

export const BUSINESS_TYPES = {
  FUEL_STATION: "Posto de combustível",
  SUPERMARKET: "Supermercado",
  PARKING: "Estacionamento",
  SHOPPING_CENTER: "Centro comercial",
  COMPANY: "Empresa / frota",
  OTHER: "Outro",
} as const;

export const LEAD_SOURCES = {
  WEBSITE_VIABILITY: "Site — estudo de viabilidade",
  WEBSITE_CONTACT: "Site — contato",
  WEBSITE_SIMULATOR: "Site — simulador",
  MANUAL: "Cadastro manual",
  REFERRAL: "Indicação",
  EVENT: "Evento",
} as const;

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"] as const;

const digits = (v: string) => v.replace(/\D/g, "");
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const leadFieldsSchema = z.object({
  contactName: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(200),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? digits(v) : undefined))
    .refine((v) => !v || (v.length >= 10 && v.length <= 13), "Telefone inválido (inclua o DDD)."),
  companyName: optionalText(160),
  businessType: z.enum(Object.keys(BUSINESS_TYPES) as [keyof typeof BUSINESS_TYPES]).optional(),
  city: optionalText(120),
  state: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(UFS)).optional(),
  interestModel: z.enum(["compra-integral", "parceria-50-50", "indefinido"]).optional(),
  message: optionalText(2000),
  campaign: optionalText(120),
});

export const publicLeadSchema = leadFieldsSchema.extend({
  source: z.enum(["WEBSITE_VIABILITY", "WEBSITE_CONTACT", "WEBSITE_SIMULATOR"]),
  consent: z.literal(true, { errorMap: () => ({ message: "É necessário aceitar a política de privacidade." }) }),
});

export type PublicLeadResult = { ok: true; leadId?: string; duplicate?: boolean; discarded?: boolean };

export async function getOperatorOrganization() {
  const org = await db.organization.findFirst({ where: { kind: "OPERATOR", deletedAt: null }, orderBy: { createdAt: "asc" } });
  if (!org) throw new AppError("NOT_FOUND", "Organização operadora não configurada. Rode o seed (npm run db:seed).");
  return org;
}

/**
 * Captação pública de leads (site). Anti-spam: honeypot, tempo mínimo de preenchimento e
 * limite por IP. Deduplicação: e-mail ou telefone de lead em aberto → registra nova interação no lead existente.
 */
export async function submitPublicLead(
  raw: Record<string, unknown>,
  meta: { ip?: string; honeypot?: string; formStartedAt?: number; now?: number },
): Promise<PublicLeadResult> {
  const now = meta.now ?? Date.now();
  if (meta.honeypot || !meta.formStartedAt || now - meta.formStartedAt < MIN_FORM_FILL_MS) {
    return { ok: true, discarded: true }; // resposta neutra para robôs, nada é persistido
  }
  if (meta.ip && !(await hit(`lead-ip:${keyedHash(meta.ip)}`, 5, 60 * 60 * 1000))) {
    throw new AppError("RATE_LIMITED", "Recebemos muitas solicitações deste endereço. Tente novamente mais tarde.");
  }
  const data = publicLeadSchema.parse(raw);
  const org = await getOperatorOrganization();

  return db.$transaction(async (tx) => {
    // Serializa envios do mesmo e-mail ou telefone para evitar duplicidade sob concorrência
    // (chaves em ordem fixa para não haver deadlock).
    for (const key of [`e:${data.email}`, ...(data.phone ? [`p:${data.phone}`] : [])].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${org.id + key}))`;
    }
    const existing = await findOpenDuplicate(tx, org.id, data.email, data.phone);
    if (existing) {
      await tx.leadActivity.create({
        data: { leadId: existing.id, kind: "DUPLICATE_SUBMISSION", body: data.message, data: { source: data.source, campaign: data.campaign ?? null } },
      });
      return { ok: true as const, leadId: existing.id, duplicate: true };
    }
    const firstStage = await tx.pipelineStage.findFirstOrThrow({ where: { organizationId: org.id }, orderBy: { position: "asc" } });
    const { consent: _consent, ...fields } = data;
    const lead = await tx.lead.create({
      data: {
        ...fields,
        organizationId: org.id,
        stageId: firstStage.id,
        emailNormalized: data.email,
        phoneNormalized: data.phone,
        consentAt: new Date(now),
        consentPolicyVer: PRIVACY_POLICY_VERSION,
      },
    });
    await tx.leadActivity.create({ data: { leadId: lead.id, kind: "CREATED", data: { source: data.source } } });
    await audit({ organizationId: org.id, action: "lead.created", entityType: "Lead", entityId: lead.id, data: { source: data.source } }, tx);
    return { ok: true as const, leadId: lead.id };
  });
}

async function findOpenDuplicate(tx: Prisma.TransactionClient, organizationId: string, email: string, phone?: string) {
  return tx.lead.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      stage: { isWon: false, isLost: false },
      OR: [{ emailNormalized: email }, ...(phone ? [{ phoneNormalized: phone }] : [])],
    },
    orderBy: { createdAt: "asc" },
  });
}

export const leadFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  stageId: z.string().optional(),
  source: z.enum(Object.keys(LEAD_SOURCES) as [keyof typeof LEAD_SOURCES]).optional(),
  assigneeId: z.string().optional(),
});

export async function listLeads(ctx: AuthContext | null, rawFilter: unknown = {}) {
  requirePermission(ctx, "lead:read");
  const f = leadFilterSchema.parse(rawFilter);
  return db.lead.findMany({
    where: {
      organizationId: ctx.organizationId,
      deletedAt: null,
      stageId: f.stageId,
      source: f.source,
      assigneeId: f.assigneeId,
      ...(f.q
        ? {
            OR: [
              { contactName: { contains: f.q, mode: "insensitive" } },
              { companyName: { contains: f.q, mode: "insensitive" } },
              { emailNormalized: { contains: f.q.toLowerCase() } },
              { city: { contains: f.q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { stage: true, assignee: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
}

export async function listStages(ctx: AuthContext | null) {
  requirePermission(ctx, "lead:read");
  return db.pipelineStage.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { position: "asc" } });
}

export async function getLead(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "lead:read");
  const lead = await db.lead.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    include: {
      stage: true,
      assignee: { select: { id: true, name: true } },
      activities: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!lead) throw notFound("Lead não encontrado.");
  return lead;
}

export const moveStageSchema = z.object({
  leadId: z.string().min(1),
  stageId: z.string().min(1),
  lostReason: z.string().trim().max(500).optional(),
});

export async function moveLeadStage(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const { leadId, stageId, lostReason } = moveStageSchema.parse(raw);
  const [lead, stage] = await Promise.all([
    db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId, deletedAt: null }, include: { stage: true } }),
    db.pipelineStage.findFirst({ where: { id: stageId, organizationId: ctx.organizationId } }),
  ]);
  if (!lead || !stage) throw notFound();
  if (lead.stageId === stage.id) return lead;
  if (stage.isLost && !lostReason) throw new AppError("VALIDATION", "Informe o motivo da perda.");
  return db.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id: lead.id },
      data: { stageId: stage.id, stageChangedAt: new Date(), lostReason: stage.isLost ? lostReason : null },
    });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id,
        kind: "STAGE_CHANGE",
        authorId: ctx.userId,
        body: stage.isLost ? lostReason : undefined,
        data: { from: lead.stage.name, to: stage.name, daysInPreviousStage: daysBetween(lead.stageChangedAt, new Date()) },
      },
    });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "lead.stage_changed", entityType: "Lead", entityId: lead.id, data: { from: lead.stageId, to: stage.id } }, tx);
    return updated;
  });
}

export const activitySchema = z.object({
  leadId: z.string().min(1),
  kind: z.enum(["NOTE", "CALL", "MEETING", "EMAIL"]),
  body: z.string().trim().min(1, "Escreva o registro.").max(4000),
});

export async function addLeadActivity(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const { leadId, kind, body } = activitySchema.parse(raw);
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId, deletedAt: null } });
  if (!lead) throw notFound();
  return db.leadActivity.create({ data: { leadId, kind: kind as LeadActivityKind, body, authorId: ctx.userId } });
}

export async function assignLead(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:assign");
  const { leadId, assigneeId } = z.object({ leadId: z.string(), assigneeId: z.string().nullable() }).parse(raw);
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId, deletedAt: null } });
  if (!lead) throw notFound();
  if (assigneeId) {
    const m = await db.membership.findFirst({ where: { userId: assigneeId, organizationId: ctx.organizationId, revokedAt: null } });
    if (!m) throw new AppError("VALIDATION", "Responsável não pertence à organização.");
  }
  await db.$transaction([
    db.lead.update({ where: { id: leadId }, data: { assigneeId } }),
    db.leadActivity.create({ data: { leadId, kind: "ASSIGNMENT", authorId: ctx.userId, data: { assigneeId } } }),
  ]);
}

export async function createManualLead(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  requireOperator(ctx);
  const data = leadFieldsSchema.extend({ source: z.enum(["MANUAL", "REFERRAL", "EVENT"]) }).parse(raw);
  return db.$transaction(async (tx) => {
    const dup = await findOpenDuplicate(tx, ctx.organizationId, data.email, data.phone);
    if (dup) throw new AppError("CONFLICT", "Já existe um lead em aberto com este e-mail ou telefone.", { leadId: dup.id });
    const firstStage = await tx.pipelineStage.findFirstOrThrow({ where: { organizationId: ctx.organizationId }, orderBy: { position: "asc" } });
    const lead = await tx.lead.create({
      data: { ...data, organizationId: ctx.organizationId, stageId: firstStage.id, emailNormalized: data.email, phoneNormalized: data.phone, assigneeId: ctx.userId },
    });
    await tx.leadActivity.create({ data: { leadId: lead.id, kind: "CREATED", authorId: ctx.userId, data: { source: data.source } } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "lead.created", entityType: "Lead", entityId: lead.id }, tx);
    return lead;
  });
}

/** Indicadores do funil calculados a partir dos dados persistidos. */
export async function pipelineSummary(ctx: AuthContext | null) {
  requirePermission(ctx, "lead:read");
  const [stages, leads] = await Promise.all([
    db.pipelineStage.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { position: "asc" } }),
    db.lead.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null }, select: { stageId: true, stageChangedAt: true, createdAt: true } }),
  ]);
  const byStage = new Map(stages.map((s) => [s.id, 0]));
  for (const l of leads) byStage.set(l.stageId, (byStage.get(l.stageId) ?? 0) + 1);
  const won = stages.filter((s) => s.isWon).reduce((a, s) => a + (byStage.get(s.id) ?? 0), 0);
  const lost = stages.filter((s) => s.isLost).reduce((a, s) => a + (byStage.get(s.id) ?? 0), 0);
  const closedIds = new Set(stages.filter((s) => s.isWon || s.isLost).map((s) => s.id));
  const staleCutoff = Date.now() - STALE_LEAD_DAYS * 86400000;
  const stale = leads.filter((l) => !closedIds.has(l.stageId) && l.stageChangedAt.getTime() < staleCutoff).length;
  const last30 = leads.filter((l) => l.createdAt.getTime() > Date.now() - 30 * 86400000).length;
  return {
    total: leads.length,
    open: leads.length - won - lost,
    won,
    lost,
    stale,
    newLast30Days: last30,
    conversionRate: won + lost > 0 ? won / (won + lost) : null,
    stages: stages.map((s) => ({ ...s, count: byStage.get(s.id) ?? 0 })),
    computedAt: new Date(),
  };
}

function daysBetween(a: Date, b: Date) {
  return Math.round(((b.getTime() - a.getTime()) / 86400000) * 10) / 10;
}

export async function listAssignableUsers(ctx: AuthContext | null) {
  requirePermission(ctx, "lead:assign");
  const ms = await db.membership.findMany({
    where: { organizationId: ctx.organizationId, revokedAt: null, user: { disabledAt: null } },
    include: { user: { select: { id: true, name: true } } },
  });
  return ms.map((m) => m.user);
}
