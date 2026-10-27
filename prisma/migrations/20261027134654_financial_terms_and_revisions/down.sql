-- Reversão manual (com backup e autorização).
ALTER TABLE "Simulation" DROP CONSTRAINT IF EXISTS "Simulation_parentId_fkey";
ALTER TABLE "Simulation" DROP COLUMN IF EXISTS "parentId", DROP COLUMN IF EXISTS "revision", DROP COLUMN IF EXISTS "changes";
ALTER TABLE "CommercialModelVersion" DROP COLUMN IF EXISTS "platformFeeIncludesGateway", DROP COLUMN IF EXISTS "lossTreatment";
DROP TYPE IF EXISTS "LossTreatment";
