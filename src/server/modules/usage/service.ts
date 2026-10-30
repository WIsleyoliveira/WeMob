import Decimal from "decimal.js";
import type { StationEnvironment } from "@prisma/client";
import { db } from "@/server/db";
import { requirePermission, type AuthContext } from "@/server/auth/context";
import { sessionEnergyWh, stationScope } from "@/server/modules/stations/service";
import { granularityFor, usageSeries, usageTotals, type UsageSession } from "@/domain/usage/series";

/**
 * Uso da rede por período para o painel da equipe (sessões CONCLUÍDAS, no escopo da organização — parceiro vê só
 * as próprias unidades). Só estações de produção por padrão; teste/simulação apenas quando solicitado (a tela
 * identifica). Dinheiro só com payment:read e só o CONFIRMADO pelo gateway (capturado − estornado).
 */
export async function networkUsage(ctx: AuthContext | null, raw: { from: Date; to: Date; includeNonProduction?: boolean }) {
  requirePermission(ctx, "site:read");
  const canSeeMoney = ctx.permissions.has("payment:read");
  const envs: StationEnvironment[] = raw.includeNonProduction ? ["PRODUCTION", "TEST", "SIMULATED"] : ["PRODUCTION"];
  const rows = await db.chargingSession.findMany({
    where: { status: "COMPLETED", startedAt: { gte: raw.from, lte: raw.to }, environment: { in: envs }, station: stationScope(ctx), NOT: { stopReason: { startsWith: "AUTH_" } } },
    include: { payments: canSeeMoney ? { select: { status: true, amountCaptured: true, amountRefunded: true } } : false, station: { select: { ocppIdentity: true, site: { select: { name: true } } } } },
    orderBy: { startedAt: "asc" },
  });
  const sessions: (UsageSession & { site: string })[] = rows.map((r) => {
    const pays = ("payments" in r ? (r.payments as { status: string; amountCaptured: Decimal.Value; amountRefunded: Decimal.Value }[]) : []).filter((p) => ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
    return {
      site: r.station.site.name,
      startedAt: r.startedAt,
      stoppedAt: r.stoppedAt,
      energyWh: sessionEnergyWh(r),
      paidConfirmed: canSeeMoney && pays.length ? pays.reduce((a, p) => a.plus(p.amountCaptured.toString()).minus(p.amountRefunded.toString()), new Decimal(0)).toFixed(2) : null,
    };
  });
  const bySite = new Map<string, { kwh: number; sessions: number }>();
  for (const x of sessions) {
    const b = bySite.get(x.site) ?? { kwh: 0, sessions: 0 };
    b.kwh += x.energyWh / 1000;
    b.sessions += 1;
    bySite.set(x.site, b);
  }
  const granularity = granularityFor(raw.from, raw.to);
  return {
    canSeeMoney,
    environments: envs,
    granularity,
    totals: usageTotals(sessions),
    series: usageSeries(sessions, raw.from, raw.to, granularity),
    bySite: [...bySite.entries()].map(([site, v]) => ({ site, kwh: Math.round(v.kwh * 1000) / 1000, sessions: v.sessions })).sort((a, b) => b.kwh - a.kwh).slice(0, 10),
  };
}
