import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL não definido.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
