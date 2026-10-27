-- CreateEnum
CREATE TYPE "public"."PaymentOperationStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."RecipientStatus" AS ENUM ('PENDING_VALIDATION', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."SplitPolicyStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."ActivationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- AlterEnum
ALTER TYPE "public"."ChargeRequestStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "public"."Driver" ADD COLUMN     "documentEnc" TEXT,
ADD COLUMN     "documentHint" TEXT;

-- AlterTable
ALTER TABLE "public"."Payment" ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "feeAmount" DECIMAL(14,2),
ADD COLUMN     "invoiceUrl" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "method" TEXT NOT NULL DEFAULT 'PREAUTH',
ADD COLUMN     "netValue" DECIMAL(14,2),
ADD COLUMN     "operatorId" TEXT,
ADD COLUMN     "pixExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pixPayload" TEXT,
ADD COLUMN     "remoteStatus" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewOpenedAt" TIMESTAMP(3),
ADD COLUMN     "reviewReason" TEXT,
ADD COLUMN     "reviewResolvedAt" TIMESTAMP(3),
ADD COLUMN     "reviewResolvedById" TEXT,
ADD COLUMN     "splitPolicyId" TEXT,
ADD COLUMN     "splitPolicyVersion" INTEGER;

-- AlterTable
ALTER TABLE "public"."Refund" ADD COLUMN     "remoteStatus" TEXT;

-- CreateTable
CREATE TABLE "public"."GatewayCustomer" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" "public"."PaymentEnvironment" NOT NULL,
    "operatorId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "remoteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentOperation" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" "public"."PaymentEnvironment" NOT NULL,
    "operatorId" TEXT,
    "status" "public"."PaymentOperationStatus" NOT NULL DEFAULT 'STARTED',
    "chargeRequestId" TEXT,
    "paymentId" TEXT,
    "remoteId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "request" JSONB,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentRecipient" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "environment" "public"."PaymentEnvironment" NOT NULL,
    "walletId" TEXT NOT NULL,
    "status" "public"."RecipientStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SplitPolicy" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "siteId" TEXT,
    "version" INTEGER NOT NULL,
    "status" "public"."SplitPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "feeTreatment" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SplitPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SplitParticipant" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipientId" TEXT,
    "percentualValue" DECIMAL(7,4),
    "fixedValue" DECIMAL(14,2),
    "description" TEXT,

    CONSTRAINT "SplitParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PaymentSplit" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "recipientId" TEXT,
    "walletId" TEXT NOT NULL,
    "percentualValue" DECIMAL(7,4),
    "fixedValue" DECIMAL(14,2),
    "totalValue" DECIMAL(14,2),
    "externalReference" TEXT NOT NULL,
    "remoteId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "cancellationReason" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."GatewayActivation" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "status" "public"."ActivationStatus" NOT NULL DEFAULT 'PENDING',
    "checklist" JSONB NOT NULL,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayActivation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GatewayCustomer_provider_environment_operatorId_driverId_key" ON "public"."GatewayCustomer"("provider", "environment", "operatorId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "GatewayCustomer_provider_environment_remoteId_key" ON "public"."GatewayCustomer"("provider", "environment", "remoteId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOperation_key_key" ON "public"."PaymentOperation"("key");

-- CreateIndex
CREATE INDEX "PaymentOperation_status_kind_idx" ON "public"."PaymentOperation"("status", "kind");

-- CreateIndex
CREATE INDEX "PaymentRecipient_operatorId_organizationId_idx" ON "public"."PaymentRecipient"("operatorId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecipient_environment_walletId_key" ON "public"."PaymentRecipient"("environment", "walletId");

-- CreateIndex
CREATE INDEX "SplitPolicy_operatorId_siteId_status_idx" ON "public"."SplitPolicy"("operatorId", "siteId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSplit_externalReference_key" ON "public"."PaymentSplit"("externalReference");

-- CreateIndex
CREATE INDEX "PaymentSplit_paymentId_idx" ON "public"."PaymentSplit"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentSplit_organizationId_status_idx" ON "public"."PaymentSplit"("organizationId", "status");

-- CreateIndex
CREATE INDEX "GatewayActivation_provider_operatorId_status_idx" ON "public"."GatewayActivation"("provider", "operatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalReference_key" ON "public"."Payment"("externalReference");

-- CreateIndex
CREATE INDEX "Payment_operatorId_createdAt_idx" ON "public"."Payment"("operatorId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."GatewayCustomer" ADD CONSTRAINT "GatewayCustomer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "public"."Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SplitParticipant" ADD CONSTRAINT "SplitParticipant_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "public"."SplitPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SplitParticipant" ADD CONSTRAINT "SplitParticipant_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "public"."PaymentRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PaymentSplit" ADD CONSTRAINT "PaymentSplit_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: operadora dona de pagamentos existentes (pela sessão ou pelo pedido de recarga).
UPDATE "public"."Payment" p SET "operatorId" = s."operatorId"
  FROM "public"."ChargingSession" cs JOIN "public"."ChargingStation" s ON s.id = cs."stationId"
  WHERE p."sessionId" = cs.id AND p."operatorId" IS NULL;
UPDATE "public"."Payment" p SET "operatorId" = s."operatorId"
  FROM "public"."ChargeRequest" cr JOIN "public"."ChargingStation" s ON s.id = cr."stationId"
  WHERE cr."paymentId" = p.id AND p."operatorId" IS NULL;

-- No máximo uma cobrança viva por sessão de recarga (evita cobrança duplicada).
CREATE UNIQUE INDEX "Payment_one_live_per_session" ON "public"."Payment"("sessionId")
  WHERE "sessionId" IS NOT NULL AND "status" NOT IN ('FAILED', 'CANCELLED');
