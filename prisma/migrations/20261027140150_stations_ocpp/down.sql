-- Reversão manual (com backup e autorização). Remove todos os dados de estações, sessões e telemetria.
DROP TABLE IF EXISTS "RemoteCommand", "SessionMeasurement", "ChargingSession", "OcppMessage", "Tariff", "ConnectorStatusEvent", "Connector", "ChargingStation";
DROP TYPE IF EXISTS "RemoteCommandStatus", "RemoteCommandType", "SessionStatus", "OcppDirection", "ConnectorStatus", "ConnectorType", "ConnectionState", "ChargingProtocol", "StationEnvironment";
ALTER TABLE "Site" DROP COLUMN IF EXISTS "address", DROP COLUMN IF EXISTS "latitude", DROP COLUMN IF EXISTS "longitude", DROP COLUMN IF EXISTS "openingHours", DROP COLUMN IF EXISTS "isPublic";
