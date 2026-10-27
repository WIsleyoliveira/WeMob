import Link from "next/link";
import { requirePage } from "@/server/auth/current";
import { pipelineSummary } from "@/server/modules/leads/service";
import { listSites } from "@/server/modules/sites/service";
import { listSimulations } from "@/server/modules/commercial/service";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/stat";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { num, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ negado?: string }> }) {
  const ctx = await requirePage();
  const sp = await searchParams;
  const [funnel, sites, sims] = await Promise.all([
    ctx.permissions.has("lead:read") ? pipelineSummary(ctx) : null,
    ctx.permissions.has("site:read") ? listSites(ctx) : null,
    ctx.permissions.has("simulation:read") ? listSimulations(ctx) : null,
  ]);
  const now = new Date();

  return (
    <>
      <PageHeader title={`Olá, ${ctx.userName.split(" ")[0]}`} description="Indicadores calculados somente a partir de dados registrados na plataforma." />
      {sp.negado && <Alert tone="danger" className="mb-6">Você não tem permissão para acessar aquela área.</Alert>}

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
            <CardHeader title="Funil por etapa" actions={<Link href="/app/crm" className="text-sm font-medium text-brand-700 hover:underline">Abrir CRM →</Link>} />
            <CardBody className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {funnel.stages.map((s) => (
                <Link key={s.id} href={`/app/crm?stageId=${s.id}&view=lista`} className="rounded-lg border border-navy-100 p-3 hover:border-navy-300">
                  <p className="truncate text-xs text-navy-500">{s.name}</p>
                  <p className="tabular font-display text-xl font-semibold">{s.count}</p>
                </Link>
              ))}
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
