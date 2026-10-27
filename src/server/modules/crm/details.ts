import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, notFound } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";

export const PRIORITY_LABEL = { LOW: "Baixa", MEDIUM: "Média", HIGH: "Alta" } as const;

export const leadDetailsSchema = z.object({
  leadId: z.string().min(1),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  estimatedValue: z.coerce.number().min(0).max(1e10).optional(),
  expectedCloseDate: z.coerce.date().optional(),
  nextStep: z.string().trim().max(300).optional(),
});

/** Atualiza qualificação comercial do lead (prioridade, valor estimado, previsão, próximo passo). */
export async function updateLeadDetails(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const d = leadDetailsSchema.parse(raw);
  const lead = await db.lead.findFirst({ where: { id: d.leadId, organizationId: ctx.organizationId, deletedAt: null } });
  if (!lead) throw notFound();
  const data = {
    priority: d.priority,
    estimatedValue: d.estimatedValue ?? null,
    expectedCloseDate: d.expectedCloseDate ?? null,
    nextStep: d.nextStep ?? null,
  };
  await db.$transaction([
    db.lead.update({ where: { id: lead.id }, data }),
    db.leadActivity.create({ data: { leadId: lead.id, kind: "UPDATE", authorId: ctx.userId, data: { ...data, expectedCloseDate: data.expectedCloseDate?.toISOString() ?? null } } }),
    db.auditEvent.create({ data: { organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "lead.details_updated", entityType: "Lead", entityId: lead.id } }),
  ]);
}

const normalizeName = (v: string) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const digits = (v: string) => v.replace(/\D/g, "");

export const linkCompanySchema = z.object({
  leadId: z.string().min(1),
  name: z.string().trim().min(2, "Informe o nome da empresa.").max(160),
  document: z
    .string()
    .optional()
    .transform((v) => (v ? digits(v) : undefined))
    .refine((v) => !v || v.length === 11 || v.length === 14, "CPF (11) ou CNPJ (14 dígitos)."),
});

/**
 * Vincula o lead a uma empresa, reaproveitando a existente (mesmo documento ou mesmo nome normalizado)
 * e registra o contato do lead na empresa sem duplicar e-mail.
 */
export async function linkLeadToCompany(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const d = linkCompanySchema.parse(raw);
  const lead = await db.lead.findFirst({ where: { id: d.leadId, organizationId: ctx.organizationId, deletedAt: null } });
  if (!lead) throw notFound();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.organizationId + ":company:" + (d.document ?? normalizeName(d.name))}))`;
    let company = d.document ? await tx.company.findFirst({ where: { organizationId: ctx.organizationId, document: d.document } }) : null;
    company ??= await tx.company.findFirst({ where: { organizationId: ctx.organizationId, nameNormalized: normalizeName(d.name), ...(d.document ? { document: null } : {}) } });
    if (company && d.document && !company.document) company = await tx.company.update({ where: { id: company.id }, data: { document: d.document } });
    company ??= await tx.company.create({
      data: { organizationId: ctx.organizationId, name: d.name, nameNormalized: normalizeName(d.name), document: d.document, businessType: lead.businessType, city: lead.city, state: lead.state },
    });
    await tx.contact.upsert({
      where: { companyId_emailNormalized: { companyId: company.id, emailNormalized: lead.emailNormalized } },
      create: { companyId: company.id, name: lead.contactName, email: lead.email, emailNormalized: lead.emailNormalized, phone: lead.phone },
      update: {},
    });
    await tx.lead.update({ where: { id: lead.id }, data: { companyId: company.id } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "lead.company_linked", entityType: "Lead", entityId: lead.id, data: { companyId: company.id } }, tx);
    return company;
  });
}

export async function listCompanies(ctx: AuthContext | null, q?: string) {
  requirePermission(ctx, "lead:read");
  return db.company.findMany({
    where: { organizationId: ctx.organizationId, ...(q ? { nameNormalized: { contains: normalizeName(q) } } : {}) },
    include: { _count: { select: { contacts: true, leads: true } }, convertedOrganization: { select: { id: true, name: true, kind: true } } },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function getCompany(ctx: AuthContext | null, id: string) {
  requirePermission(ctx, "lead:read");
  const c = await db.company.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { contacts: true, leads: { include: { stage: true } }, convertedOrganization: true },
  });
  if (!c) throw notFound("Empresa não encontrada.");
  return c;
}

/**
 * Converte o lead ganho em organização parceira/investidora. Idempotente: se a empresa já foi
 * convertida, reaproveita a organização; se já existe organização com o mesmo documento, reaproveita-a.
 */
export async function convertLeadToPartner(ctx: AuthContext | null, raw: unknown) {
  requirePermission(ctx, "lead:write");
  const { leadId, kind } = z.object({ leadId: z.string(), kind: z.enum(["PARTNER", "INVESTOR"]) }).parse(raw);
  const lead = await db.lead.findFirst({ where: { id: leadId, organizationId: ctx.organizationId, deletedAt: null }, include: { stage: true, company: true } });
  if (!lead) throw notFound();
  if (!lead.stage.isWon) throw new AppError("VALIDATION", "Somente leads na etapa de ganho podem ser convertidos.");
  if (!lead.company) throw new AppError("VALIDATION", "Vincule o lead a uma empresa antes de converter.");
  const company = lead.company;
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"convert:" + company.id}))`;
    const fresh = await tx.company.findUniqueOrThrow({ where: { id: company.id } });
    if (fresh.convertedOrganizationId) return { organizationId: fresh.convertedOrganizationId, reused: true };
    const existing = fresh.document ? await tx.organization.findFirst({ where: { document: fresh.document, deletedAt: null, kind: { not: "OPERATOR" } } }) : null;
    const org = existing ?? (await tx.organization.create({ data: { name: fresh.name, kind, document: fresh.document } }));
    await tx.company.update({ where: { id: fresh.id }, data: { convertedOrganizationId: org.id } });
    await tx.leadActivity.create({ data: { leadId: lead.id, kind: "CONVERSION", authorId: ctx.userId, data: { organizationId: org.id, kind: org.kind, reused: !!existing } } });
    await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "lead.converted", entityType: "Organization", entityId: org.id, data: { leadId: lead.id, reused: !!existing } }, tx);
    return { organizationId: org.id, reused: !!existing };
  });
}
