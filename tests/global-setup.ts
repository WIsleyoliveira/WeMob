import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// Os testes de integração rodam SEMPRE no banco de teste dedicado (nunca no DATABASE_URL de desenvolvimento).
export default function setup() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL não definido (veja .env.example).");
  if (url === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL não pode ser igual a DATABASE_URL.");
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
