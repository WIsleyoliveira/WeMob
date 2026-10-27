import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { pipelineSummary } from "@/server/modules/leads/service";
import { listSites } from "@/server/modules/sites/service";
import { listSimulations } from "@/server/modules/commercial/service";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { dateTime, num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const ctx = await requirePage();
  const [funnel, sites, sims] = await Promise.all([
    ctx.permissions.has("lead:read") ? pipelineSummary(ctx) : null,
    ctx.permissions.has("site:read") ? listSites(ctx) : null,
    ctx.permissions.has("simulation:read") ? listSimulations(ctx) : null,
  ]);
  const now = new Date();

  return (
    <>
      <PageHeader title={`Olá, ${ctx.userName.split(" ")[0]}`} description="Indicadores calculados somente a partir de dados registrados na plataforma." />

      {funnel && (
        <section className="mb-8">
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-navy-400">Comercial</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Leads em aberto" value={num(funnel.open)} definition="Leads que não estão em etapa de ganho ou perda." source="CRM (tabela Lead)" updatedAt={funnel.computedAt} />
            <Stat label="Novos leads (30 dias)" value={num(funnel.newLast30Days)} definition="Leads criados nos últimos 30 dias, de qualquer origem." source="CRM (Lead.createdAt)" updatedAt={funnel.computedAt} />
            <Stat label="Oportunidades paradas" value={num(funnel.stale)} definition="Leads em aberto sem mudança de etapa há mais de 7 dias." source="CRM (Lead.stageChangedAt)" updatedAt={funnel.computedAt} />
            <Stat label="Taxa de conversão" value={funnel.conversionRate === null ? "—" : pct(funnel.conversionRate)} definition="Ganhos ÷ (ganhos + perdidos). Sem negócios encerrados, não é calculada." source="CRM (etapas de ganho/perda)" updatedAt={funnel.computedAt} />
          </div>
          <Card className="mt-4">
            <CardHeader
              title="Leads por etapa do funil"
              description={`Quantidade atual de leads (unidade: leads) em cada etapa · todos os períodos · fonte: CRM · ${dateTime(funnel.computedAt)}`}
              actions={<Link href="/app/crm" className="text-sm font-medium text-brand-700 hover:underline">Abrir CRM →</Link>}
            />
            <CardBody>
              {funnel.total === 0 ? (
                <p className="text-sm text-navy-500">Nenhum lead registrado ainda.</p>
              ) : (
                <ul className="space-y-2.5">
                  {funnel.stages.map((s) => {
                    const max = Math.max(...funnel.stages.map((x) => x.count), 1);
                    return (
                      <li key={s.id}>
                        <Link href={`/app/crm?stageId=${s.id}&view=lista`} className="group grid grid-cols-[minmax(7rem,10rem)_1fr_3rem] items-center gap-3 text-sm">
                          <span className="truncate text-navy-700 group-hover:text-navy-900">{s.name}</span>
                          <span className="h-2.5 rounded-full bg-navy-50" aria-hidden>
                            <span className={`block h-full rounded-full ${s.isLost ? "bg-navy-300" : s.isWon ? "bg-brand-600" : "bg-tiffany-500"}`} style={{ width: `${(s.count / max) * 100}%` }} />
                          </span>
                          <span className="tabular text-right font-semibold text-navy-900">{s.count}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-wide text-navy-400">Operação e financeiro</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {sites && (
            <Stat label="Unidades em operação" value={num(sites.filter((s) => s.status === "OPERATING" && !s.isDemo).length)} definition="Unidades com status 'em operação', excluindo demonstrações." source="Cadastro de unidades" updatedAt={now} />
          )}
          {sims && <Stat label="Simulações salvas" value={num(sims.length)} definition="Simulações de viabilidade registradas pela organização (projeções)." source="Simulador" updatedAt={now} />}
        </div>
        <Alert tone="info" className="mt-4" title="Receita de recarga, energia vendida, sessões e pagamentos ainda não são exibidos">
          Esses indicadores dependem da integração com os carregadores (OCPP) e com o gateway de pagamento, previstas nas próximas fases. Nenhum número é mostrado até existirem dados reais.
        </Alert>
      </section>
    </>
  );
}
