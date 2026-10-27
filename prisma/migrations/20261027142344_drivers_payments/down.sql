-- Reversão manual (com backup e autorização). Remove motoristas, pedidos, pagamentos e eventos.
DROP TABLE IF EXISTS "SandboxGatewayCharge", "Refund", "PaymentEvent", "ChargeRequest", "Payment", "SupportRequest", "SessionRating", "DriverIdTag", "Vehicle", "DriverSession", "Driver" CASCADE;
ALTER TABLE "ChargingSession" DROP COLUMN IF EXISTS "driverId", DROP COLUMN IF EXISTS "tariffPricePerKwh", DROP COLUMN IF EXISTS "tariffPricePerMin", DROP COLUMN IF EXISTS "amount";
DROP TYPE IF EXISTS "RefundStatus", "PaymentEnvironment", "PaymentStatus", "ChargeRequestStatus";
