/**
 * Leitor mínimo e defensivo de planilhas .xlsx (dado NÃO confiável enviado por usuário). Lê só valores de células
 * (texto, número e o último valor calculado de fórmulas) — nunca executa fórmula, macro ou link externo.
 * Proteções: tamanho do arquivo, número de partes do ZIP, volume descompactado (bomba de ZIP), só os métodos
 * "stored" e "deflate", caminhos esperados do SpreadsheetML e limite de células por aba.
 */
import { inflateRawSync } from "node:zlib";

export const XLSX_LIMITS = { fileBytes: 1_000_000, entries: 200, inflatedBytes: 10_000_000, cellsPerSheet: 20_000 } as const;

export class XlsxReadError extends Error {}

type Entry = { name: string; method: number; compressed: number; size: number; offset: number };

function zipEntries(buf: Buffer): Entry[] {
  // Fim do diretório central (busca nos últimos 64 KB + 22 bytes).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError("Arquivo não é uma planilha .xlsx válida.");
  const count = buf.readUInt16LE(eocd + 10);
  if (count > XLSX_LIMITS.entries) throw new XlsxReadError("Planilha com partes demais.");
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxReadError("Estrutura do arquivo corrompida.");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"), method, compressed, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function readEntry(buf: Buffer, e: Entry, budget: { left: number }): string {
  if (e.size > budget.left) throw new XlsxReadError("Conteúdo descompactado grande demais.");
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new XlsxReadError("Estrutura do arquivo corrompida.");
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.compressed);
  let data: Buffer;
  if (e.method === 0) data = raw;
  else if (e.method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.min(budget.left, XLSX_LIMITS.inflatedBytes) });
  else throw new XlsxReadError("Método de compressão não suportado.");
  budget.left -= data.length;
  return data.toString("utf8");
}

const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
// Tags com ou sem prefixo de namespace (<c> ou <x:c>) e atributos em qualquer ordem.
const P = "(?:[A-Za-z_][\\w.-]*:)?";
const tag = (name: string, flags = "g") => new RegExp(`<${P}${name}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${P}${name}>)`, flags);
const attr = (attrs: string, name: string) => new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}="([^"]*)"`).exec(attrs)?.[1];
const textOf = (xml: string) => [...xml.matchAll(tag("t"))].map((m) => unescapeXml(m[2] ?? "")).join("");

export type CellValue = string | number | null;
export type Workbook = Map<string, Map<string, CellValue>>;

/** Planilha → { nome da aba → { "A1" → valor } }. */
export function readXlsx(buf: Buffer): Workbook {
  if (buf.length > XLSX_LIMITS.fileBytes) throw new XlsxReadError("Arquivo maior que 1 MB.");
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new XlsxReadError("Arquivo não é uma planilha .xlsx válida.");
  const entries = zipEntries(buf);
  const budget = { left: XLSX_LIMITS.inflatedBytes };
  const byName = new Map(entries.map((e) => [e.name, e]));
  const get = (name: string) => {
    const e = byName.get(name);
    return e ? readEntry(buf, e, budget) : null;
  };
  const workbook = get("xl/workbook.xml");
  const rels = get("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new XlsxReadError("Arquivo não é uma planilha .xlsx válida.");
  const shared = get("xl/sharedStrings.xml");
  const strings = shared ? [...shared.matchAll(tag("si"))].map((m) => textOf(m[2] ?? "")) : [];
  const targets = new Map([...rels.matchAll(tag("Relationship"))].map((m) => [attr(m[1], "Id"), attr(m[1], "Target")] as const).filter((x): x is [string, string] => !!x[0] && !!x[1]));
  const out: Workbook = new Map();
  for (const m of workbook.matchAll(tag("sheet"))) {
    const sheetName = attr(m[1], "name");
    const rid = attr(m[1], "id");
    if (!sheetName || !rid) continue;
    const target = targets.get(rid);
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
    if (!/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(path)) continue; // só abas comuns, sem caminhos estranhos
    const xml = get(path);
    if (!xml) continue;
    const cells = new Map<string, CellValue>();
    for (const c of xml.matchAll(tag("c"))) {
      if (cells.size >= XLSX_LIMITS.cellsPerSheet) throw new XlsxReadError("Aba com células demais.");
      const attrs = c[1];
      const ref = attr(attrs, "r");
      if (!ref || !/^[A-Z]{1,3}\d{1,7}$/.test(ref)) continue;
      const type = attr(attrs, "t");
      const body = c[2] ?? "";
      const vm = tag("v", "").exec(body);
      const v = vm ? (vm[2] ?? "") : undefined;
      let value: CellValue = null;
      if (type === "s") value = v !== undefined ? (strings[Number(v)] ?? null) : null;
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = v !== undefined ? unescapeXml(v) : null;
      else if (type === "b") value = v === "1" ? 1 : 0;
      else if (v !== undefined && v.trim() !== "") value = Number.isFinite(Number(v)) ? Number(v) : null;
      cells.set(ref, value);
    }
    out.set(unescapeXml(sheetName), cells);
  }
  return out;
}
