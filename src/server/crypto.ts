import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
/** Hash com segredo para IPs e outros identificadores pessoais usados só para limitação de abuso. */
export const keyedHash = (v: string) => {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET não configurado.");
  return createHmac("sha256", secret).update(v).digest("hex");
};

/**
 * Cifra campos pessoais em repouso (AES-256-GCM). Chave: DATA_ENCRYPTION_KEY com 32 bytes em hex (64 caracteres)
 * ou base64. Formato: v1:<iv>:<tag>:<dados> (base64url). Sem chave configurada, a gravação é recusada.
 */
function dataKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY ?? "";
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY ausente ou inválida (32 bytes em hex ou base64).");
  return key;
}

export function encryptField(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dataKey(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${data.toString("base64url")}`;
}

export function decryptField(enc: string) {
  const [v, iv, tag, data] = enc.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Campo cifrado em formato desconhecido.");
  const d = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
