"use client";

import { useActionState, useState } from "react";
import { submitLeadAction } from "@/app/actions/leads";
import { idle, type ActionState } from "@/server/action-result";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

const BUSINESS = [
  ["FUEL_STATION", "Posto de combustível"],
  ["SUPERMARKET", "Supermercado"],
  ["PARKING", "Estacionamento"],
  ["SHOPPING_CENTER", "Centro comercial"],
  ["COMPANY", "Empresa / frota"],
  ["OTHER", "Outro"],
] as const;
const UFS = "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ");

export function LeadForm({ source, campaign }: { source: "WEBSITE_VIABILITY" | "WEBSITE_CONTACT" | "WEBSITE_SIMULATOR"; campaign?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(submitLeadAction, idle);
  const [startedAt] = useState(() => Date.now());
  const fe = state.status === "error" ? state.fieldErrors ?? {} : {};

  if (state.status === "ok") {
    return (
      <Alert tone="success" title="Solicitação recebida">
        {state.message} Se preferir, responda ao e-mail de confirmação quando ele chegar ou fale conosco pelos canais oficiais.
      </Alert>
    );
  }

  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2" noValidate>
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="startedAt" value={startedAt} />
      {campaign && <input type="hidden" name="campaign" value={campaign} />}
      {/* Honeypot anti-spam: invisível para pessoas */}
      <div className="absolute -left-[9999px]" aria-hidden>
        <label htmlFor="website">Site</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      {state.status === "error" && <Alert tone="danger" className="sm:col-span-2">{state.message}</Alert>}

      <Field label="Nome" htmlFor="contactName" required error={fe.contactName}>
        <Input id="contactName" name="contactName" autoComplete="name" required aria-invalid={!!fe.contactName} />
      </Field>
      <Field label="E-mail" htmlFor="email" required error={fe.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!fe.email} />
      </Field>
      <Field label="Telefone / WhatsApp" htmlFor="phone" error={fe.phone}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" placeholder="(91) 90000-0000" aria-invalid={!!fe.phone} />
      </Field>
      <Field label="Empresa / estabelecimento" htmlFor="companyName" error={fe.companyName}>
        <Input id="companyName" name="companyName" autoComplete="organization" />
      </Field>
      <Field label="Tipo de estabelecimento" htmlFor="businessType" error={fe.businessType}>
        <Select id="businessType" name="businessType" defaultValue="">
          <option value="">Selecione</option>
          {BUSINESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label="Cidade" htmlFor="city" error={fe.city}>
          <Input id="city" name="city" autoComplete="address-level2" />
        </Field>
        <Field label="UF" htmlFor="state" error={fe.state}>
          <Select id="state" name="state" defaultValue="">
            <option value="">—</option>
            {UFS.map((u) => <option key={u}>{u}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Modelo de interesse" htmlFor="interestModel" className="sm:col-span-2">
        <Select id="interestModel" name="interestModel" defaultValue="indefinido">
          <option value="indefinido">Ainda não sei — quero orientação</option>
          <option value="compra-integral">Compra integral (100%)</option>
          <option value="parceria-50-50">Parceria 50/50</option>
        </Select>
      </Field>
      <Field label="Conte sobre o local" htmlFor="message" className="sm:col-span-2" hint="Ex.: vagas disponíveis, padrão de entrada de energia, melhor horário para uma reunião." error={fe.message}>
        <Textarea id="message" name="message" maxLength={2000} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-navy-600 sm:col-span-2">
        <input type="checkbox" name="consent" className="mt-1 size-4 accent-brand-600" required />
        <span>
          Concordo com o tratamento dos meus dados para contato comercial, conforme a{" "}
          <a href="/privacidade" className="font-medium text-brand-700 underline">Política de Privacidade</a>.
          {fe.consent && <span className="block text-xs text-red-600">{fe.consent}</span>}
        </span>
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Enviando…" : source === "WEBSITE_VIABILITY" ? "Solicitar estudo de viabilidade" : "Enviar mensagem"}
        </Button>
      </div>
    </form>
  );
}
