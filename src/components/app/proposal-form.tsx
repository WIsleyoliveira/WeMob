"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { brl } from "@/lib/format";

type Item = { description: string; quantity: string; unitPrice: string };

/** Campos de proposta com itens dinâmicos. O total exibido é prévia; o servidor recalcula. */
export function ProposalFields({
  defaults,
  models,
}: {
  defaults?: { title: string; items: Item[]; validUntil: string; conditions: string; modelVersionId?: string | null };
  models: { id: string; label: string }[];
}) {
  const [items, setItems] = useState<Item[]>(defaults?.items ?? [{ description: "Projeto e implantação do eletroposto", quantity: "1", unitPrice: "" }]);
  const preview = items.reduce((a, i) => {
    try {
      return a.plus(new Decimal(i.quantity || 0).mul(i.unitPrice.replace(",", ".") || 0).toDecimalPlaces(2));
    } catch {
      return a;
    }
  }, new Decimal(0));
  const set = (idx: number, k: keyof Item, v: string) => setItems(items.map((it, j) => (j === idx ? { ...it, [k]: v } : it)));
  return (
    <div className="flex flex-col gap-4">
      <Field label="Título" htmlFor="title"><Input id="title" name="title" required minLength={3} defaultValue={defaults?.title} /></Field>
      <fieldset className="rounded-lg border border-navy-100 p-3">
        <legend className="px-1 text-sm font-medium text-navy-800">Itens</legend>
        <input type="hidden" name="items" value={JSON.stringify(items.map((i) => ({ description: i.description, quantity: i.quantity.replace(",", "."), unitPrice: i.unitPrice.replace(",", ".") })))} />
        <div className="flex flex-col gap-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_5rem_8rem_auto] items-end gap-2">
              <Field label="Descrição" htmlFor={`d-${i}`}><Input id={`d-${i}`} value={it.description} onChange={(e) => set(i, "description", e.target.value)} required /></Field>
              <Field label="Qtd." htmlFor={`q-${i}`}><Input id={`q-${i}`} inputMode="decimal" value={it.quantity} onChange={(e) => set(i, "quantity", e.target.value)} /></Field>
              <Field label="Valor unit. (R$)" htmlFor={`u-${i}`}><Input id={`u-${i}`} inputMode="decimal" value={it.unitPrice} onChange={(e) => set(i, "unitPrice", e.target.value)} /></Field>
              <Button type="button" variant="ghost" aria-label={`Remover item ${i + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setItems([...items, { description: "", quantity: "1", unitPrice: "" }])}>+ Item</Button>
          <p className="text-sm text-navy-600">Prévia do total: <b className="tabular">{brl(preview.toFixed(2))}</b> <span className="text-xs text-navy-400">(recalculado no servidor)</span></p>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Válida até" htmlFor="validUntil"><Input id="validUntil" name="validUntil" type="date" required defaultValue={defaults?.validUntil} /></Field>
        <Field label="Modelo comercial de referência" htmlFor="modelVersionId">
          <Select id="modelVersionId" name="modelVersionId" defaultValue={defaults?.modelVersionId ?? ""}>
            <option value="">—</option>
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Condições comerciais" htmlFor="conditions" hint="Royalties, taxas, bases de cálculo, responsabilidades e ressalvas. Sujeito a contrato.">
        <Textarea id="conditions" name="conditions" required minLength={10} rows={6} defaultValue={defaults?.conditions} />
      </Field>
    </div>
  );
}
