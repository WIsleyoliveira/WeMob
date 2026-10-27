import { Field, Input, Select } from "@/components/ui/field";

type SiteDefaults = { name?: string; address?: string | null; city?: string | null; state?: string | null; latitude?: unknown; longitude?: unknown; openingHours?: string | null; status?: string; isPublic?: boolean; partnerOrganizationId?: string | null };

export function SiteFields({ partners, d = {} }: { partners: { id: string; name: string; kind: string }[]; d?: SiteDefaults }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Nome" htmlFor="name" required className="sm:col-span-2"><Input id="name" name="name" required defaultValue={d.name} /></Field>
      <Field label="Endereço" htmlFor="address" className="sm:col-span-2"><Input id="address" name="address" defaultValue={d.address ?? ""} /></Field>
      <Field label="Cidade" htmlFor="city"><Input id="city" name="city" defaultValue={d.city ?? ""} /></Field>
      <Field label="UF" htmlFor="state"><Input id="state" name="state" maxLength={2} className="uppercase" defaultValue={d.state ?? ""} /></Field>
      <Field label="Latitude" htmlFor="latitude" hint="Ex.: -1.4558"><Input id="latitude" name="latitude" inputMode="decimal" defaultValue={d.latitude ? String(d.latitude) : ""} /></Field>
      <Field label="Longitude" htmlFor="longitude" hint="Ex.: -48.4902"><Input id="longitude" name="longitude" inputMode="decimal" defaultValue={d.longitude ? String(d.longitude) : ""} /></Field>
      <Field label="Horário de funcionamento" htmlFor="openingHours" hint="Ex.: 24 h ou Seg–Sáb 7h–22h"><Input id="openingHours" name="openingHours" defaultValue={d.openingHours ?? ""} /></Field>
      <Field label="Status" htmlFor="status">
        <Select id="status" name="status" defaultValue={d.status ?? "PROSPECT"}>
          <option value="PROSPECT">Prospecção</option><option value="IMPLEMENTATION">Implantação</option><option value="OPERATING">Em operação</option><option value="SUSPENDED">Suspensa</option>
        </Select>
      </Field>
      <Field label="Investidor / parceiro" htmlFor="partnerOrganizationId" className="sm:col-span-2">
        <Select id="partnerOrganizationId" name="partnerOrganizationId" defaultValue={d.partnerOrganizationId ?? ""}>
          <option value="">— (somente Sansol Mob)</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.kind === "PARTNER" ? "parceiro" : "investidor"})</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-navy-700 sm:col-span-2">
        <input type="checkbox" name="isPublic" defaultChecked={d.isPublic} className="size-4 accent-brand-600" /> Estação pública (poderá aparecer para motoristas quando integrada)
      </label>
    </div>
  );
}
