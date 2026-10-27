-- Reversão manual. Remove dados de empresas, contatos, tarefas e propostas: só com backup e autorização.
DROP TABLE IF EXISTS "ProposalVersion";
DROP TABLE IF EXISTS "Proposal";
DROP TABLE IF EXISTS "CrmTask";
DROP TABLE IF EXISTS "Contact";
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "companyId", DROP COLUMN IF EXISTS "priority", DROP COLUMN IF EXISTS "estimatedValue", DROP COLUMN IF EXISTS "expectedCloseDate", DROP COLUMN IF EXISTS "nextStep";
DROP TABLE IF EXISTS "Company";
ALTER TABLE "PipelineStage" DROP COLUMN IF EXISTS "probability";
DROP TYPE IF EXISTS "ProposalStatus";
DROP TYPE IF EXISTS "LeadPriority";
-- Valores TASK, PROPOSAL, CONVERSION, UPDATE do enum LeadActivityKind não podem ser removidos sem recriar o tipo.
