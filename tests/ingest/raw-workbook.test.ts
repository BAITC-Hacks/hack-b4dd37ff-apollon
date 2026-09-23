import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parseRawWorkbook, rawWorkbookSummary } from "../../lib/ingest/raw-workbook";

async function fixture(sheet: string) {
  const zip = new JSZip();
  zip.file("xl/workbook.xml", '<workbook xmlns:r="urn:relationships"><workbookPr date1904="1"/><sheets><sheet name="Источник" sheetId="8" state="hidden" r:id="r42"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r42" Type="urn:test/worksheet" Target="worksheets/custom.xml"/><Relationship Id="strings" Type="urn:test/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>');
  zip.file("xl/sharedStrings.xml", '<sst><si><r><t xml:space="preserve"> 001_ </t></r><r><t>Тест</t></r><rPh><t>annotation</t></rPh></si></sst>');
  zip.file("xl/worksheets/custom.xml", sheet);
  zip.file("xl/externalLinks/externalLink1.xml", '<externalLink/>');
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("lossless workbook source projection", () => {
  it("retains duplicate rows, exact lexical numbers, errors, formulas, empty values and original bytes", async () => {
    const cells = '<c r="A4" t="s"><v>0</v></c><c r="B4"><v>9007199254740993</v></c><c r="C4" t="e"/>' +
      '<c r="D4" t="n"><v>0</v></c><c r="E4" t="e"><f t="shared" si="2" ref="E4:E8">VLOOKUP(A4,[1]Прайс!A:P,15,0)</f><v>#N/A</v></c>' +
      '<c r="F4"><v/></c><c r="G4" s="3"/><c r="H4" t="b"><v>1</v></c>' +
      '<c r="I4"><f t="shared" si="2"/><v>-0</v></c><c r="J4" t="inlineStr"><is><t xml:space="preserve"> =literal </t></is></c>';
    const bytes = await fixture(`<worksheet><dimension ref="J8"/><sheetData><row r="4">${cells}</row><row r="7" hidden="1"/><row r="8">${cells}</row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>`);
    const book = await parseRawWorkbook(bytes), sheet = book.sheets[0];
    expect(book.originalBytes).toEqual(bytes);
    expect(sheet).toMatchObject({ path: "xl/worksheets/custom.xml", dimension: "J8", attributes: { state: "hidden" } });
    expect(sheet.rows).toHaveLength(3); // no invented rows from dimension, no duplicate filtering
    expect(sheet.rows[0].cells).toEqual(sheet.rows[2].cells);
    expect(sheet.rows[1]).toMatchObject({ attributes: { r: "7", hidden: "1" }, cells: [] });
    const c = sheet.rows[0].cells;
    expect(c[0]).toMatchObject({ text: " 001_ Тест", value: "0", attributes: { t: "s" } });
    expect(c[1].value).toBe("9007199254740993");
    expect(c[2]).toMatchObject({ attributes: { t: "e" }, value: null });
    expect(c[3].value).toBe("0");
    expect(c[4]).toMatchObject({ value: "#N/A", formula: { attributes: { t: "shared", si: "2", ref: "E4:E8" } } });
    expect(c[5].value).toBe("");
    expect(c[6]).toMatchObject({ value: null, attributes: { s: "3" } });
    expect(c[7]).toMatchObject({ value: "1", attributes: { t: "b" } });
    expect(c[8]).toMatchObject({ value: "-0", formula: { attributes: { si: "2" }, children: [] } });
    expect(c[9]).toMatchObject({ text: " =literal ", extra: [{ name: "is" }] });
    expect(rawWorkbookSummary(book).sheets[0]).toMatchObject({ rows: 3, cells: 20, formulas: 4, errors: 4 });
  });
  it("rejects damaged ZIP, malformed XML, DTD and invalid shared-string references", async () => {
    await expect(parseRawWorkbook(Buffer.from("not zip"))).rejects.toThrow();
    await expect(parseRawWorkbook(await fixture('<worksheet><sheetData></worksheet>'))).rejects.toThrow();
    await expect(parseRawWorkbook(await fixture('<!DOCTYPE worksheet><worksheet/>'))).rejects.toThrow("DTD");
    await expect(parseRawWorkbook(await fixture('<worksheet><sheetData><row><c t="s"><v>99</v></c></row></sheetData></worksheet>'))).rejects.toThrow("shared-string");
  });
  it("rejects an oversized declared expansion before CRC decompression", async () => {
    const bytes = await fixture('<worksheet/>');
    let centralHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(centralHeader).toBeGreaterThan(0);
    while (bytes.subarray(centralHeader + 46, centralHeader + 46 + bytes.readUInt16LE(centralHeader + 28)).toString().endsWith("/")) {
      centralHeader += 46 + bytes.readUInt16LE(centralHeader + 28) + bytes.readUInt16LE(centralHeader + 30) + bytes.readUInt16LE(centralHeader + 32);
    }
    bytes.writeUInt32LE(351 * 1024 * 1024, centralHeader + 24);
    await expect(parseRawWorkbook(bytes)).rejects.toThrow("350 MiB uncompressed");
  });
});
