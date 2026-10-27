/**
 * Cliente HTTP do Asaas (API v3). Único ponto que fala com o provedor. Headers conforme a documentação:
 * access_token, User-Agent e Content-Type. A chave nunca é registrada em log nem devolvida em erros.
 * Erros classificados: validação (400), autenticação (401), limite (429), indisponível (rede/5xx) e
 * TIMEOUT — este último significa resultado DESCONHECIDO (a operação pode ter sido processada).
 */
import { log } from "@/server/log";
import type { AsaasConfig } from "./config";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }>;

export class AsaasError extends Error {
  constructor(
    public kind: "VALIDATION" | "AUTH" | "RATE_LIMIT" | "UNAVAILABLE" | "TIMEOUT" | "NOT_FOUND",
    message: string,
    public httpStatus?: number,
    public errors: { code?: string; description?: string }[] = [],
  ) {
    super(message);
  }
}

export class AsaasClient {
  constructor(private cfg: AsaasConfig, private fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : "";
    const url = `${this.cfg.baseUrl}${path}${qs}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    const started = Date.now();
    let res;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { "Content-Type": "application/json", "User-Agent": this.cfg.userAgent, access_token: this.cfg.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
      log.warn("asaas_request_failed", { method, path, aborted, ms: Date.now() - started });
      // Sem resposta: para POST/DELETE o resultado é desconhecido; GET pode ser repetido com segurança.
      throw new AsaasError(aborted ? "TIMEOUT" : "UNAVAILABLE", aborted ? "Tempo esgotado aguardando o Asaas." : "Falha de comunicação com o Asaas.");
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    log.info("asaas_request", { method, path, status: res.status, ms: Date.now() - started });
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.status >= 200 && res.status < 300) return json as T;
    const errors = ((json as { errors?: { code?: string; description?: string }[] } | null)?.errors ?? []).slice(0, 5);
    const desc = errors.map((e) => e.description).filter(Boolean).join(" ") || `HTTP ${res.status}`;
    if (res.status === 400) throw new AsaasError("VALIDATION", desc, 400, errors);
    if (res.status === 401) throw new AsaasError("AUTH", "Chave de API do Asaas inválida ou de outro ambiente.", 401, errors);
    if (res.status === 404) throw new AsaasError("NOT_FOUND", "Recurso não encontrado no Asaas.", 404, errors);
    if (res.status === 429) throw new AsaasError("RATE_LIMIT", "Limite de requisições do Asaas atingido; aguarde antes de tentar de novo.", 429, errors);
    if (res.status === 403) throw new AsaasError("RATE_LIMIT", "Acesso temporariamente bloqueado pelo Asaas.", 403, errors);
    throw new AsaasError("UNAVAILABLE", `Asaas indisponível (HTTP ${res.status}).`, res.status, errors);
  }
}
