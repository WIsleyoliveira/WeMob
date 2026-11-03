/**
 * ID de correlação: liga as linhas de log de uma mesma requisição, mensagem OCPP ou execução de automação.
 * - HTTP: o middleware (`src/middleware.ts`) aceita o `x-request-id` do proxy (se válido) ou gera um, e o devolve na
 *   resposta; ações e rotas que gravam log entram no contexto com `withRequestCorrelation`.
 * - Processo OCPP: cada mensagem roda com `ocpp:<estação>:<UniqueId>`; cada automação com `job:<nome>:<execução>`.
 * O ID nunca contém dado pessoal.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";
const VALID = /^[A-Za-z0-9._:-]{8,128}$/;

const store = new AsyncLocalStorage<{ id: string }>();

export const isValidCorrelationId = (v: string | null | undefined): v is string => !!v && VALID.test(v);
export const newCorrelationId = () => randomUUID();

export function withCorrelation<T>(id: string | undefined, fn: () => T): T {
  return store.run({ id: isValidCorrelationId(id) ? id : newCorrelationId() }, fn);
}

export const correlationId = () => store.getStore()?.id;

/** ID da requisição HTTP atual (cabeçalho posto pelo middleware); fora de uma requisição, undefined. */
export async function requestCorrelationId(): Promise<string | undefined> {
  try {
    const { headers } = await import("next/headers");
    const v = (await headers()).get(REQUEST_ID_HEADER);
    return isValidCorrelationId(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Executa `fn` no contexto da requisição atual (mantém o contexto se já houver um). */
export async function withRequestCorrelation<T>(fn: () => Promise<T>): Promise<T> {
  if (correlationId()) return fn();
  return withCorrelation(await requestCorrelationId(), fn);
}
