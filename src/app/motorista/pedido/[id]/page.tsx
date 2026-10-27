import { notFound, redirect } from "next/navigation";
import { getMyChargeRequest } from "@/server/drivers/service";
import { requireDriverPage } from "@/server/drivers/current";
import { cancelChargeAction } from "@/app/actions/driver";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm } from "@/components/app/action-form";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { PAYMENT_STATUS_LABEL } from "@/server/payments/service";

export const dynamic = "force-dynamic";

const STEP = { AWAITING_PAYMENT: "Aguardando confirmação do pagamento", START_REQUESTED: "Aguardando o carregador iniciar", STARTED: "Recarga iniciada", FAILED: "Não foi possível iniciar", CANCELLED: "Pedido cancelado" } as const;

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const driver = await requireDriverPage();
  const { id } = await params;
  const r = await getMyChargeRequest(driver, id);
  if (!r) notFound();
  if (r.sessionId) redirect(`/motorista/recarga/${r.sessionId}`);
  const waiting = ["AWAITING_PAYMENT", "START_REQUESTED"].includes(r.status);
  return (
    <>
      {waiting && <AutoRefresh ms={3000} />}
      <h1 className="font-display text-xl font-semibold text-navy-900">{STEP[r.status]}</h1>
      {r.demo && <Alert tone="warning" className="mt-3">Demonstração: sem cobrança.</Alert>}
      {waiting && <p className="mt-2 text-sm text-navy-600" role="status">Esta página se atualiza sozinha. Mantenha o cabo conectado.</p>}
      {r.failure && <Alert tone="danger" className="mt-3">{r.failure}</Alert>}
      {r.payment && <p className="mt-3 text-sm">Pagamento: <b>{PAYMENT_STATUS_LABEL[r.payment.status]}</b> (confirmado pelo provedor)</p>}
      <div className="mt-6 flex flex-col gap-3">
        {waiting && <ActionForm action={cancelChargeAction} submitLabel="Cancelar pedido" variant="secondary"><input type="hidden" name="requestId" value={r.id} /></ActionForm>}
        {!waiting && <ButtonLink href="/motorista" variant="secondary">Voltar às estações</ButtonLink>}
      </div>
    </>
  );
}
