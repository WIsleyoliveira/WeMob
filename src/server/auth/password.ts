import bcrypt from "bcryptjs";
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(12, "A senha deve ter ao menos 12 caracteres.")
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), "Use letras e números.");

export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
// Hash fixo para comparar quando o usuário não existe (tempo de resposta uniforme).
export const DUMMY_HASH = bcrypt.hashSync("sansol-dummy-password", 12);
