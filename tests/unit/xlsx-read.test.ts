import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { XlsxReadError, readXlsx } from "@/lib/xlsx-read";
import { buildXlsx } from "@/lib/xlsx";
import { parseCostWorkbook } from "@/domain/costs/import";

/** ZIP com DEFLATE (como o Excel e outras ferramentas gravam), para exercitar o caminho real do leitor. */
function zipDeflate(files: { name: string; data: string | Buffer }[]) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8");
    const comp = deflateRawSync(raw);
    const name = Buffer.from(f.name);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc32(raw) >>> 0, 14);
    l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(raw.length, 22); l.writeUInt16LE(name.length, 26);
    locals.push(l, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc32(raw) >>> 0, 16);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    centrals.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const size = centrals.reduce((a, b) => a + b.length, 0);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(size, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, e]);
}

// Mesmo formato da planilha recebida: prefixo de namespace "x:", atributos fora de ordem, strings compartilhadas, fórmulas com valor em cache.
const strings = ["Item", "Categoria", "Base R$/mes", "Exposicao cambial", "Servidor app e API", "Infraestrutura", "Suporte e manutencao", "Operacao", "TOTAL MENSAL", "Premissa", "Alta cambial de stress", "Reserva operacional sobre custo ajustado", "Custo incremental mensal por posto", "Reserva incremental por posto"];
const sst = `<x:sst xmlns:x="m">${strings.map((t) => `<x:si><x:t>${t.replace("&", "&amp;")}</x:t></x:si>`).join("")}</x:sst>`;
const s = (ref: string, i: number) => `<x:c r="${ref}" t="s"><x:v>${i}</x:v></x:c>`;
const n = (ref: string, v: number | string) => `<x:c r="${ref}"><x:v>${v}</x:v></x:c>`;
const sheet1 = `<x:worksheet xmlns:x="m"><x:sheetData>
  <x:row r="4">${s("A4", 0)}${s("B4", 1)}${s("C4", 2)}${s("D4", 3)}</x:row>
  <x:row r="5">${s("A5", 4)}${s("B5", 5)}${n("C5", 240)}${n("D5", 1)}<x:c r="E5"><x:f>C5*(1+D5*'Cenarios de custo'!$B$5)</x:f><x:v>336</x:v></x:c></x:row>
  <x:row r="6">${s("A6", 6)}${s("B6", 7)}${n("C6", 407)}${n("D6", 0)}</x:row>
  <x:row r="8">${s("A8", 8)}${n("C8", 647)}</x:row>
</x:sheetData></x:worksheet>`;
const sheet2 = `<x:worksheet xmlns:x="m"><x:sheetData>
  <x:row r="4">${s("A4", 9)}</x:row>
  <x:row r="5">${s("A5", 10)}${n("B5", 0.4)}</x:row><x:row r="6">${s("A6", 11)}${n("B6", 0.6)}</x:row>
  <x:row r="7">${s("A7", 12)}${n("B7", 250)}</x:row><x:row r="8">${s("A8", 13)}${n("B8", 150)}</x:row>
</x:sheetData></x:worksheet>`;
const workbookXml = `<x:workbook xmlns:x="m"><x:sheets><x:sheet name="Custos mensais" sheetId="1" r:id="Rb9" xmlns:r="r" /><x:sheet name="Cenarios de custo" sheetId="2" r:id="R50" xmlns:r="r" /></x:sheets></x:workbook>`;
const rels = `<Relationships><Relationship Type="t" Target="/xl/worksheets/sheet1.xml" Id="Rb9" /><Relationship Type="t" Target="/xl/worksheets/sheet2.xml" Id="R50" /></Relationships>`;
const real = () => zipDeflate([{ name: "xl/workbook.xml", data: workbookXml }, { name: "xl/sharedStrings.xml", data: sst }, { name: "xl/worksheets/sheet1.xml", data: sheet1 }, { name: "xl/worksheets/sheet2.xml", data: sheet2 }, { name: "xl/_rels/workbook.xml.rels", data: rels }]);

describe("leitura de .xlsx enviado por usuário", () => {
  it("lê o formato da planilha recebida (deflate, prefixo x:, strings compartilhadas) e o resultado em cache das fórmulas", () => {
    const wb = readXlsx(real());
    expect([...wb.keys()]).toEqual(["Custos mensais", "Cenarios de custo"]);
    expect(wb.get("Custos mensais")!.get("A5")).toBe("Servidor app e API");
    expect(wb.get("Custos mensais")!.get("C5")).toBe(240);
    expect(wb.get("Custos mensais")!.get("E5")).toBe(336); // valor em cache — a fórmula não é avaliada
  });

  it("interpreta itens e premissas; para na linha TOTAL", () => {
    const r = parseCostWorkbook(readXlsx(real()));
    expect(r).toEqual({
      ok: true,
      data: {
        items: [
          { name: "Servidor app e API", category: "INFRASTRUCTURE", baseMonthly: 240, fxExposure: 1 },
          { name: "Suporte e manutencao", category: "OPERATIONS", baseMonthly: 407, fxExposure: 0 },
        ],
        assumptions: { fxStressRate: 0.4, reserveRate: 0.6, perStationCost: 250, perStationReserve: 150 },
      },
    });
  });

  it("também lê o que o próprio sistema exporta (ZIP sem compressão, inlineStr)", () => {
    const wb = readXlsx(buildXlsx([{ name: "Teste", columns: [{ header: "A" }, { header: "B", type: "money" }], rows: [["x & y", "12.50"]] }]));
    expect(wb.get("Teste")!.get("A2")).toBe("x & y");
    expect(wb.get("Teste")!.get("B2")).toBe(12.5);
  });

  it("recusa arquivo que não é .xlsx, grande demais ou bomba de ZIP", () => {
    expect(() => readXlsx(Buffer.from("isto não é uma planilha"))).toThrow(XlsxReadError);
    expect(() => readXlsx(Buffer.alloc(1_000_001))).toThrow(/1 MB/);
    const bomb = zipDeflate([{ name: "xl/workbook.xml", data: workbookXml }, { name: "xl/_rels/workbook.xml.rels", data: rels }, { name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(11_000_000, 0x20) }]);
    expect(bomb.length).toBeLessThan(1_000_000);
    expect(() => readXlsx(bomb)).toThrow(/grande demais/);
  });

  it("ignora caminhos fora de xl/worksheets indicados pelas relações", () => {
    const evil = zipDeflate([{ name: "xl/workbook.xml", data: workbookXml }, { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Target="../../etc/passwd" Id="Rb9"/></Relationships>` }]);
    expect([...readXlsx(evil).keys()]).toEqual([]);
  });

  it("validação: categoria desconhecida, exposição fora de 0–1, premissa ausente e item repetido viram erros (nada é adivinhado)", () => {
    const bad = (cells: string, scen = sheet2) =>
      parseCostWorkbook(readXlsx(zipDeflate([{ name: "xl/workbook.xml", data: workbookXml }, { name: "xl/sharedStrings.xml", data: sst }, { name: "xl/worksheets/sheet1.xml", data: `<x:worksheet xmlns:x="m"><x:sheetData><x:row r="4">${s("A4", 0)}${s("B4", 1)}${s("C4", 2)}${s("D4", 3)}</x:row>${cells}</x:sheetData></x:worksheet>` }, { name: "xl/worksheets/sheet2.xml", data: scen }, { name: "xl/_rels/workbook.xml.rels", data: rels }])));
    const r1 = bad(`<x:row r="5">${s("A5", 4)}${s("B5", 0)}${n("C5", 10)}${n("D5", 1)}</x:row>`);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join(" ")).toMatch(/categoria "Item" desconhecida/);
    const r2 = bad(`<x:row r="5">${s("A5", 4)}${s("B5", 5)}${n("C5", 10)}${n("D5", 40)}</x:row>`);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.join(" ")).toMatch(/exposição cambial deve ser um número entre 0 e 1/);
    const r3 = bad(`<x:row r="5">${s("A5", 4)}${s("B5", 5)}${n("C5", 10)}${n("D5", 1)}</x:row><x:row r="6">${s("A6", 4)}${s("B6", 5)}${n("C6", 10)}${n("D6", 1)}</x:row>`, `<x:worksheet xmlns:x="m"><x:sheetData></x:sheetData></x:worksheet>`);
    expect(r3.ok).toBe(false);
    if (!r3.ok) {
      expect(r3.errors.join(" ")).toMatch(/repetido/);
      expect(r3.errors.join(" ")).toMatch(/Premissa "Alta cambial de stress" não encontrada/);
    }
  });
});
