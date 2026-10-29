import Link from "next/link";
import { requireDriverPage } from "@/server/drivers/current";
import { listMySessionStations, listMySessions } from "@/server/drivers/service";
import { sessionEnergyWh } from "@/server/modules/stations/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/field";
import { brl, dateTime, num } from "@/lib/format";
import { HISTORY_PERIODS, HISTORY_STATES, hasHistoryFilters, parseHistoryFilters } from "@/domain/charging/history";

export const dynamic = "force-dynamic";

export default async function HistoricoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const driver = await requireDriverPage("/motorista/historico");
  const filters = parseHistoryFilters(await searchParams);
  const [sessions, stations] = await Promise.all([listMySessions(driver, filters), listMySessionStations(driver)]);
  const filtered = hasHistoryFilters(filters);
  return (
    <>
      <h1 className="font-display text-xl font-semibold text-navy-900">Minhas recargas</h1>
      {(stations.length > 0 || filtered) && (
        <form method="get" action="/motorista/historico" className="mt-3 grid grid-cols-2 gap-3 rounded-xl border border-navy-100 bg-white p-3 text-sm" aria-label="Filtrar recargas">
          <label className="flex flex-col gap-1">
            <span className="font-medium text-navy-800">Período</span>
            <Select name="periodo" defaultValue={filters.periodo ?? ""} className="h-10">
              <option value="">Todo o histórico</option>
              {Object.entries(HISTORY_PERIODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium text-navy-800">Situação</span>
            <Select name="estado" defaultValue={filters.estado ?? ""} className="h-10">
              <option value="">Todas</option>
              {Object.entries(HISTORY_STATES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="font-medium text-navy-800">Estação</span>
            <Select name="estacao" defaultValue={filters.estacao ?? ""} className="h-10">
              <option value="">Todas as estações</option>
              {stations.map((s) => <option key={s.identity} value={s.identity}>{s.name} ({s.identity})</option>)}
            </Select>
          </label>
          <div className="col-span-2 flex gap-2">
            <Button type="submit" size="sm">Filtrar</Button>
            {filtered && <Link href="/motorista/historico" className="inline-flex h-8 items-center px-2 text-sm font-medium text-navy-600 underline">Limpar filtros</Link>}
          </div>
        </form>
      )}
      {filtered && <p className="mt-3 text-sm text-navy-600" role="status">{sessions.length === 1 ? "1 recarga encontrada" : `${sessions.length} recargas encontradas`}</p>}
      <ul className="mt-3 flex flex-col gap-3" aria-label="Recargas">
        {sessions.length === 0 ? (
          <li><EmptyState title={filtered ? "Nenhuma recarga com esses filtros" : "Nenhuma recarga ainda"} /></li>
        ) : (
          sessions.map((s) => {
            const captured = s.payments.find((p) => ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status));
            const done = s.status === "COMPLETED";
            return (
              <li key={s.id} className="rounded-xl border border-navy-100 bg-white p-4">
                <Link href={`/motorista/recarga/${s.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-navy-900">{s.station.site.name}</p>
                      <p className="text-xs text-navy-500">{dateTime(s.startedAt)} · conector {s.connectorId} · {num(sessionEnergyWh(s) / 1000, 2)} kWh</p>
                      <p className="text-xs text-navy-500">Transação {s.transactionId}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular font-semibold">{s.amount ? brl(s.amount.toString()) : "—"}</p>
                      {s.environment === "SIMULATED" ? <Badge tone="amber">demonstração</Badge> : s.status === "COMMUNICATION_LOST" ? <Badge tone="amber">sem comunicação</Badge> : !done ? <Badge tone="tiffany">em andamento</Badge> : captured ? <Badge tone="green">pago</Badge> : <Badge tone="amber">pagamento pendente</Badge>}
                    </div>
                  </div>
                </Link>
                <div className="mt-2 flex gap-4 border-t border-navy-100 pt-2 text-xs font-medium">
                  {done && <Link href={`/motorista/recibo/${s.id}`} className="text-brand-700 underline">Recibo</Link>}
                  <Link href={`/motorista/ajuda?sessao=${s.id}`} className="text-navy-600 underline">Problema com esta recarga?</Link>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </>
  );
}
