-- CreateEnum
CREATE TYPE "public"."ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "public"."ContractVersionKind" AS ENUM ('ORIGINAL', 'AMENDMENT');

-- CreateEnum
CREATE TYPE "public"."ContractVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."SettlementBase" AS ENUM ('GROSS_REVENUE', 'NET_REVENUE', 'OPERATING_RESULT');

-- CreateEnum
CREATE TYPE "public"."EntryKind" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "public"."EntryCategory" AS ENUM ('CHARGING_REVENUE', 'OTHER_REVENUE', 'ENERGY', 'RENT', 'MAINTENANCE', 'CONNECTIVITY', 'INSURANCE', 'OTHER_EXPENSE', 'PARTNER_SHARE', 'PARTNER_CONTRIBUTION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "public"."EntryStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."EntrySource" AS ENUM ('MANUAL', 'CLOSING', 'ADJUSTMENT', 'WORK_ORDER');

-- CreateEnum
CREATE TYPE "public"."ClosingStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "public"."TicketCategory" AS ENUM ('CHARGER_FAULT', 'CONNECTIVITY', 'PAYMENT', 'DRIVER_SUPPORT', 'INSTALLATION', 'PREVENTIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."TicketOrigin" AS ENUM ('MANUAL', 'DRIVER', 'ALERT', 'PARTNER', 'PREVENTIVE');

-- CreateEnum
CREATE TYPE "public"."TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_THIRD_PARTY', 'WAITING_REQUESTER', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."TicketEventKind" AS ENUM ('CREATED', 'COMMENT', 'STATUS_CHANGE', 'ASSIGNMENT', 'PRIORITY_CHANGE', 'PAUSE', 'RESUME', 'WORK_ORDER', 'ATTACHMENT', 'ALERT');

-- CreateEnum
CREATE TYPE "public"."WorkOrderType" AS ENUM ('CORRECTIVE', 'PREVENTIVE');

-- CreateEnum
CREATE TYPE "public"."WorkOrderStatus" AS ENUM ('OPEN', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."MaintenanceTrigger" AS ENUM ('TIME', 'ENERGY_KWH', 'SESSIONS');

-- CreateEnum
CREATE TYPE "public"."AlertKind" AS ENUM ('STATION_OFFLINE', 'REPEATED_FAULTS', 'AVAILABILITY_DROP', 'SESSION_INTERRUPTED', 'PAYMENT_DIVERGENCE');

-- CreateEnum
CREATE TYPE "public"."AlertSeverity" AS ENUM ('WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "public"."NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "public"."NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED_NOT_CONFIGURED', 'SKIPPED_NO_CONSENT');

-- CreateTable
CREATE TABLE "public"."Attachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "visibleToPartner" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Contract" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "partnerOrganizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "public"."ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "statusReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContractSite" (
    "contractId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractSite_pkey" PRIMARY KEY ("contractId","siteId")
);

-- CreateTable
CREATE TABLE "public"."ContractVersion" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "public"."ContractVersionKind" NOT NULL,
    "status" "public"."ContractVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "commercialModelVersionId" TEXT,
    "royaltyRate" DECIMAL(9,6) NOT NULL,
    "royaltyBase" "public"."SettlementBase" NOT NULL,
    "platformFeeRate" DECIMAL(9,6) NOT NULL,
    "partnerShareRate" DECIMAL(9,6) NOT NULL,
    "partnerShareBase" "public"."SettlementBase" NOT NULL,
    "lossTreatment" "public"."LossTreatment" NOT NULL DEFAULT 'SHARE_MONTHLY',
    "paymentTermDays" INTEGER NOT NULL DEFAULT 10,
    "conditions" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "ContractVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FinancialEntry" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "kind" "public"."EntryKind" NOT NULL,
    "category" "public"."EntryCategory" NOT NULL,
    "status" "public"."EntryStatus" NOT NULL DEFAULT 'OPEN',
    "source" "public"."EntrySource" NOT NULL DEFAULT 'MANUAL',
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "competence" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "siteId" TEXT,
    "stationId" TEXT,
    "partnerOrganizationId" TEXT,
    "contractId" TEXT,
    "closingId" TEXT,
    "adjustsPeriod" TEXT,
    "workOrderId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2),
    "paymentNote" TEXT,
    "paidById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TaxRule" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(9,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PeriodClosing" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "public"."ClosingStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "result" JSONB NOT NULL,
    "resultHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "validations" JSONB NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "PeriodClosing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SlaPolicy" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "contractId" TEXT,
    "priority" "public"."TicketPriority" NOT NULL,
    "responseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "businessHoursOnly" BOOLEAN NOT NULL DEFAULT false,
    "workStartHour" INTEGER NOT NULL DEFAULT 8,
    "workEndHour" INTEGER NOT NULL DEFAULT 18,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Ticket" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "public"."TicketCategory" NOT NULL,
    "priority" "public"."TicketPriority" NOT NULL,
    "origin" "public"."TicketOrigin" NOT NULL,
    "status" "public"."TicketStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT,
    "siteId" TEXT,
    "stationId" TEXT,
    "contractId" TEXT,
    "supportRequestId" TEXT,
    "createdById" TEXT,
    "slaPolicyId" TEXT,
    "slaResponseMinutes" INTEGER,
    "slaResolutionMinutes" INTEGER,
    "slaCalendar" JSONB,
    "firstResponseAt" TIMESTAMP(3),
    "pausedSince" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TicketEvent" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" "public"."TicketEventKind" NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkOrder" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "public"."WorkOrderType" NOT NULL,
    "status" "public"."WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "ticketId" TEXT,
    "planId" TEXT,
    "stationId" TEXT NOT NULL,
    "diagnosis" TEXT,
    "technicianName" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "laborCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "completionNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WorkOrderPart" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MaintenancePlan" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "public"."MaintenanceTrigger" NOT NULL,
    "intervalDays" INTEGER,
    "intervalKwh" INTEGER,
    "intervalSessions" INTEGER,
    "checklist" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AlertRule" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "kind" "public"."AlertKind" NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" "public"."AlertSeverity" NOT NULL,
    "params" JSONB NOT NULL,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
    "escalateAfterMinutes" INTEGER,
    "createTicket" BOOLEAN NOT NULL DEFAULT false,
    "ticketPriority" "public"."TicketPriority" NOT NULL DEFAULT 'HIGH',
    "notifyChannels" "public"."NotificationChannel"[],
    "includeNonProduction" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Alert" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "kind" "public"."AlertKind" NOT NULL,
    "severity" "public"."AlertSeverity" NOT NULL,
    "status" "public"."AlertStatus" NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "stationId" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoResolve" BOOLEAN NOT NULL DEFAULT true,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedReason" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AutomationRun" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT,
    "job" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "stats" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotificationRecipient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "public"."NotificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "alertId" TEXT,
    "channel" "public"."NotificationChannel" NOT NULL,
    "recipientUserId" TEXT,
    "destination" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_entityType_entityId_idx" ON "public"."Attachment"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Contract_partnerOrganizationId_idx" ON "public"."Contract"("partnerOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_operatorId_number_key" ON "public"."Contract"("operatorId", "number");

-- CreateIndex
CREATE INDEX "ContractSite_siteId_idx" ON "public"."ContractSite"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractVersion_contractId_version_key" ON "public"."ContractVersion"("contractId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEntry_workOrderId_key" ON "public"."FinancialEntry"("workOrderId");

-- CreateIndex
CREATE INDEX "FinancialEntry_operatorId_competence_idx" ON "public"."FinancialEntry"("operatorId", "competence");

-- CreateIndex
CREATE INDEX "FinancialEntry_partnerOrganizationId_competence_idx" ON "public"."FinancialEntry"("partnerOrganizationId", "competence");

-- CreateIndex
CREATE INDEX "FinancialEntry_closingId_idx" ON "public"."FinancialEntry"("closingId");

-- CreateIndex
CREATE INDEX "TaxRule_operatorId_idx" ON "public"."TaxRule"("operatorId");

-- CreateIndex
CREATE INDEX "PeriodClosing_operatorId_period_idx" ON "public"."PeriodClosing"("operatorId", "period");

-- CreateIndex
CREATE INDEX "SlaPolicy_operatorId_priority_active_idx" ON "public"."SlaPolicy"("operatorId", "priority", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_supportRequestId_key" ON "public"."Ticket"("supportRequestId");

-- CreateIndex
CREATE INDEX "Ticket_operatorId_status_idx" ON "public"."Ticket"("operatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_operatorId_number_key" ON "public"."Ticket"("operatorId", "number");

-- CreateIndex
CREATE INDEX "TicketEvent_ticketId_createdAt_idx" ON "public"."TicketEvent"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkOrder_operatorId_status_idx" ON "public"."WorkOrder"("operatorId", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_planId_idx" ON "public"."WorkOrder"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_operatorId_number_key" ON "public"."WorkOrder"("operatorId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "AlertRule_operatorId_kind_key" ON "public"."AlertRule"("operatorId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_ticketId_key" ON "public"."Alert"("ticketId");

-- CreateIndex
CREATE INDEX "Alert_operatorId_status_idx" ON "public"."Alert"("operatorId", "status");

-- CreateIndex
CREATE INDEX "Alert_operatorId_dedupeKey_idx" ON "public"."Alert"("operatorId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AutomationRun_job_startedAt_idx" ON "public"."AutomationRun"("job", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_userId_organizationId_channel_key" ON "public"."NotificationRecipient"("userId", "organizationId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "public"."Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_status_nextAttemptAt_idx" ON "public"."Notification"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "public"."Contract" ADD CONSTRAINT "Contract_partnerOrganizationId_fkey" FOREIGN KEY ("partnerOrganizationId") REFERENCES "public"."Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractSite" ADD CONSTRAINT "ContractSite_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractSite" ADD CONSTRAINT "ContractSite_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractVersion" ADD CONSTRAINT "ContractVersion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContractVersion" ADD CONSTRAINT "ContractVersion_commercialModelVersionId_fkey" FOREIGN KEY ("commercialModelVersionId") REFERENCES "public"."CommercialModelVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FinancialEntry" ADD CONSTRAINT "FinancialEntry_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FinancialEntry" ADD CONSTRAINT "FinancialEntry_partnerOrganizationId_fkey" FOREIGN KEY ("partnerOrganizationId") REFERENCES "public"."Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FinancialEntry" ADD CONSTRAINT "FinancialEntry_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "public"."PeriodClosing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ticket" ADD CONSTRAINT "Ticket_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Ticket" ADD CONSTRAINT "Ticket_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TicketEvent" ADD CONSTRAINT "TicketEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."MaintenancePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrder" ADD CONSTRAINT "WorkOrder_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WorkOrderPart" ADD CONSTRAINT "WorkOrderPart_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "public"."WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "public"."AlertRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Alert" ADD CONSTRAINT "Alert_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Alert" ADD CONSTRAINT "Alert_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "public"."Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices únicos parciais (não expressáveis no schema Prisma):
-- no máximo um fechamento APROVADO e um PENDENTE por operadora e período (corrida entre aprovações);
CREATE UNIQUE INDEX "PeriodClosing_one_approved" ON "public"."PeriodClosing"("operatorId", "period") WHERE "status" = 'APPROVED';
CREATE UNIQUE INDEX "PeriodClosing_one_pending" ON "public"."PeriodClosing"("operatorId", "period") WHERE "status" = 'PENDING_APPROVAL';
-- um alerta não resolvido por chave de deduplicação (avaliações concorrentes não duplicam);
CREATE UNIQUE INDEX "Alert_one_unresolved" ON "public"."Alert"("operatorId", "dedupeKey") WHERE "status" <> 'RESOLVED';
-- uma OS preventiva em aberto por plano.
CREATE UNIQUE INDEX "WorkOrder_one_open_per_plan" ON "public"."WorkOrder"("planId") WHERE "planId" IS NOT NULL AND "status" IN ('OPEN', 'SCHEDULED', 'IN_PROGRESS');
