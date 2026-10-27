/**
 * Cenários de utilização. As horas equivalentes/dia reproduzem as premissas do portfólio
 * comercial (slides 8 e 10). São hipóteses, não medições.
 */
export const SCENARIOS = [
  { key: "conservador", label: "Conservador", hours: 4 },
  { key: "base", label: "Base", hours: 8 },
  { key: "otimista", label: "Otimista", hours: 12 },
] as const;
export type ScenarioKey = (typeof SCENARIOS)[number]["key"] | "personalizado";
