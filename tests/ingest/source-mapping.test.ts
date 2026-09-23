import { describe, expect, it } from "vitest";
import { mapSourceWorkbooks, sourceCellValue, type SourceMappingWorkbook } from "../../lib/ingest/source-mapping";
import type { RawCell, RawRow } from "../../lib/ingest/raw-workbook";

function cell(address: string, value: string | null, type?: string, formula = false): RawCell {
  return { attributes: { r: address, ...(type ? { t: type } : {}) }, value, text: type === "str" ? value : null,
    formula: formula ? { name: "f", attributes: {}, children: ["1/0"] } : null, extra: [] };
}
function row(number: number, cells: RawCell[]): RawRow { return { ordinal: number, attributes: { r: String(number) }, cells, extra: [] }; }
function book(filename: string, rows: RawRow[]): SourceMappingWorkbook {
  return { id: filename, supplier: "IEK", filename, sha256: filename, sheets: [{ name: "Sheet1", rows }] };
}
const header = (...texts: string[]) => row(1, texts.map((text, index) => cell(`${String.fromCharCode(65 + index)}1`, text, "str")));

describe("PostgreSQL source interpretation", () => {
  it("preserves exact codes, signed values, zero and unknowns without changing source rows", async () => {
    const input = book("IEK sales.xlsx", [header("Код", "Номенклатура", "янв. 2026", "февр. 2026", "март 2026"),
      row(2, [cell("A2", "9007199254740993"), cell("B2", "Synthetic", "str"), cell("C2", "-3E+0"), cell("D2", "0"), cell("E2", null)])]);
    const before = JSON.stringify(input);
    const data = await mapSourceWorkbooks([input]);
    expect(data.suppliers[0].products[0]).toMatchObject({ code: "9007199254740993", category: "unknown" });
    expect(data.suppliers[0].sales.map(s => s.quantity)).toEqual([-3, 0, null]);
    expect(data.files[0]).toMatchObject({ hash: input.sha256, workbookId: input.id });
    expect(JSON.stringify(input)).toBe(before);
  });
  it("emits one MOQ issue per invalid cell with its actual Excel error and exact provenance", async () => {
    const data = await mapSourceWorkbooks([book("IEK MOQ.xlsx", [header("Код", "Наименование", "MOQ"),
      row(2, [cell("A2", "001_", "str"), cell("B2", "Synthetic", "str"), cell("C2", "#N/A", "e", true)]),
      row(3, [cell("A3", "002_", "str"), cell("C3", null, undefined, true)]),
      row(4, [cell("A4", "003_", "str"), cell("C4", "0")]),
    ])]);
    const issues = data.suppliers[0].issues.filter(i => i.code === "UNKNOWN_MOQ" || i.code === "INVALID_NUMBER");
    expect(issues).toHaveLength(3);
    expect(issues[0].message).toContain("ошибка Excel #N/A");
    expect(issues[0].source).toEqual({ file: "IEK MOQ.xlsx", workbookId: "IEK MOQ.xlsx", sheet: "Sheet1", row: 2, cell: "C2" });
    expect(issues[1].message).toContain("формула без сохранённого");
    expect(issues[2].message).toContain("неположительное");
    expect(data.suppliers[0].products.every(p => p.moq === undefined)).toBe(true);
  });
  it("reports empty error-typed cells separately from concrete Excel errors", async () => {
    const data = await mapSourceWorkbooks([book("IEK sales.xlsx", [header("Код", "Номенклатура", "янв. 2026", "февр. 2026", "март 2026"),
      row(2, [cell("A2", "001_", "str"), cell("C2", null, "e"), cell("D2", "#N/A", "e"), cell("E2", null)])])]);
    const issues = data.suppliers[0].issues;
    expect(issues.find(i => i.code === "EMPTY_ERROR_CELL")).toMatchObject({ severity: "info", source: { cell: "C2" } });
    expect(issues.find(i => i.code === "INVALID_NUMBER")).toMatchObject({ severity: "warning", source: { cell: "D2" } });
    expect(issues.some(i => i.source?.cell === "E2")).toBe(false);
    expect(data.suppliers[0].sales.map(s => s.quantity)).toEqual([null, null, null]);
  });
  it("reads only cached formulas and distinguishes error type without cache from blank", () => {
    expect(sourceCellValue(cell("A1", "-42", undefined, true))).toBe("-42");
    expect(sourceCellValue(cell("A1", null))).toBeNull();
    expect(sourceCellValue(cell("A1", null, "e"))).toEqual({ error: "" });
    expect(sourceCellValue(cell("A1", null, undefined, true))).toHaveProperty("formula");
  });
  it("streams rows asynchronously and interprets numeric Excel dates and real categories", async () => {
    const tx = book("IEK transactions.xlsx", [header("Дата", "Номер", "Документ", "Код", "Количество"),
      row(2, [cell("A2", "45922"), cell("B2", "0001", "str"), cell("C2", "Расходная накладная 0001", "str"), cell("D2", "001_", "str"), cell("E2", "-2")])]);
    const transit = book("IEK transit.xlsx", [header("Код", "Наименование", "Категория 2026", "Свободный остаток"),
      row(2, [cell("A2", "001_", "str"), cell("B2", "Synthetic", "str"), cell("C2", "3"), cell("D2", "0")])]);
    async function* books() {
      for (const b of [tx, transit]) {
        const sheets = [...b.sheets as Iterable<{ name: string; rows: RawRow[] }>];
        yield { ...b, sheets: sheets.map(s => ({ name: s.name, rows: (async function* () { yield* s.rows; })() })) };
      }
    }
    const data = await mapSourceWorkbooks(books());
    expect(data.suppliers[0].transactions[0]).toMatchObject({ date: "2025-09-22", invoice: "0001", quantity: -2 });
    expect(data.suppliers[0].products[0].category).toBe("3");
    expect(data.suppliers[0].currentStock[0].available).toBe(0);
  });
  it("refuses unsupported date systems instead of shifting dates silently", async () => {
    await expect(mapSourceWorkbooks([{ ...book("IEK.xlsx", []), date1904: true }])).rejects.toThrow("1904");
  });
});
