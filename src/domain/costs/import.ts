/**
 * Interpreta uma nova versão da planilha de custos (layout de "WeMob_Custos_Mensais_Detalhados.xlsx") — regra pura
 * sobre o conteúdo já lido. Valida estrutura e valores; qualquer dúvida vira erro (nada é "adivinhado").
 *   Aba "Custos mensais": cabeçalho com Item | Categoria | Base R$/mes | Exposicao cambial; itens até a linha TOTAL.
 *   Aba "Cenarios de custo": premissas na coluna B, identificadas pelo texto da coluna A.
 * Só as ENTRADAS são lidas (base e exposição por item; premissas). Totais e cenários são recalculados pelo sistema.
 */
import type { Workbook } from "@/lib/xlsx-read";
import type { CostCategory } from "./platform";

export interface ParsedCostWorkbook {
  items: { name: string; category: CostCategory; baseMonthly: number; fxExposure: number }[];
  assumptions: { fxStressRate: number; reserveRate: number; perStationCost: number; perStationReserve: number };
}

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const CATEGORY: Record<string, CostCategory> = { infraestrutura: "INFRASTRUCTURE", servicos: "SERVICES", operacao: "OPERATIONS", outros: "OTHER" };

function sheet(wb: Workbook, name: string) {
  for (const [k, v] of wb) if (norm(k) === norm(name)) return v;
  return null;
}

export function parseCostWorkbook(wb: Workbook): { ok: true; data: ParsedCostWorkbook } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const costs = sheet(wb, "Custos mensais");
  const scen = sheet(wb, "Cenarios de custo");
  if (!costs) errors.push('Aba "Custos mensais" não encontrada.');
  if (!scen) errors.push('Aba "Cenarios de custo" não encontrada.');
  if (!costs || !scen) return { ok: false, errors };

  // Cabeçalho: primeira linha com "Item" em A e "Categoria" em B.
  let header = 0;
  for (let r = 1; r <= 50; r++) if (norm(costs.get(`A${r}`)) === "item" && norm(costs.get(`B${r}`)) === "categoria") { header = r; break; }
  if (!header) return { ok: false, errors: ['Cabeçalho "Item | Categoria | Base R$/mes | Exposicao cambial" não encontrado na aba "Custos mensais".'] };
  if (!norm(costs.get(`C${header}`)).startsWith("base") || !norm(costs.get(`D${header}`)).startsWith("exposicao")) errors.push("Colunas C e D do cabeçalho devem ser a base mensal e a exposição cambial.");

  const items: ParsedCostWorkbook["items"] = [];
  const seen = new Set<string>();
  for (let r = header + 1; r <= header + 100; r++) {
    const a = costs.get(`A${r}`);
    if (a === undefined || a === null || a === "") {
      if ([1, 2, 3].every((k) => !costs.get(`A${r + k}`))) break;
      continue;
    }
    const name = String(a).trim();
    if (norm(name).startsWith("total")) break;
    const cat = CATEGORY[norm(costs.get(`B${r}`))];
    const base = costs.get(`C${r}`);
    const exp = costs.get(`D${r}`);
    if (!cat) errors.push(`Linha ${r} ("${name}"): categoria "${costs.get(`B${r}`) ?? ""}" desconhecida (use Infraestrutura, Serviços, Operação ou Outros).`);
    if (typeof base !== "number" || base < 0 || base > 10_000_000) errors.push(`Linha ${r} ("${name}"): base mensal deve ser um número entre 0 e 10.000.000.`);
    if (typeof exp !== "number" || exp < 0 || exp > 1) errors.push(`Linha ${r} ("${name}"): exposição cambial deve ser um número entre 0 e 1 (0,5 = 50%).`);
    if (name.length < 2 || name.length > 120) errors.push(`Linha ${r}: nome do item deve ter de 2 a 120 caracteres.`);
    if (seen.has(norm(name))) errors.push(`Linha ${r}: item "${name}" repetido.`);
    seen.add(norm(name));
    if (cat && typeof base === "number" && typeof exp === "number") items.push({ name, category: cat, baseMonthly: base, fxExposure: exp });
  }
  if (items.length === 0 && errors.length === 0) errors.push("Nenhum item de custo encontrado abaixo do cabeçalho.");

  const premise = (label: string, min: number, max: number) => {
    for (let r = 1; r <= 60; r++) {
      if (norm(scen.get(`A${r}`)).startsWith(norm(label))) {
        const v = scen.get(`B${r}`);
        if (typeof v !== "number" || v < min || v > max) {
          errors.push(`Premissa "${label}" (linha ${r}) deve ser um número entre ${min} e ${max}.`);
          return 0;
        }
        return v;
      }
    }
    errors.push(`Premissa "${label}" não encontrada na aba "Cenarios de custo".`);
    return 0;
  };
  const assumptions = {
    fxStressRate: premise("Alta cambial de stress", 0, 3),
    reserveRate: premise("Reserva operacional", 0, 3),
    perStationCost: premise("Custo incremental mensal por posto", 0, 10_000_000),
    perStationReserve: premise("Reserva incremental por posto", 0, 10_000_000),
  };
  return errors.length ? { ok: false, errors } : { ok: true, data: { items, assumptions } };
}
