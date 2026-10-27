"use client";

import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { ZodError } from "zod";
import { DEFAULT_DAYS_PER_MONTH, runViability, type ParsedViabilityInput, type ViabilityInput } from "@/domain/viability/engine";
import { SCENARIOS, type ScenarioKey } from "@/domain/viability/scenarios";
import { FEE_BASE_LABEL, LOSS_TREATMENT_LABEL, type CommercialTerms } from "@/domain/commercial/types";
import { Field, Input } from "@/components/ui/field";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/format";
import { SimulatorResults } from "./simulator-results";

export interface SimulatorModel {
  versionId?: string;
  status?: string;
  terms: CommercialTerms;
}

interface FormState {
  chargers: { count: string; powerKw: string }[];
  gridLimitKw: string;
  availabilityPct: string;
  efficiencyPct: string;
  hours: string;
  days: string;
  growthPct: string;
  horizon: string;
  price: string;
  energyCost: string;
  commissionPct: string;
  fixed: Record<"demandCharge" | "connectivity" | "software" | "rent" | "maintenance" | "other", string>;
  invest: Record<"projectAndImplementation" | "equipment" | "works" | "other", string>;
  discountPct: string;
  utilMode: "HOURS" | "OCCUPANCY";
  occupancyPct: string;
  powerFactorPct: string;
  kwhPerSession: string;
  gatewayPct: string;
  gatewayFixed: string;
  workingCapital: string;
  recoverWc: boolean;
}

const toNum = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));

function initialState(terms: CommercialTerms): FormState {
  return {
    chargers: [{ count: "1", powerKw: "60" }],
    gridLimitKw: "",
    availabilityPct: "95",
    efficiencyPct: "100",
    hours: "8",
    days: DEFAULT_DAYS_PER_MONTH.toFixed(2),
    growthPct: "0",
    horizon: "60",
    price: "2.40",
    energyCost: "0.96",
    commissionPct: "0",
    fixed: { demandCharge: "0", connectivity: "150", software: "0", rent: "0", maintenance: "0", other: "0" },
    invest: { projectAndImplementation: String(terms.referenceInvestment), equipment: "0", works: "0", other: "0" },
    discountPct: "",
    utilMode: "HOURS",
    occupancyPct: "25",
    powerFactorPct: "100",
    kwhPerSession: "",
    gatewayPct: "0",
    gatewayFixed: "0",
    workingCapital: "0",
    recoverWc: true,
  };
}

/** Reconstrói o formulário a partir de premissas salvas (para criar uma revisão). */
export function fromEngineInput(i: ParsedViabilityInput): FormState {
  const str = (v: number | undefined | null, mul = 1) => (v === undefined || v === null ? "" : String(+(v * mul).toFixed(6)));
  return {
    chargers: i.chargers.map((c) => ({ count: String(c.count), powerKw: String(c.powerKw) })),
    gridLimitKw: str(i.gridLimitKw),
    availabilityPct: str(i.availability, 100),
    efficiencyPct: str(i.chargingEfficiency, 100),
    hours: str(i.equivalentHoursPerDay ?? 8),
    days: str(i.daysPerMonth),
    growthPct: str(i.monthlyGrowthRate, 100),
    horizon: String(i.horizonMonths),
    price: str(i.pricePerKwh),
    energyCost: str(i.energyCostPerKwh),
    commissionPct: str(i.commissionRate, 100),
    fixed: Object.fromEntries(Object.entries(i.fixedMonthly).map(([k, v]) => [k, str(v)])) as FormState["fixed"],
    invest: Object.fromEntries(Object.entries(i.investment).map(([k, v]) => [k, str(v)])) as FormState["invest"],
    discountPct: str(i.discountRateAnnual, 100),
    utilMode: i.occupancyRate !== undefined ? "OCCUPANCY" : "HOURS",
    occupancyPct: str(i.occupancyRate ?? 0.25, 100),
    powerFactorPct: str(i.averagePowerFactor, 100),
    kwhPerSession: str(i.kwhPerSession),
    gatewayPct: str(i.gatewayRate, 100),
    gatewayFixed: str(i.gatewayFixedPerSession),
    workingCapital: str(i.workingCapital),
    recoverWc: i.recoverWorkingCapital,
  };
}

export function toEngineInput(f: FormState, terms: CommercialTerms, hoursOverride?: number): ViabilityInput {
  const fixed = Object.fromEntries(Object.entries(f.fixed).map(([k, v]) => [k, toNum(v) ?? 0]));
  const investment = Object.fromEntries(Object.entries(f.invest).map(([k, v]) => [k, toNum(v) ?? 0]));
  return {
    chargers: f.chargers.map((c) => ({ count: toNum(c.count) as number, powerKw: toNum(c.powerKw) as number })),
    gridLimitKw: toNum(f.gridLimitKw),
    availability: (toNum(f.availabilityPct) ?? 0) / 100,
    chargingEfficiency: (toNum(f.efficiencyPct) ?? 100) / 100,
    ...(hoursOverride !== undefined || f.utilMode === "HOURS"
      ? { equivalentHoursPerDay: hoursOverride ?? (toNum(f.hours) as number) }
      : { occupancyRate: (toNum(f.occupancyPct) ?? 0) / 100, averagePowerFactor: (toNum(f.powerFactorPct) ?? 100) / 100 }),
    kwhPerSession: toNum(f.kwhPerSession),
    gatewayRate: terms.platformFeeIncludesGateway ? 0 : (toNum(f.gatewayPct) ?? 0) / 100,
    gatewayFixedPerSession: terms.platformFeeIncludesGateway ? 0 : toNum(f.gatewayFixed) ?? 0,
    workingCapital: toNum(f.workingCapital) ?? 0,
    recoverWorkingCapital: f.recoverWc,
    daysPerMonth: toNum(f.days) as number,
    monthlyGrowthRate: (toNum(f.growthPct) ?? 0) / 100,
    horizonMonths: toNum(f.horizon) as number,
    pricePerKwh: toNum(f.price) as number,
    energyCostPerKwh: toNum(f.energyCost) as number,
    commissionRate: (toNum(f.commissionPct) ?? 0) / 100,
    fixedMonthly: fixed,
    investment,
    discountRateAnnual: f.discountPct.trim() === "" ? undefined : (toNum(f.discountPct) as number) / 100,
    terms,
  };
}

const FIXED_LABELS: Record<keyof FormState["fixed"], string> = {
  demandCharge: "Demanda contratada / tarifas fixas",
  connectivity: "Internet e conectividade",
  software: "Software (fora da taxa de sistema)",
  rent: "Aluguel ou custo do espaço",
  maintenance: "Manutenção",
  other: "Outros custos fixos",
};
const INVEST_LABELS: Record<keyof FormState["invest"], string> = {
  projectAndImplementation: "Projeto e implantação (taxa de franquia)",
  equipment: "Equipamentos adicionais",
  works: "Obras / adequações elétricas",
  other: "Outros investimentos",
};

export function Simulator({
  models,
  mode,
  onSave,
  initial,
}: {
  models: SimulatorModel[];
  mode: "public" | "app";
  onSave?: (payload: { name: string; versionId: string; input: Record<string, unknown> }) => Promise<{ status: string; message?: string; data?: { id: string } }>;
  /** Premissas de uma simulação salva, para criar revisão. */
  initial?: { input: ParsedViabilityInput; versionId?: string; name?: string };
}) {
  const [modelIdx, setModelIdx] = useState(() => Math.max(0, models.findIndex((m) => initial?.versionId && m.versionId === initial.versionId)));
  const model = models[modelIdx];
  const [form, setForm] = useState<FormState>(() => (initial ? fromEngineInput(initial.input) : initialState(model.terms)));
  const [scenario, setScenario] = useState<ScenarioKey>("base");
  const [saveName, setSaveName] = useState(initial?.name ?? "");
  const [saveMsg, setSaveMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const deferred = useDeferredValue(form);
  const computed = useMemo(() => {
    try {
      const result = runViability(toEngineInput(deferred, model.terms));
      const scenarios = SCENARIOS.map((s) => ({ ...s, result: runViability(toEngineInput(deferred, model.terms, s.hours), { sensitivity: false }) }));
      const modelsCmp = models.map((m) => ({ terms: m.terms, result: runViability(toEngineInput({ ...deferred, invest: { ...deferred.invest, projectAndImplementation: String(m.terms.referenceInvestment) } }, m.terms), { sensitivity: false }) }));
      return { ok: true as const, result, scenarios, modelsCmp };
    } catch (e) {
      if (e instanceof ZodError) return { ok: false as const, issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
      return { ok: false as const, issues: [e instanceof Error ? e.message : "Erro de cálculo"] };
    }
  }, [deferred, model, models]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const chooseModel = (idx: number) => {
    setModelIdx(idx);
    setForm((f) => ({ ...f, invest: { ...f.invest, projectAndImplementation: String(models[idx].terms.referenceInvestment) } }));
  };
  const chooseScenario = (key: ScenarioKey) => {
    setScenario(key);
    const s = SCENARIOS.find((x) => x.key === key);
    if (s) setForm((f) => ({ ...f, utilMode: "HOURS", hours: String(s.hours) }));
  };

  const t = model.terms;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(320px,400px)_1fr]">
      <form className="flex flex-col gap-5" onSubmit={(e) => e.preventDefault()} aria-label="Premissas da simulação">
        <Section title="1. Modelo comercial">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {models.map((m, i) => (
              <button
                key={m.terms.modelKey + (m.versionId ?? "")}
                type="button"
                onClick={() => chooseModel(i)}
                aria-pressed={i === modelIdx}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  i === modelIdx ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-navy-200 bg-white hover:border-navy-300",
                )}
              >
                <span className="block font-semibold text-navy-900">{m.terms.modelName}</span>
                <span className="text-xs text-navy-500">
                  {m.terms.version ? `v${m.terms.version}` : "referência"} {m.status === "DRAFT" && <Badge tone="amber">rascunho</Badge>}
                </span>
              </button>
            ))}
          </div>
          <ul className="mt-3 space-y-1 rounded-lg bg-navy-50 p-3 text-xs text-navy-600">
            <li>Aporte do investidor: <b>{pct(t.partnerCapitalShare, 0)}</b> do investimento · Resultado: <b>{pct(t.partnerResultShare, 0)}</b></li>
            <li>Royalty: <b>{pct(t.royaltyRate)}</b> sobre {FEE_BASE_LABEL[t.royaltyBase].toLowerCase()}</li>
            <li>Taxa de sistema + gateway: <b>{pct(t.platformFeeRate)}</b> sobre {FEE_BASE_LABEL[t.platformFeeBase].toLowerCase()}</li>
            <li>Tributos estimados: <b>{pct(t.taxRate)}</b> sobre {FEE_BASE_LABEL[t.taxBase].toLowerCase()}</li>
            <li>Gateway: {t.platformFeeIncludesGateway ? "incluso na taxa de sistema" : "cobrado à parte"} · Prejuízo: {LOSS_TREATMENT_LABEL[t.lossTreatment].toLowerCase()}</li>
          </ul>
        </Section>

        <Section title="2. Equipamentos e capacidade">
          {form.chargers.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label="Quantidade" htmlFor={`count-${i}`}>
                <Input id={`count-${i}`} inputMode="numeric" value={c.count} onChange={(e) => set("chargers", form.chargers.map((x, j) => (j === i ? { ...x, count: e.target.value } : x)))} />
              </Field>
              <Field label="Potência (kW)" htmlFor={`power-${i}`}>
                <Input id={`power-${i}`} inputMode="decimal" value={c.powerKw} onChange={(e) => set("chargers", form.chargers.map((x, j) => (j === i ? { ...x, powerKw: e.target.value } : x)))} />
              </Field>
              <Button type="button" variant="ghost" size="md" aria-label="Remover carregador" disabled={form.chargers.length === 1} onClick={() => set("chargers", form.chargers.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={() => set("chargers", [...form.chargers, { count: "1", powerKw: "22" }])}>
            + Adicionar tipo de carregador
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Limite da conexão (kW)" htmlFor="grid" hint="Opcional. Limita a potência simultânea.">
              <Input id="grid" inputMode="decimal" value={form.gridLimitKw} onChange={(e) => set("gridLimitKw", e.target.value)} />
            </Field>
            <Field label="Disponibilidade (%)" htmlFor="avail" hint="Tempo operacional dos equipamentos.">
              <Input id="avail" inputMode="decimal" value={form.availabilityPct} onChange={(e) => set("availabilityPct", e.target.value)} />
            </Field>
            <Field label="Eficiência de recarga (%)" htmlFor="eff" hint="Perdas entre a compra e a venda de energia.">
              <Input id="eff" inputMode="decimal" value={form.efficiencyPct} onChange={(e) => set("efficiencyPct", e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="3. Utilização">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Cenário">
            {[...SCENARIOS, { key: "personalizado" as const, label: "Personalizado", hours: null }].map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={scenario === s.key}
                onClick={() => chooseScenario(s.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  scenario === s.key ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-700 hover:border-navy-300",
                )}
              >
                {s.label}
                {s.hours !== null && <span className="ml-1 opacity-70">{s.hours} h</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Forma de informar a utilização">
            {([["HOURS", "Horas equivalentes"], ["OCCUPANCY", "Ocupação dos conectores"]] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="radio" name="utilMode" className="accent-brand-600" checked={form.utilMode === v} onChange={() => { set("utilMode", v); if (v === "OCCUPANCY") setScenario("personalizado"); }} />
                {l}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {form.utilMode === "HOURS" ? (
              <Field label="Horas equivalentes/dia" htmlFor="hours" hint="Horas à potência plena por dia.">
                <Input id="hours" inputMode="decimal" value={form.hours} onChange={(e) => { setScenario("personalizado"); set("hours", e.target.value); }} />
              </Field>
            ) : (
              <>
                <Field label="Ocupação (% do dia)" htmlFor="occ" hint="Tempo com veículo conectado.">
                  <Input id="occ" inputMode="decimal" value={form.occupancyPct} onChange={(e) => set("occupancyPct", e.target.value)} />
                </Field>
                <Field label="Potência média entregue (%)" htmlFor="pf" hint="Fração da potência nominal durante a sessão.">
                  <Input id="pf" inputMode="decimal" value={form.powerFactorPct} onChange={(e) => set("powerFactorPct", e.target.value)} />
                </Field>
              </>
            )}
            <Field label="kWh médio por sessão" htmlFor="kwhs" hint="Opcional. Estima nº de sessões.">
              <Input id="kwhs" inputMode="decimal" value={form.kwhPerSession} onChange={(e) => set("kwhPerSession", e.target.value)} />
            </Field>
            <Field label="Dias por mês" htmlFor="days">
              <Input id="days" inputMode="decimal" value={form.days} onChange={(e) => set("days", e.target.value)} />
            </Field>
            <Field label="Crescimento mensal (%)" htmlFor="growth">
              <Input id="growth" inputMode="decimal" value={form.growthPct} onChange={(e) => set("growthPct", e.target.value)} />
            </Field>
            <Field label="Prazo de análise (meses)" htmlFor="horizon">
              <Input id="horizon" inputMode="numeric" value={form.horizon} onChange={(e) => set("horizon", e.target.value)} />
            </Field>
          </div>
        </Section>

        <Section title="4. Preço e custos">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço de venda (R$/kWh)" htmlFor="price">
              <Input id="price" inputMode="decimal" value={form.price} onChange={(e) => set("price", e.target.value)} />
            </Field>
            <Field label="Custo da energia (R$/kWh)" htmlFor="ecost" hint="Use a tarifa real da concessionária ou usina.">
              <Input id="ecost" inputMode="decimal" value={form.energyCost} onChange={(e) => set("energyCost", e.target.value)} />
            </Field>
            <Field label="Comissões (% do bruto)" htmlFor="comm">
              <Input id="comm" inputMode="decimal" value={form.commissionPct} onChange={(e) => set("commissionPct", e.target.value)} />
            </Field>
            {!t.platformFeeIncludesGateway && (
              <>
                <Field label="Gateway (% do bruto)" htmlFor="gw" hint="Contratado à parte da taxa de sistema.">
                  <Input id="gw" inputMode="decimal" value={form.gatewayPct} onChange={(e) => set("gatewayPct", e.target.value)} />
                </Field>
                <Field label="Gateway por transação (R$)" htmlFor="gwf" hint="Exige kWh por sessão.">
                  <Input id="gwf" inputMode="decimal" value={form.gatewayFixed} onChange={(e) => set("gatewayFixed", e.target.value)} />
                </Field>
              </>
            )}
          </div>
          {t.platformFeeIncludesGateway && (
            <p className="text-xs text-navy-500">A taxa de sistema deste modelo ({pct(t.platformFeeRate)}) já inclui o gateway de pagamento; custo de gateway à parte não é aplicado para evitar dupla contagem.</p>
          )}
          <details className="rounded-lg border border-navy-100 bg-white p-3" open>
            <summary className="cursor-pointer text-sm font-medium text-navy-800">Custos fixos mensais (R$)</summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {(Object.keys(FIXED_LABELS) as (keyof FormState["fixed"])[]).map((k) => (
                <Field key={k} label={FIXED_LABELS[k]} htmlFor={`fixed-${k}`}>
                  <Input id={`fixed-${k}`} inputMode="decimal" value={form.fixed[k]} onChange={(e) => set("fixed", { ...form.fixed, [k]: e.target.value })} />
                </Field>
              ))}
            </div>
          </details>
        </Section>

        <Section title="5. Investimento">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {(Object.keys(INVEST_LABELS) as (keyof FormState["invest"])[]).map((k) => (
              <Field key={k} label={INVEST_LABELS[k]} htmlFor={`inv-${k}`}>
                <Input id={`inv-${k}`} inputMode="decimal" value={form.invest[k]} onChange={(e) => set("invest", { ...form.invest, [k]: e.target.value })} />
              </Field>
            ))}
            <Field label="Capital de giro (R$)" htmlFor="wc" hint="Aportado no mês 0 na proporção do capital.">
              <Input id="wc" inputMode="decimal" value={form.workingCapital} onChange={(e) => set("workingCapital", e.target.value)} />
            </Field>
            <Field label="Taxa de desconto (% a.a.)" htmlFor="disc" hint="Necessária para o VPL.">
              <Input id="disc" inputMode="decimal" value={form.discountPct} onChange={(e) => set("discountPct", e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-navy-700">
            <input type="checkbox" className="size-4 accent-brand-600" checked={form.recoverWc} onChange={(e) => set("recoverWc", e.target.checked)} />
            Devolver o capital de giro no último mês
          </label>
        </Section>
      </form>

      <div className="min-w-0">
        {!computed.ok ? (
          <Alert tone="danger" title="Premissas inválidas">
            <ul className="list-disc pl-5">{computed.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </Alert>
        ) : (
          <>
            <SimulatorResults result={computed.result} terms={t} scenarios={computed.scenarios} modelsCmp={computed.modelsCmp} />
            <div className="mt-6 rounded-[var(--radius-card)] border border-navy-100 bg-white p-5">
              {mode === "app" && onSave && model.versionId ? (
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSaveMsg(null);
                    startSaving(async () => {
                      const { terms: _t, ...input } = toEngineInput(form, model.terms);
                      const r = await onSave({ name: saveName, versionId: model.versionId!, input });
                      setSaveMsg({ tone: r.status === "ok" ? "success" : "danger", text: r.message ?? "" });
                    });
                  }}
                >
                  <Field label="Nome da simulação" htmlFor="sim-name" className="min-w-60 flex-1">
                    <Input id="sim-name" required minLength={2} value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Ex.: Posto Av. Almirante Barroso — 2×60 kW" />
                  </Field>
                  <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar simulação"}</Button>
                  {saveMsg && <Alert tone={saveMsg.tone} className="w-full">{saveMsg.text}</Alert>}
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <p className="max-w-xl text-sm text-navy-600">
                    Esta é uma estimativa com as premissas informadas. Um estudo de viabilidade avalia o local, a infraestrutura elétrica e a demanda real.
                  </p>
                  <ButtonLink href="/contato?origem=simulador">Solicitar estudo de viabilidade</ButtonLink>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-navy-100 bg-white p-4 shadow-[var(--shadow-card)]">
      <legend className="sr-only">{title}</legend>
      <p className="font-display text-sm font-semibold text-navy-900" aria-hidden>{title}</p>
      {children}
    </fieldset>
  );
}
