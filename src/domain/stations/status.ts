/**
 * Regras de status sem I/O. Princípio: ausência de comunicação NÃO é disponibilidade.
 */
export type ConnectorStatus =
  | "AVAILABLE" | "PREPARING" | "CHARGING" | "SUSPENDED_EVSE" | "SUSPENDED_EV" | "FINISHING" | "RESERVED" | "UNAVAILABLE" | "FAULTED" | "UNKNOWN";

export const STATUS_LABEL: Record<ConnectorStatus, string> = {
  AVAILABLE: "Disponível",
  PREPARING: "Preparando",
  CHARGING: "Carregando",
  SUSPENDED_EVSE: "Suspenso (carregador)",
  SUSPENDED_EV: "Suspenso (veículo)",
  FINISHING: "Finalizando",
  RESERVED: "Reservado",
  UNAVAILABLE: "Indisponível",
  FAULTED: "Em falha",
  UNKNOWN: "Sem comunicação / desconhecido",
};

export const OCCUPIED: ConnectorStatus[] = ["PREPARING", "CHARGING", "SUSPENDED_EVSE", "SUSPENDED_EV", "FINISHING"];
export const OUT_OF_SERVICE: ConnectorStatus[] = ["UNAVAILABLE", "FAULTED", "UNKNOWN"];

/** Margem além de 2 × heartbeat antes de considerar a estação sem comunicação. */
export const STALE_GRACE_MS = 60_000;

export function isStationFresh(s: { connectionState: string; lastSeenAt: Date | null; heartbeatInterval: number }, now = new Date()) {
  if (s.connectionState !== "CONNECTED" || !s.lastSeenAt) return false;
  return now.getTime() - s.lastSeenAt.getTime() <= 2 * s.heartbeatInterval * 1000 + STALE_GRACE_MS;
}

/** Status exibido: o último reportado só vale se a estação estiver comunicando; caso contrário, UNKNOWN. */
export function effectiveStatus(
  connector: { status: ConnectorStatus },
  station: { connectionState: string; lastSeenAt: Date | null; heartbeatInterval: number },
  now = new Date(),
): { status: ConnectorStatus; stale: boolean } {
  if (!isStationFresh(station, now)) return { status: "UNKNOWN", stale: true };
  return { status: connector.status, stale: false };
}

/**
 * Utilização e disponibilidade de um conector num período a partir dos eventos de status aplicados.
 * - utilização = tempo em estados de ocupação ÷ período
 * - disponibilidade = tempo fora de UNAVAILABLE/FAULTED/UNKNOWN ÷ período
 * Antes do primeiro evento conhecido o tempo conta como UNKNOWN (sem evidência).
 */
export function connectorTimeShares(
  events: { status: ConnectorStatus; at: Date }[],
  from: Date,
  to: Date,
  statusBefore: ConnectorStatus = "UNKNOWN",
) {
  const total = to.getTime() - from.getTime();
  if (total <= 0) return { utilization: 0, availability: 0, unknownShare: 1 };
  const sorted = events.filter((e) => e.at > from && e.at < to).sort((a, b) => a.at.getTime() - b.at.getTime());
  let cur = statusBefore;
  let t = from.getTime();
  let occ = 0;
  let avail = 0;
  let unknown = 0;
  const acc = (until: number) => {
    const d = until - t;
    if (OCCUPIED.includes(cur)) occ += d;
    if (!OUT_OF_SERVICE.includes(cur)) avail += d;
    if (cur === "UNKNOWN") unknown += d;
    t = until;
  };
  for (const e of sorted) {
    acc(e.at.getTime());
    cur = e.status;
  }
  acc(to.getTime());
  return { utilization: occ / total, availability: avail / total, unknownShare: unknown / total };
}
