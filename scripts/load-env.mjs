// Carrega o .env com as mesmas regras do Next.js (@next/env), para scripts e app lerem os mesmos valores.
// `tsx --env-file` não trata o escape "\$" (necessário no Next para chaves que começam com "$", como as do Asaas).
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info() {}, error: console.error });
