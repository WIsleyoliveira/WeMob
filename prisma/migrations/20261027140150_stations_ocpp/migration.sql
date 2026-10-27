-- CreateEnum
CREATE TYPE "public"."StationEnvironment" AS ENUM ('PRODUCTION', 'TEST', 'SIMULATED');

-- CreateEnum
CREATE TYPE "public"."ChargingProtocol" AS ENUM ('OCPP16J', 'OCPP201', 'NONE');

-- CreateEnum
CREATE TYPE "public"."ConnectionState" AS ENUM ('NEVER_CONNECTED', 'CONNECTED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "public"."ConnectorType" AS ENUM ('CCS2', 'TYPE2', 'CHADEMO', 'GBT', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ConnectorStatus" AS ENUM ('AVAILABLE', 'PREPARING', 'CHARGING', 'SUSPENDED_EVSE', 'SUSPENDED_EV', 'FINISHING', 'RESERVED', 'UNAVAILABLE', 'FAULTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."OcppDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "public"."SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'COMMUNICATION_LOST');

-- CreateEnum
CREATE TYPE "public"."RemoteCommandType" AS ENUM ('RESET', 'REMOTE_START', 'REMOTE_STOP', 'UNLOCK_CONNECTOR', 'CHANGE_AVAILABILITY');

-- CreateEnum
CREATE TYPE "public"."RemoteCommandStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'TIMEOUT', 'FAILED', 'BLOCKED');

-- AlterTable
ALTER TABLE "public"."Site" ADD COLUMN     "address" TEXT,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "openingHours" TEXT;

-- CreateTable
CREATE TABLE "public"."ChargingStation" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "ocppIdentity" TEXT NOT NULL,
    "authSecretHash" TEXT,
    "protocol" "public"."ChargingProtocol" NOT NULL DEFAULT 'OCPP16J',
    "environment" "public"."StationEnvironment" NOT NULL DEFAULT 'PRODUCTION',
    "vendor" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "firmwareVersion" TEXT,
    "heartbeatInterval" INTEGER NOT NULL DEFAULT 300,
    "connectionState" "public"."ConnectionState" NOT NULL DEFAULT 'NEVER_CONNECTED',
    "lastSeenAt" TIMESTAMP(3),
    "lastBootAt" TIMESTAMP(3),
    "clockSkewMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChargingStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Connector" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "type" "public"."ConnectorType" NOT NULL DEFAULT 'CCS2',
    "maxPowerKw" DECIMAL(8,2) NOT NULL,
    "status" "public"."ConnectorStatus" NOT NULL DEFAULT 'UNKNOWN',
    "errorCode" TEXT,
    "statusAt" TIMESTAMP(3),
    "statusReceivedAt" TIMESTAMP(3),

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ConnectorStatusEvent" (
    "id" TEXT NOT NULL,
    "connectorPk" TEXT NOT NULL,
    "status" "public"."ConnectorStatus" NOT NULL,
    "errorCode" TEXT,
    "chargerTime" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied" BOOLEAN NOT NULL,

    CONSTRAINT "ConnectorStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tariff" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "pricePerKwh" DECIMAL(10,4) NOT NULL,
    "pricePerMin" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OcppMessage" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "direction" "public"."OcppDirection" NOT NULL,
    "messageId" TEXT NOT NULL,
    "action" TEXT,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "chargerTime" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "OcppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChargingSession" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "connectorId" INTEGER NOT NULL,
    "transactionId" INTEGER NOT NULL,
    "idTag" TEXT NOT NULL,
    "environment" "public"."StationEnvironment" NOT NULL,
    "meterStartWh" INTEGER NOT NULL,
    "meterStopWh" INTEGER,
    "lastMeterWh" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "status" "public"."SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SessionMeasurement" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "energyWh" INTEGER,
    "powerW" INTEGER,

    CONSTRAINT "SessionMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RemoteCommand" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "type" "public"."RemoteCommandType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."RemoteCommandStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "ocppMessageId" TEXT,
    "response" JSONB,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RemoteCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChargingStation_ocppIdentity_key" ON "public"."ChargingStation"("ocppIdentity");

-- CreateIndex
CREATE INDEX "ChargingStation_operatorId_idx" ON "public"."ChargingStation"("operatorId");

-- CreateIndex
CREATE INDEX "ChargingStation_siteId_idx" ON "public"."ChargingStation"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Connector_stationId_connectorId_key" ON "public"."Connector"("stationId", "connectorId");

-- CreateIndex
CREATE INDEX "ConnectorStatusEvent_connectorPk_receivedAt_idx" ON "public"."ConnectorStatusEvent"("connectorPk", "receivedAt");

-- CreateIndex
CREATE INDEX "Tariff_siteId_validFrom_idx" ON "public"."Tariff"("siteId", "validFrom");

-- CreateIndex
CREATE INDEX "OcppMessage_stationId_receivedAt_idx" ON "public"."OcppMessage"("stationId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OcppMessage_stationId_direction_messageId_key" ON "public"."OcppMessage"("stationId", "direction", "messageId");

-- CreateIndex
CREATE INDEX "ChargingSession_stationId_status_idx" ON "public"."ChargingSession"("stationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChargingSession_stationId_transactionId_key" ON "public"."ChargingSession"("stationId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ChargingSession_stationId_connectorId_startedAt_idTag_key" ON "public"."ChargingSession"("stationId", "connectorId", "startedAt", "idTag");

-- CreateIndex
CREATE UNIQUE INDEX "SessionMeasurement_sessionId_timestamp_key" ON "public"."SessionMeasurement"("sessionId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "RemoteCommand_ocppMessageId_key" ON "public"."RemoteCommand"("ocppMessageId");

-- CreateIndex
CREATE INDEX "RemoteCommand_stationId_status_idx" ON "public"."RemoteCommand"("stationId", "status");

-- AddForeignKey
ALTER TABLE "public"."ChargingStation" ADD CONSTRAINT "ChargingStation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Connector" ADD CONSTRAINT "Connector_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ConnectorStatusEvent" ADD CONSTRAINT "ConnectorStatusEvent_connectorPk_fkey" FOREIGN KEY ("connectorPk") REFERENCES "public"."Connector"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tariff" ADD CONSTRAINT "Tariff_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "public"."Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."OcppMessage" ADD CONSTRAINT "OcppMessage_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ChargingSession" ADD CONSTRAINT "ChargingSession_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SessionMeasurement" ADD CONSTRAINT "SessionMeasurement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."ChargingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RemoteCommand" ADD CONSTRAINT "RemoteCommand_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "public"."ChargingStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
