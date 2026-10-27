-- Reversão manual (Prisma não executa down migrations). Aplicar somente com backup e autorização.
DROP TABLE IF EXISTS "PasswordResetToken";
