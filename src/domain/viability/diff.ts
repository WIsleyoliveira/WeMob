/** Diferenças entre dois conjuntos de premissas (objetos JSON), por caminho. */
export type Change = { path: string; before: unknown; after: unknown };

function flatten(v: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v) && v.some((x) => x !== null && typeof x === "object")) {
    v.forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
  } else {
    out[prefix] = v;
  }
  return out;
}

const IGNORED = new Set(["versionStatusAtRun", "terms.versionId"]);

export function diffInputs(before: unknown, after: unknown): Change[] {
  const a = flatten(before);
  const b = flatten(after);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !IGNORED.has(k)).sort();
  return keys
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => ({ path: k, before: a[k] ?? null, after: b[k] ?? null }));
}

export const INPUT_LABELS: Record<string, string> = {
  availability: "Disponibilidade",
  equivalentHoursPerDay: "Horas equivalentes/dia",
  occupancyRate: "Ocupação",
  averagePowerFactor: "Fator de potência médio",
  daysPerMonth: "Dias por mês",
  kwhPerSession: "kWh por sessão",
  pricePerKwh: "Preço de venda (R$/kWh)",
  energyCostPerKwh: "Custo da energia (R$/kWh)",
  chargingEfficiency: "Eficiência de recarga",
  commissionRate: "Comissões",
  gatewayRate: "Gateway (%)",
  gatewayFixedPerSession: "Gateway por sessão (R$)",
  workingCapital: "Capital de giro",
  monthlyGrowthRate: "Crescimento mensal",
  horizonMonths: "Prazo (meses)",
  discountRateAnnual: "Taxa de desconto a.a.",
  gridLimitKw: "Limite de conexão (kW)",
  "terms.version": "Versão do modelo comercial",
  "terms.modelKey": "Modelo comercial",
};
