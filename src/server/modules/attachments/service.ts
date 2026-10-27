/**
 * Anexos: tipo verificado pelo conteúdo (assinatura do arquivo), nunca pelo nome ou pelo tipo
 * informado pelo navegador. Acesso sempre resolvido pela entidade dona e pela organização.
 */
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { AppError, forbidden, notFound } from "@/server/errors";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import type { Permission } from "@/server/auth/permissions";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { mime: "image/png", ext: "png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

export function detectMime(bytes: Uint8Array) {
  return SIGNATURES.find((s) => bytes.length >= 12 && s.test(bytes)) ?? null;
}

export function safeFilename(name: string, ext: string) {
  const base = name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").replace(/^\.+/, "").slice(0, 80) || "arquivo";
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base.replace(/\.[^.]*$/, "")}.${ext}`;
}

export type AttachmentEntity = "Contract" | "Ticket" | "WorkOrder" | "FinancialEntry";

const WRITE_PERM: Record<AttachmentEntity, Permission> = { Contract: "contract:write", Ticket: "support:write", WorkOrder: "maintenance:write", FinancialEntry: "finance:write" };
const READ_PERM: Record<AttachmentEntity, Permission> = { Contract: "contract:read", Ticket: "support:read", WorkOrder: "maintenance:read", FinancialEntry: "finance:read" };

/** Confere que a entidade pertence à operadora da sessão. */
async function ownedByOperator(entityType: AttachmentEntity, entityId: string, operatorId: string) {
  const where = { id: entityId, operatorId };
  const found =
    entityType === "Contract" ? await db.contract.findFirst({ where, select: { id: true } })
    : entityType === "Ticket" ? await db.ticket.findFirst({ where, select: { id: true } })
    : entityType === "WorkOrder" ? await db.workOrder.findFirst({ where, select: { id: true } })
    : await db.financialEntry.findFirst({ where, select: { id: true } });
  return !!found;
}

export async function addAttachment(
  ctx: AuthContext | null,
  input: { entityType: AttachmentEntity; entityId: string; filename: string; bytes: Uint8Array; visibleToPartner?: boolean },
) {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Sessão expirada ou inválida.");
  if (!(input.entityType in WRITE_PERM)) throw new AppError("VALIDATION", "Tipo de entidade inválido.");
  requirePermission(ctx, WRITE_PERM[input.entityType]);
  if (ctx.orgKind !== "OPERATOR") throw forbidden("Ação restrita à operadora da rede.");
  if (input.bytes.length === 0) throw new AppError("VALIDATION", "Arquivo vazio.");
  if (input.bytes.length > MAX_ATTACHMENT_BYTES) throw new AppError("VALIDATION", "Arquivo acima de 5 MB.");
  const kind = detectMime(input.bytes);
  if (!kind) throw new AppError("VALIDATION", "Tipo de arquivo não permitido. Envie PDF, PNG, JPEG ou WEBP.");
  if (!(await ownedByOperator(input.entityType, input.entityId, ctx.organizationId))) throw notFound();
  const a = await db.attachment.create({
    data: {
      organizationId: ctx.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      filename: safeFilename(input.filename, kind.ext),
      mimeType: kind.mime,
      size: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      data: Buffer.from(input.bytes),
      visibleToPartner: input.entityType === "Contract" && !!input.visibleToPartner,
      uploadedById: ctx.userId,
    },
    select: { id: true, filename: true },
  });
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "attachment.added", entityType: input.entityType, entityId: input.entityId, data: { attachmentId: a.id, filename: a.filename, size: input.bytes.length } });
  return a;
}

export async function listAttachments(ctx: AuthContext | null, entityType: AttachmentEntity, entityId: string) {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Sessão expirada ou inválida.");
  requirePermission(ctx, READ_PERM[entityType]);
  return db.attachment.findMany({
    where: { entityType, entityId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, filename: true, mimeType: true, size: true, sha256: true, visibleToPartner: true, createdAt: true, uploadedById: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Download: operadora com permissão de leitura da entidade; parceiro somente documentos de
 * contrato marcados como visíveis e do PRÓPRIO contrato. Todo download é auditado.
 */
export async function getAttachmentForDownload(ctx: AuthContext | null, id: string) {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Sessão expirada ou inválida.");
  const a = await db.attachment.findFirst({ where: { id, deletedAt: null } });
  if (!a) throw notFound();
  const type = a.entityType as AttachmentEntity;
  let allowed = false;
  if (ctx.orgKind === "OPERATOR") {
    allowed = a.organizationId === ctx.organizationId && ctx.permissions.has(READ_PERM[type]);
  } else if (type === "Contract" && a.visibleToPartner && ctx.permissions.has("partner_portal:read")) {
    allowed = !!(await db.contract.findFirst({ where: { id: a.entityId, partnerOrganizationId: ctx.organizationId, status: { not: "DRAFT" } }, select: { id: true } }));
  }
  if (!allowed) throw notFound(); // não revela existência
  await audit({ organizationId: ctx.organizationId, actorUserId: ctx.userId, action: "attachment.downloaded", entityType: a.entityType, entityId: a.entityId, data: { attachmentId: a.id } });
  return a;
}
