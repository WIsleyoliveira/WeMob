import { Badge } from "@/components/ui/badge";
import { STATUS_LABEL, type ConnectorStatus } from "@/domain/stations/status";

const TONE: Record<ConnectorStatus, "green" | "tiffany" | "amber" | "red" | "neutral"> = {
  AVAILABLE: "green", PREPARING: "tiffany", CHARGING: "tiffany", SUSPENDED_EVSE: "amber", SUSPENDED_EV: "amber",
  FINISHING: "tiffany", RESERVED: "amber", UNAVAILABLE: "neutral", FAULTED: "red", UNKNOWN: "neutral",
};

export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

const ENV = { PRODUCTION: ["Produção", "navy"], TEST: ["Teste", "amber"], SIMULATED: ["Simulado", "amber"] } as const;
export function EnvironmentBadge({ env }: { env: keyof typeof ENV }) {
  return <Badge tone={ENV[env][1]}>{ENV[env][0]}</Badge>;
}

export function ConnectionBadge({ fresh, state }: { fresh: boolean; state: string }) {
  if (state === "NEVER_CONNECTED") return <Badge>Nunca conectou</Badge>;
  return fresh ? <Badge tone="green">Comunicando</Badge> : <Badge tone="red">Sem comunicação</Badge>;
}
