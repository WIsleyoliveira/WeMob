/** Formato de exposição do Prometheus (texto), regra pura. Só números agregados — nunca dado pessoal. */
export interface Metric {
  name: string;
  help: string;
  type: "gauge" | "counter";
  samples: { labels?: Record<string, string>; value: number }[];
}

const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const escapeLabel = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

export function renderMetrics(metrics: Metric[]): string {
  const out: string[] = [];
  for (const m of metrics) {
    if (!NAME.test(m.name)) throw new Error(`Nome de métrica inválido: ${m.name}`);
    out.push(`# HELP ${m.name} ${m.help.replace(/\n/g, " ")}`, `# TYPE ${m.name} ${m.type}`);
    for (const s of m.samples) {
      const labels = s.labels && Object.keys(s.labels).length ? `{${Object.entries(s.labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`).join(",")}}` : "";
      out.push(`${m.name}${labels} ${Number.isFinite(s.value) ? s.value : "NaN"}`);
    }
  }
  return out.join("\n") + "\n";
}
