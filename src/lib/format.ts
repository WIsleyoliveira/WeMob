const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numFmt = (dp: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Formata valores já calculados (strings decimais do motor). Apenas apresentação. */
export const brl = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : brlFmt.format(Number(v)));
export const num = (v: string | number | null | undefined, dp = 0) => (v === null || v === undefined ? "—" : numFmt(dp).format(Number(v)));
export const pct = (v: string | number | null | undefined, dp = 1) =>
  v === null || v === undefined ? "—" : `${numFmt(dp).format(Number(v) * 100)}%`;
export const kwh = (v: string | number | null | undefined) => (v === null || v === undefined ? "—" : `${num(v, 0)} kWh`);
export const dateTime = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Belem" }).format(new Date(d));
export const date = (d: Date | string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "America/Belem" }).format(new Date(d));
