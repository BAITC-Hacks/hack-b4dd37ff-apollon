import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { calculatePlan } from "../../lib/engine";
import { makeEngineFixture } from "../fixtures/engine";
import { safeText, supplierCsv, supplierEmail, supplierWorkbook } from "../../lib/export";
import type { ExportLine, OrderView } from "../../lib/contracts/api";

function fixtures(): { lines: ExportLine[]; order: OrderView } {
  const recommendation = calculatePlan(makeEngineFixture()).recommendations[0];
  const lines = [{ recommendation, quantity: 42 }];
  const order: OrderView = { id: "TEST-ORDER", supplier: "SE", revision: 3, status: "APPROVED", approver: "Тестовый менеджер", approvedAt: "2026-09-23T10:00:00Z", approvedKeys: [recommendation.key], quantities: { [recommendation.key]: 42 } };
  return { lines, order };
}
describe("approved supplier export formats", () => {
  it.each(["=SUM(1,2)", "+1+2", "-DDE", "@SUM(A1)", "\t=1+1", "\uFEFF @SUM(1,2)"])("neutralizes formula-like text %j", (value) => {
    expect(safeText(value)).toBe(`'${value}`);
  });
  it("preserves ordinary exact codes and quotes embedded CSV delimiters, newlines and quotes", () => {
    expect(safeText("000123_")).toBe("000123_");
    const { lines } = fixtures(); Object.assign(lines[0].recommendation, { code: "000123_", name: 'Товар; "Полярис"\nсиний', supplierArticle: "=1+1" });
    const csv = supplierCsv(lines);
    expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain('"000123_"'); expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"Товар; ""Полярис""\nсиний"'); expect(csv).toContain('"42"');
  });
  it("honors explicit column mapping and approved quantities instead of recommendations", () => {
    const { lines } = fixtures(); lines[0].recommendation.quantity = 900;
    expect(supplierCsv(lines, ["quantity", "code"]).split("\r\n")).toEqual(['\uFEFF"Количество";"Код 1с"', '"42";"SYN-001"']);
  });
  it("writes supplier-grouped XLSX with a frozen approval audit and formula-safe strings", async () => {
    const { lines, order } = fixtures();
    lines[0].recommendation.name = "=HYPERLINK(\"malicious\")";
    lines.push({ quantity: 17, recommendation: { ...structuredClone(lines[0].recommendation), key: "IEK:00002_", code: "00002_", supplier: "IEK" } });
    order.approver = "@reviewer";
    const bytes = await supplierWorkbook(lines, order), workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Systeme Electric", "IEK", "Утверждение"]);
    expect(workbook.getWorksheet("Systeme Electric")!.getCell("G2").value).toBe(42);
    expect(workbook.getWorksheet("IEK")!.getCell("G2").value).toBe(17);
    expect(workbook.getWorksheet("IEK")!.getCell("A2").value).toBe("00002_");
    const name = workbook.getWorksheet("Systeme Electric")!.getCell("C2");
    expect(name.formula).toBeUndefined(); expect(name.value).toBe("'=HYPERLINK(\"malicious\")");
    expect(workbook.getWorksheet("Утверждение")!.getCell("B3").value).toBe("'@reviewer");
    expect(workbook.getWorksheet("Утверждение")!.getCell("B2").value).toBe(3);
  });
  it("produces only an unsent draft email using approved quantities", () => {
    const { lines, order } = fixtures();
    const email = supplierEmail(lines, order);
    expect(email).toContain("не отправлено"); expect(email).toContain("42 шт"); expect(email).toContain("версия 3");
  });
});
