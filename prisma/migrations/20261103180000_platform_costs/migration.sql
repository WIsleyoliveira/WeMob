-- Custos operacionais da plataforma WeMob (orçamento de despesa, separado da receita 30/70 e do fechamento dos postos).
-- CreateEnum
CREATE TYPE "public"."PlatformCostCategory" AS ENUM ('INFRASTRUCTURE', 'SERVICES', 'OPERATIONS', 'OTHER');

-- CreateTable
CREATE TABLE "public"."PlatformCostItem" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "public"."PlatformCostCategory" NOT NULL,
    "baseMonthly" DECIMAL(14,2) NOT NULL,
    "fxExposure" DECIMAL(9,6) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCostItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformCostAssumptions" (
    "operatorId" TEXT NOT NULL,
    "fxStressRate" DECIMAL(9,6) NOT NULL,
    "reserveRate" DECIMAL(9,6) NOT NULL,
    "perStationCost" DECIMAL(14,2) NOT NULL,
    "perStationReserve" DECIMAL(14,2) NOT NULL,
    "budgetTolerance" DECIMAL(9,6) NOT NULL,
    "sourceNote" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCostAssumptions_pkey" PRIMARY KEY ("operatorId")
);

-- CreateTable
CREATE TABLE "public"."PlatformCostActual" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "itemKey" TEXT,
    "category" "public"."PlatformCostCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "originalAmount" DECIMAL(14,2),
    "fxRate" DECIMAL(12,6),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "PlatformCostActual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCostItem_operatorId_key_key" ON "public"."PlatformCostItem"("operatorId", "key");

-- CreateIndex
CREATE INDEX "PlatformCostActual_operatorId_competence_idx" ON "public"."PlatformCostActual"("operatorId", "competence");
