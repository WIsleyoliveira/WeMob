import { Field, Input, Select, Textarea } from "@/components/ui/field";

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
        <Field label="Royalty (%)" htmlFor="royaltyRate" required><Input id="royaltyRate" name="royaltyRate" type="number" step="0.01" min="0" max="100" required /></Field>
        <Field label="Base do royalty" htmlFor="royaltyBase" required><Select id="royaltyBase" name="royaltyBase"><option value="GROSS_REVENUE">Receita bruta</option><option value="NET_REVENUE">Receita líquida</option></Select></Field>
        <Field label="Taxa de sistema (%)" htmlFor="platformFeeRate" required hint="Sobre o bruto; já inclui o gateway."><Input id="platformFeeRate" name="platformFeeRate" type="number" step="0.01" min="0" max="100" required /></Field>
        <Field label="Participação do parceiro (%)" htmlFor="partnerShareRate" required><Input id="partnerShareRate" name="partnerShareRate" type="number" step="0.01" min="0" max="100" required /></Field>
        <Field label="Base do repasse" htmlFor="partnerShareBase" required><Select id="partnerShareBase" name="partnerShareBase" defaultValue="OPERATING_RESULT"><option value="OPERATING_RESULT">Resultado operacional</option><option value="NET_REVENUE">Receita líquida</option><option value="GROSS_REVENUE">Receita bruta</option></Select></Field>
        <Field label="Prejuízo" htmlFor="lossTreatment" required><Select id="lossTreatment" name="lossTreatment"><option value="SHARE_MONTHLY">Rateado no mês (parceiro aporta)</option><option value="CARRY_FORWARD">Compensado nos meses seguintes</option></Select></Field>
        <Field label="Prazo de pagamento do repasse (dias)" htmlFor="paymentTermDays"><Input id="paymentTermDays" name="paymentTermDays" type="number" min="0" max="120" defaultValue={10} /></Field>
      </div>
      <Field label="Condições (texto contratual)" htmlFor="conditions" required><Textarea id="conditions" name="conditions" required minLength={5} maxLength={5000} /></Field>
      <Field label={reasonLabel} htmlFor="reason" required><Input id="reason" name="reason" required minLength={5} maxLength={500} /></Field>
    </>
  );
}
