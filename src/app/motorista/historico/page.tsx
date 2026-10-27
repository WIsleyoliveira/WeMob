import Link from "next/link";
import { requireDriverPage } from "@/server/drivers/current";
import { listMySessions } from "@/server/drivers/service";
import { sessionEnergyWh } from "@/server/modules/stations/service";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { brl, dateTime, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function HistoricoPage() {
  const driver = await requireDriverPage("/motorista/historico");
  const sessions = await listMySessions(driver);
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">Minhas recargas</h1>
      <div className="mt-4 flex flex-col gap-3">
        {sessions.length === 0 ? <EmptyState title="Nenhuma recarga ainda" /> : sessions.map((s) => {
          const captured = s.payments.find((p) => ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
          return (
            <Link key={s.id} href={`/motorista/recarga/${s.id}`} className="rounded-xl border border-navy-100 bg-white p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-medium text-navy-900">{s.station.site.name}</p><p className="text-xs text-navy-500">{dateTime(s.startedAt)} · {num(sessionEnergyWh(s) / 1000, 2)} kWh</p></div>
                <div className="text-right">
                  <p className="tabular font-semibold">{s.amount ? brl(s.amount.toString()) : "—"}</p>
                  {s.environment === "SIMULATED" ? <Badge tone="amber">demonstração</Badge> : s.status !== "COMPLETED" ? <Badge tone="tiffany">em andamento</Badge> : captured ? <Badge tone="green">pago</Badge> : <Badge tone="amber">pagamento pendente</Badge>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
