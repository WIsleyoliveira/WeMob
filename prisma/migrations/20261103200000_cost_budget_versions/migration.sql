-- Orçamento de custos versionado por competência e registro de importações da planilha.
-- CreateTable
CREATE TABLE "public"."PlatformCostBudget" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stations" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "base" DECIMAL(14,2) NOT NULL,
    "prudential" DECIMAL(14,2) NOT NULL,
    "totalMonthly" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededById" TEXT,

    CONSTRAINT "PlatformCostBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlatformCostImport" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "parsed" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "PlatformCostImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformCostBudget_operatorId_competence_idx" ON "public"."PlatformCostBudget"("operatorId", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCostBudget_operatorId_competence_version_key" ON "public"."PlatformCostBudget"("operatorId", "competence", "version");

-- CreateIndex
CREATE INDEX "PlatformCostImport_operatorId_createdAt_idx" ON "public"."PlatformCostImport"("operatorId", "createdAt");


-- Uma versão ATIVA por competência.
CREATE UNIQUE INDEX "PlatformCostBudget_one_active_per_competence" ON "public"."PlatformCostBudget"("operatorId", "competence") WHERE "status" = 'ACTIVE';
