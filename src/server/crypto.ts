import { createHash, createHmac, randomBytes } from "node:crypto";

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
/** Hash com segredo para IPs e outros identificadores pessoais usados só para limitação de abuso. */
export const keyedHash = (v: string) => {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET não configurado.");
  return createHmac("sha256", secret).update(v).digest("hex");
};
