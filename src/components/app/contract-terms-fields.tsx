import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { GATEWAY_FEE_BEARER_LABEL, type GatewayFeeBearer } from "@/domain/finance/settlement";
import { OFFICIAL_REVENUE_SHARE } from "@/domain/commercial/reference";

/** Campos das condições contratuais (percentuais na tela; o servidor recebe frações). */
export function ContractTermsFields({ modelVersions, reasonLabel = "Motivo" }: { modelVersions: { id: string; version: number; model: { name: string } }[]; reasonLabel?: string }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Início da vigência" htmlFor="effectiveFrom" required hint="Use o 1º dia de um mês."><Input id="effectiveFrom" name="effectiveFrom" type="date" required /></Field>
        <Field label="Término (opcional)" htmlFor="effectiveTo"><Input id="effectiveTo" name="effectiveTo" type="date" /></Field>
        <Field label="Premissa comercial de origem" htmlFor="commercialModelVersionId" hint="Referência; as condições abaixo é que valem.">
          <Select id="commercialModelVersionId" name="commercialModelVersionId"><option value="">—</option>{modelVersions.map((m) => <option key={m.id} value={m.id}>{m.model.name} v{m.version}</option>)}</Select>
        </Field>
        <Field label="Modelo" htmlFor="shareModel" required hint="Contratos novos usam a participação sobre o bruto.">
          <Select id="shareModel" name="shareModel" defaultValue="REVENUE_SHARE">
            <option value="REVENUE_SHARE">Participação sobre o faturamento bruto</option>
            <option value="LEGACY">Antigo: royalty + taxa de sistema (só contratos já existentes)</option>
          </Select>
        </Field>
        <Field label="Participação da WeMob (%)" htmlFor="revenueShareRate" hint={`Sobre o faturamento bruto elegível; o posto fica com o restante (regra oficial: ${OFFICIAL_REVENUE_SHARE.wemobPercent}% / ${100 - OFFICIAL_REVENUE_SHARE.wemobPercent}%).`}>
          <Input id="revenueShareRate" name="revenueShareRate" type="number" step="0.01" min="0.01" max="99.99" defaultValue={OFFICIAL_REVENUE_SHARE.wemobPercent} />
        </Field>
        <Field label="Tarifas do gateway (Asaas)" htmlFor="gatewayFeeBearer" hint="Enquanto “a definir”, o fechamento com tarifas não pode ser aprovado.">
          <Select id="gatewayFeeBearer" name="gatewayFeeBearer" defaultValue="PENDING_DECISION">
            {(Object.keys(GATEWAY_FEE_BEARER_LABEL) as GatewayFeeBearer[]).map((k) => <option key={k} value={k}>{GATEWAY_FEE_BEARER_LABEL[k]}</option>)}
          </Select>
        </Field>
        <Field label="Prazo de pagamento do repasse (dias)" htmlFor="paymentTermDays"><Input id="paymentTermDays" name="paymentTermDays" type="number" min="0" max="120" defaultValue={10} /></Field>
      </div>
      <details className="rounded-lg border border-navy-100 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-navy-800">Campos do modelo antigo (royalty + taxa de sistema)</summary>
        <p className="mt-1 text-xs text-navy-500">Use só com o modelo “Antigo”, para registrar condições de contratos firmados antes da regra de participação. Ignorados no modelo de participação.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Royalty (%)" htmlFor="royaltyRate"><Input id="royaltyRate" name="royaltyRate" type="number" step="0.01" min="0" max="100" /></Field>
          <Field label="Base do royalty" htmlFor="royaltyBase"><Select id="royaltyBase" name="royaltyBase"><option value="GROSS_REVENUE">Receita bruta</option><option value="NET_REVENUE">Receita líquida</option></Select></Field>
          <Field label="Taxa de sistema (%)" htmlFor="platformFeeRate" hint="Sobre o bruto; já inclui o gateway."><Input id="platformFeeRate" name="platformFeeRate" type="number" step="0.01" min="0" max="100" /></Field>
          <Field label="Participação do parceiro (%)" htmlFor="partnerShareRate"><Input id="partnerShareRate" name="partnerShareRate" type="number" step="0.01" min="0" max="100" /></Field>
          <Field label="Base do repasse" htmlFor="partnerShareBase"><Select id="partnerShareBase" name="partnerShareBase" defaultValue=""><option value="">Selecione (decisão comercial: bruto × líquido × resultado)</option><option value="OPERATING_RESULT">Resultado operacional</option><option value="NET_REVENUE">Receita líquida</option><option value="GROSS_REVENUE">Receita bruta</option></Select></Field>
          <Field label="Prejuízo" htmlFor="lossTreatment"><Select id="lossTreatment" name="lossTreatment"><option value="SHARE_MONTHLY">Rateado no mês (parceiro aporta)</option><option value="CARRY_FORWARD">Compensado nos meses seguintes</option></Select></Field>
        </div>
      </details>
      <Field label="Condições (texto contratual)" htmlFor="conditions" required><Textarea id="conditions" name="conditions" required minLength={5} maxLength={5000} /></Field>
      <Field label={reasonLabel} htmlFor="reason" required><Input id="reason" name="reason" required minLength={5} maxLength={500} /></Field>
    </>
  );
}
