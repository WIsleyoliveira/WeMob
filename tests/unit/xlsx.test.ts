import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnRef, excelSerial, sheetName } from "@/lib/xlsx";

/** Leitor mínimo do ZIP "stored" gerado (confere assinatura, CRC e tamanhos de cada parte). */
function unzip(buf: Buffer) {
  const files = new Map<string, string>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    expect(buf.readUInt16LE(p + 8)).toBe(0); // sem compressão
    const crc = buf.readUInt32LE(p + 14);
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString("utf8");
    const data = buf.subarray(p + 30 + nameLen, p + 30 + nameLen + size);
    expect(crc32(data) >>> 0).toBe(crc);
    files.set(name, data.toString("utf8"));
    p += 30 + nameLen + size;
  }
  expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
  expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(files.size);
  return files;
}

describe("Excel nativo (.xlsx)", () => {
  const xlsx = buildXlsx([
    {
      name: "Demonstrativo 2026-09",
      columns: [{ header: "Unidade" }, { header: "Bruto (R$)", type: "money" }, { header: "Versão", type: "integer" }, { header: "Baixa em", type: "datetime" }],
      rows: [
        ["Posto <Um> & Cia", "900.05", 2, new Date("2026-09-30T15:00:00Z")],
        ["=HYPERLINK(\"http://x\")", "-70.00", null, ""],
        ["Controle\u0001proibido", "abc", "", undefined],
      ],
    },
  ]);
  const files = unzip(xlsx);

  it("tem as partes obrigatórias do SpreadsheetML", () => {
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(files.get("xl/workbook.xml")).toContain('<sheet name="Demonstrativo 2026-09" sheetId="1" r:id="rId1"/>');
  });

  it("dinheiro e inteiros como número (somáveis), texto escapado, cabeçalho congelado com filtro", () => {
    const s = files.get("xl/worksheets/sheet1.xml")!;
    expect(s).toContain('<c r="B2" s="2"><v>900.05</v></c>');
    expect(s).toContain('<c r="B3" s="2"><v>-70</v></c>');
    expect(s).toContain('<c r="C2" s="4"><v>2</v></c>');
    expect(s).toContain("Posto &lt;Um&gt; &amp; Cia");
    expect(s).toContain('state="frozen"');
    expect(s).toContain('<autoFilter ref="A1:D4"/>');
    // valor não numérico numa coluna de dinheiro vira texto (nunca NaN)
    expect(s).toContain('<c r="B4" t="inlineStr"><is><t xml:space="preserve">abc</t></is></c>');
    expect(s).not.toContain("NaN");
  });

  it("texto que parece fórmula fica como texto (sem <f>); caracteres de controle são removidos", () => {
    const s = files.get("xl/worksheets/sheet1.xml")!;
    expect(s).not.toContain("<f>");
    expect(s).toContain("=HYPERLINK(&quot;http://x&quot;)");
    expect(s).toContain("Controleproibido");
  });

  it("datas em série do Excel no horário de Brasília", () => {
    // 2026-09-30 12:00 em Brasília = 46295,5
    expect(excelSerial(new Date("2026-09-30T15:00:00Z"))).toBeCloseTo(46295.5, 6);
    expect(files.get("xl/worksheets/sheet1.xml")).toContain('<c r="D2" s="6"><v>46295.5</v></c>');
  });

  it("referências de coluna e nomes de aba válidos", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnRef)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    const used = new Set<string>();
    expect(sheetName("Demonstrativo: 2026/09 [prévia] com um nome bem comprido", used)).toBe("Demonstrativo  2026 09  prévia");
    expect(sheetName("demonstrativo  2026 09  PRÉVIA", used)).toMatch(/ 2$/);
    expect(sheetName("", used)).toBe("Planilha");
  });

  it("recusa planilha sem abas", () => {
    expect(() => buildXlsx([])).toThrow();
  });
});
