/** Monta o endereço de uma lista mantendo os filtros atuais e trocando só o que mudou (valores vazios saem da URL). */
export function hrefWith(path: string, current: Record<string, string | string[] | undefined>, patch: Record<string, string | number | null | undefined> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (typeof v === "string" && v !== "" && !(k in patch)) p.set(k, v);
  for (const [k, v] of Object.entries(patch)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Lê um parâmetro de busca como texto simples (ignora listas). */
export const param = (sp: Record<string, string | string[] | undefined>, key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : undefined);

/** Número de página válido (1 por padrão). */
export const pageParam = (v: string | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
};
