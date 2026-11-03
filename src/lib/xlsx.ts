/**
 * Gerador mínimo de planilhas Excel (.xlsx, Office Open XML) sem dependência externa: um ZIP sem compressão
 * ("stored", CRC32 do próprio Node) com as partes obrigatórias do SpreadsheetML.
 *
 * - Valores monetários e números vão como NÚMERO (célula numérica com formato), não como texto: somas funcionam.
 * - Texto vai como inlineStr. Uma célula de texto nunca é fórmula no XLSX (fórmula exigiria <f>), então "=..." de um
 *   dado do usuário não executa — diferente do CSV, que precisa do prefixo "'".
 * - Datas como número de série do Excel com formato de data/hora, no horário de Brasília (America/Sao_Paulo).
 */
import { crc32 } from "node:zlib";

export type ColumnType = "text" | "money" | "number" | "integer" | "date" | "datetime";
export interface Column {
  header: string;
  type?: ColumnType;
  width?: number;
}
export interface Sheet {
  name: string;
  columns: Column[];
  rows: unknown[][];
}

// Estilos (cellXfs): 0 padrão · 1 cabeçalho em negrito · 2 dinheiro · 3 número · 4 inteiro · 5 data · 6 data e hora
const STYLE: Record<ColumnType, number> = { text: 0, money: 2, number: 3, integer: 4, date: 5, datetime: 6 };

// Remove caracteres proibidos em XML 1.0 (controles) e escapa os especiais.
const xmlText = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function columnRef(index: number) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Nome de aba válido no Excel: até 31 caracteres, sem []:*?/\ e sem repetir (sem diferenciar maiúsculas). */
export function sheetName(name: string, used: Set<string>) {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31).trim() || "Planilha";
  let n = base;
  for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(n.toLowerCase());
  return n;
}

const SAO_PAULO_OFFSET_MS = -3 * 3600_000; // sem horário de verão desde 2019
/** Número de série do Excel (dias desde 1899-12-30) no horário de Brasília. */
export function excelSerial(d: Date) {
  return (d.getTime() + SAO_PAULO_OFFSET_MS) / 86400_000 + 25569;
}

function cell(ref: string, value: unknown, type: ColumnType): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "date" || type === "datetime") {
    const d = value instanceof Date ? value : new Date(String(value));
    if (!Number.isNaN(d.getTime())) return `<c r="${ref}" s="${STYLE[type]}"><v>${excelSerial(d)}</v></c>`;
  } else if (type !== "text") {
    const n = typeof value === "number" ? value : Number(String(value));
    if (Number.isFinite(n)) return `<c r="${ref}" s="${STYLE[type]}"><v>${n}</v></c>`;
  }
  const s = value instanceof Date ? value.toISOString() : String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(s)}</t></is></c>`;
}

function sheetXml(sheet: Sheet) {
  const cols = sheet.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? Math.min(60, Math.max(10, c.header.length + 4))}" customWidth="1"/>`).join("");
  const header = `<row r="1">${sheet.columns.map((c, i) => `<c r="${columnRef(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xmlText(c.header)}</t></is></c>`).join("")}</row>`;
  const body = sheet.rows
    .map((row, r) => `<row r="${r + 2}">${sheet.columns.map((c, i) => cell(`${columnRef(i)}${r + 2}`, row[i], c.type ?? "text")).join("")}</row>`)
    .join("");
  const last = `${columnRef(Math.max(0, sheet.columns.length - 1))}${sheet.rows.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${header}${body}</sheetData>` +
    (sheet.columns.length ? `<autoFilter ref="A1:${last}"/>` : "") +
    `</worksheet>`
  );
}

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy hh:mm"/></numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="7">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** ZIP "stored" (sem compressão): cabeçalhos locais + diretório central + fim do diretório. */
export function zipStored(files: { name: string; data: Buffer }[], date = new Date()) {
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, f.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + f.data.length;
  }
  const centralSize = centrals.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function buildXlsx(sheets: Sheet[]): Buffer {
  if (!sheets.length) throw new Error("Planilha sem abas.");
  const used = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, used));
  const files = [
    {
      name: "[Content_Types].xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `</Types>`,
    },
    {
      name: "_rels/.rels",
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      xml:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", xml: STYLES_XML },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, xml: sheetXml(s) })),
  ];
  return zipStored(files.map((f) => ({ name: f.name, data: Buffer.from(f.xml, "utf8") })));
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
