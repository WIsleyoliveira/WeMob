import { Badge } from "@/components/ui/badge";
import { SLA_STATE_LABEL, type SlaState } from "@/domain/support/sla";

const TONE: Record<SlaState, "green" | "amber" | "red" | "neutral"> = { OK: "green", MET: "green", AT_RISK: "amber", BREACHED: "red", NO_SLA: "neutral" };
const fmt = (m: number) => (m >= 120 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m)} min`);

export function SlaBadge({ label, s }: { label: string; s: { target: number | null; elapsed: number; state: SlaState } }) {
  return <Badge tone={TONE[s.state]} title={s.target ? `${fmt(s.elapsed)} de ${fmt(s.target)}` : undefined}>{label}: {SLA_STATE_LABEL[s.state]}{s.target ? ` (${fmt(s.elapsed)}/${fmt(s.target)})` : ""}</Badge>;
}
