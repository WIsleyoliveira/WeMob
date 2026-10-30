import Link from "next/link";
import { requireDriverPage } from "@/server/drivers/current";
import { myUsage } from "@/server/drivers/service";
import { BarChart } from "@/components/ui/bar-chart";
import { Alert } from "@/components/ui/alert";
import { brl, dateTime, num } from "@/lib/format";
import { cn } from "@/lib/cn";
import { USAGE_PERIODS, parseUsagePeriod } from "@/domain/usage/series";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meu consumo" };

const kwhFmt = (v: number) => `${num(v, v < 10 ? 2 : 1)} kWh`;
const minFmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

export default async function ConsumoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const driver = await requireDriverPage("/motorista/consumo");
  const params = await searchParams;
  const period = parseUsagePeriod(params.periodo);
  const includeTest = params.dados === "teste";
  const u = await myUsage(driver, { period, includeTest });
  const periodLabel = USAGE_PERIODS[period].toLowerCase();
  const href = (p: string, teste = includeTest) => `/motorista/consumo?periodo=${p}${teste ? "&dados=teste" : ""}`;
  const t = u.totals;
  const unitBucket = u.granularity === "day" ? "por dia" : u.granularity === "week" ? "por semana" : "por mês";
  const kpis = [
    { label: "Energia recebida", value: kwhFmt(t.kwh), hint: "medida pelo carregador" },
    { label: "Valor pago", value: brl(t.paid), hint: "confirmado pelo pagamento, já descontadas devoluções" },
    { label: "Recargas", value: num(t.sessions), hint: "concluídas" },
    { label: "Tempo carregando", value: minFmt(t.minutes), hint: "soma das recargas" },
    { label: "Média por recarga", value: t.avgKwh === null ? "—" : kwhFmt(t.avgKwh), hint: t.avgMinutes === null ? "sem recargas no período" : `${minFmt(t.avgMinutes)} em média` },
  ];
  return (
    <>
      <h1 className="font-display text-2xl font-semibold text-navy-900">Meu consumo</h1>
      <p className="mt-1 text-sm text-navy-600">Suas recargas concluídas, com energia medida pelo carregador e valores confirmados pelo pagamento.</p>

      <nav aria-label="Período" className="mt-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {Object.entries(USAGE_PERIODS).map(([k, l]) => (
          <Link key={k} href={href(k)} aria-current={period === k ? "page" : undefined} className={cn("shrink-0 rounded-full border px-3.5 py-2 text-sm font-medium", period === k ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-700 hover:border-navy-300")}>
            {l}
          </Link>
        ))}
      </nav>

      {u.includeTest ? (
        <Alert tone="warning" className="mt-3" title="Incluindo recargas de teste e demonstração">
          Valores de estações de teste ou simuladas não são cobranças reais. <Link className="underline" href={href(period, false)}>Ver só recargas reais</Link>
        </Alert>
      ) : (
        u.otherEnvSessions > 0 && (
          <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-sm text-navy-700">
            {u.otherEnvSessions === 1 ? "1 recarga de teste ou demonstração" : `${u.otherEnvSessions} recargas de teste ou demonstração`} neste período não {u.otherEnvSessions === 1 ? "entra" : "entram"} nos números.{" "}
            <Link className="font-medium underline" href={href(period, true)}>Incluir</Link>
          </p>
        )
      )}

      <section aria-label={`Resumo — ${periodLabel}`} className="mt-4 grid grid-cols-2 gap-3">
        {kpis.map((k, i) => (
          <div key={k.label} className={cn("rounded-[var(--radius-card)] border border-navy-100 bg-white p-4 shadow-[var(--shadow-card)]", i === 0 && "col-span-2")}>
            <p className="text-sm text-navy-600">{k.label}</p>
            <p className={cn("tabular font-display font-semibold text-navy-900", i === 0 ? "text-3xl" : "text-xl")}>{k.value}</p>
            <p className="mt-0.5 text-xs text-navy-500">{k.hint}</p>
          </div>
        ))}
      </section>
      {t.unconfirmedPayments > 0 && (
        <p className="mt-2 text-xs text-navy-600">{t.unconfirmedPayments === 1 ? "1 recarga ainda sem pagamento confirmado" : `${t.unconfirmedPayments} recargas ainda sem pagamento confirmado`} — {t.unconfirmedPayments === 1 ? "ela não entra" : "elas não entram"} no valor pago.</p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <BarChart title="Energia recebida" unit={`kWh ${unitBucket}`} period={periodLabel} data={u.series.map((p) => ({ key: p.key, label: p.label, value: p.kwh }))} format={kwhFmt} emptyText="Nenhuma recarga concluída neste período. Quando você carregar, a energia de cada recarga aparece aqui." />
        <BarChart title="Valor pago" unit={`R$ ${unitBucket}`} period={periodLabel} tone="navy" data={u.series.map((p) => ({ key: p.key, label: p.label, value: Number(p.paid) }))} format={(v) => brl(v)} emptyText="Nenhum pagamento confirmado neste período." />
        <BarChart title="Recargas" unit={`quantidade ${unitBucket}`} period={periodLabel} tone="tiffany" data={u.series.map((p) => ({ key: p.key, label: p.label, value: p.sessions }))} format={(v) => num(v)} emptyText="Nenhuma recarga concluída neste período." />
      </div>

      <p className="mt-4 text-sm">
        <Link href="/motorista/historico" className="font-medium text-brand-700 underline">Ver recargas e recibos</Link>
      </p>
      <p className="mt-2 text-xs text-navy-500">Atualizado em {dateTime(u.computedAt)}. Período: {dateTime(u.from)} a {dateTime(u.to)}.</p>
    </>
  );
}
