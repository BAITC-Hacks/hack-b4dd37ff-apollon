import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generateDemoWorkbooks } from "../../scripts/make-demo-data";
import { ImportError, parseDate, parseMonth, parseNumber, parseWorkbooks, readDirectory, scalar } from "../../lib/ingest";
import type { DatasetInput } from "../../lib/contracts/engine";

async function file(name: string, rows: ExcelJS.CellValue[][], sheet = "Лист_1") {
  const book = new ExcelJS.Workbook(); book.addWorksheet(sheet).addRows(rows);
  return { name, buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}

describe("spreadsheet values", () => {
  it("keeps unknown separate from zero, preserves signs and cached formula values", () => {
    expect(parseNumber(null)).toBeNull(); expect(parseNumber(0)).toBe(0);
    expect(parseNumber("1\u00a0234,50")).toBe(1234.5); expect(parseNumber("-24")).toBe(-24);
    expect(parseNumber({ formula: "2+2", result: 4 })).toBe(4);
    expect(parseNumber({ formula: "2+2" })).toBeNull(); expect(parseNumber({ error: "#N/A" })).toBeNull();
    expect(parseNumber("12% ")).toBe(0.12); expect(parseNumber("nope")).toBeNull();
    expect(scalar({ richText: [{ text: "Номен" }, { text: "клатура" }] })).toBe("Номенклатура");
  });
  it("handles Russian months, named shipment dates, Excel dates, invalid dates", () => {
    expect(parseMonth("Сентябрь 2026 г.")).toBe("2026-09"); expect(parseMonth("февр. 2024")).toBe("2024-02");
    expect(parseDate("22.09.2026 15:14:10")).toBe("2026-09-22");
    expect(parseDate("УТ от 31 августа 2026 г.")).toBe("2026-08-31");
    expect(parseDate("24.09", 2026)).toBe("2026-09-24");
    expect(parseDate("31.02.2026")).toBeNull(); expect(parseDate("not date")).toBeNull();
    expect(parseDate(new Date("2026-09-22T00:00:00Z"))).toBe("2026-09-22");
  });
});

describe("partner adapters", () => {
  it("preserves exact identifiers and unknown cells, excludes totals, audits errors", async () => {
    const input = await file("IEK продажи.xlsx", [
      ["Номенклатура", "Номенклатура.Код", "янв. 2026", "февр. 2026", "март 2026"],
      ["Количество", null, "Количество"], ["Вымышленный товар", "000123_", -3, null, { formula: "1/0", result: { error: "#DIV/0!" } }],
      ["Итого", null, 99999],
    ]);
    const d = await parseWorkbooks([input]); const s = d.suppliers[0];
    expect(s.products.map((p) => p.code)).toEqual(["000123_"]);
    expect(s.sales.map((p) => p.quantity)).toEqual([-3, null, null]);
    expect(s.sales[0].source).toMatchObject({ file: input.name, sheet: "Лист_1", row: 3 });
    expect(s.issues.some((i) => i.code === "INVALID_NUMBER")).toBe(true);
    expect(s.issues.some((i) => i.code === "MISSING_SOURCE")).toBe(true);
  });
  it("retains signed outgoing invoices, filters other documents and future/invalid rows", async () => {
    const input = await file("IEK transactions.xlsx", [
      ["Дата", "Номер", "Документ", "Код", "Номенклатура", "Ед.", "Склад", "Количество"],
      ["21.09.2026", "001", "Расходная накладная 001", "001_", "Синтетика", "шт", "Алматы", -10],
      ["21.09.2026", "002", "Заказ покупателя 002", "001_", "Синтетика", "шт", "Алматы", 300],
      ["21.09.2026", "003", "Приходная накладная 003", "001_", "Синтетика", "шт", "Алматы", 200],
      ["23.09.2026", "004", "Расходная накладная 004", "001_", "Синтетика", "шт", "Алматы", 100],
      ["32.09.2026", "005", "Расходная накладная 005", "001_", "Синтетика", "шт", "Алматы", 20],
    ]);
    const s = (await parseWorkbooks([input])).suppliers[0];
    expect(s.transactions).toHaveLength(1); expect(s.transactions[0]).toMatchObject({ code: "001_", invoice: "001", quantity: -10 });
    expect(s.transactions[0].customerId).toBeUndefined(); expect(s.issues.filter((i) => i.code === "NON_SALES_DOCUMENT")).toHaveLength(2);
  });
  it("does not corrupt Cyrillic shared strings at UTF-8 buffer boundaries", async () => {
    const rows: ExcelJS.CellValue[][] = [["Дата", "Номер", "Документ", "Код", "Номенклатура", "Ед.", "Склад", "Количество"]];
    for (let i = 0; i < 3000; i++) rows.push(["21.09.2026", `00${i}`, `Расходная накладная ${i} от 21.09.2026`, `00${i}_`, `Полностью вымышленный русский товар № ${i}`, "шт", "Алматы", 1]);
    const s = (await parseWorkbooks([await file("IEK utf8.xlsx", rows)])).suppliers[0];
    expect(s.transactions).toHaveLength(3000);
    expect(s.products.every((p) => !p.name.includes("�"))).toBe(true);
  });
  it("uses monthly source and dedicated MOQ precedence; free stock is already net of reservations", async () => {
    const monthly = await file("SE monthly.xlsx", [["Номенклатура", "Номенклатура.Код", "Артикул", "Кратность", "янв. 2026"], ["Тест", "0001_", "A", 0, 10]]);
    const moq = await file("SE MOQ.xlsx", [["Код 1с", "Наименование", "Кратность"], ["0001_", "Тест", 6]]);
    const transit = await file("SE transit.xlsx", [["Код 1с", "Наименование", "Категория 2026", "СС реал", "Кэф. Роста", "Свободный остаток", "Зарезервировано", "янв. 2026", "СЭ в пути 24.09"], ["0001_", "Тест", 2, 150, 0.15, 10, 4, 500, 30]], "TDSheet");
    const s = (await parseWorkbooks([transit, monthly, moq])).suppliers[0];
    expect(s.sales[0].quantity).toBe(10); expect(s.products[0]).toMatchObject({ multiple: 6, moq: 6, growthRate: 0.15, category: "2", cost: 150 });
    expect(s.currentStock[0]).toMatchObject({ available: 10, reserved: 4, kind: "current" });
    expect(s.deliveries[0]).toMatchObject({ eta: "2026-09-24", quantity: 30 }); expect(s.deliveries[0].receivedDate).toBeUndefined();
  });
  it("does not duplicate identical files or assume a minimum is a pack multiple", async () => {
    const moq = await file("IEK MOQ.xlsx", [["Код 1с", "Наименование", "Мин. разр. к отгр."], ["0001_", "Тест", 6], ["0001_", "Тест", 6]]);
    const d = await parseWorkbooks([moq, { ...moq, name: "IEK copy.xlsx" }]);
    expect(d.files).toHaveLength(1); expect(d.suppliers[0].products[0].moq).toBe(6); expect(d.suppliers[0].products[0].multiple).toBeUndefined();
    expect(d.suppliers[0].issues.some((i) => i.code === "DUPLICATE_FILE")).toBe(true);
    expect(d.suppliers[0].issues.some((i) => i.code === "DUPLICATE_MOQ")).toBe(true);
  });
  it("keeps the report snapshot date and ETA year when the calculation cutoff is earlier", async () => {
    const transit = await file("SE transit на 22.09.2026.xlsx", [["Код 1с", "Наименование", "Свободный остаток", "СЭ в пути 24.09"], ["0001_", "Тест", 10, 30]], "TDSheet");
    const s = (await parseWorkbooks([transit], { cutoffDate: "2025-09-20" })).suppliers[0];
    expect(s.currentStock[0].date).toBe("2026-09-22"); expect(s.deliveries[0].eta).toBe("2026-09-24");
  });
  it("reports reconciliation differences without summing report sources", async () => {
    const monthly = await file("IEK sales.xlsx", [["Код", "Номенклатура", "янв. 2026"], ["0001_", "Тест", 100]]);
    const tx = await file("IEK transactions.xlsx", [["Дата", "Номер", "Документ", "Код", "Количество"], ["15.01.2026", "I1", "Расходная накладная I1", "0001_", 20]]);
    const s = (await parseWorkbooks([monthly, tx])).suppliers[0];
    expect(s.sales[0].quantity).toBe(100); expect(s.issues.some((i) => i.code === "RECONCILIATION_MISMATCH")).toBe(true);
  });
  it("rejects malformed, unsupported, unknown-supplier and empty uploads with friendly errors", async () => {
    await expect(parseWorkbooks([])).rejects.toBeInstanceOf(ImportError);
    await expect(parseWorkbooks([{ name: "IEK.xlsx", buffer: Buffer.from("garbage") }])).rejects.toBeInstanceOf(ImportError);
    await expect(parseWorkbooks([{ name: "IEK.csv", buffer: Buffer.from("a,b") }])).rejects.toThrow(".xlsx");
    await expect(parseWorkbooks([{ name: "unknown.xlsx", buffer: Buffer.from("a,b") }])).rejects.toThrow("поставщик");
    await expect(parseWorkbooks([await file("IEK.xlsx", [["Hello", "World"]])])).rejects.toThrow("заголовки");
  });
});

describe("synthetic workbook round trip", () => {
  let directory: string, dataset: DatasetInput;
  beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), "apollon-ingest-test-")); await generateDemoWorkbooks(directory); dataset = await readDirectory(directory, { synthetic: true }); }, 30000);
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
  it("uses all 12 exact-layout workbooks through the real adapters", () => {
    expect(dataset.synthetic).toBe(true); expect(dataset.files).toHaveLength(12);
    expect(dataset.files.every((f) => f.kind !== "unknown")).toBe(true);
    for (const s of dataset.suppliers) {
      expect(s.products).toHaveLength(24); expect(s.sales).toHaveLength(24 * 33); expect(s.stocks).toHaveLength(24 * 33);
      expect(s.transactions.length).toBeGreaterThan(3000);
      expect(s.products.every((p) => p.code.startsWith("00DEMO-") && p.name.startsWith("[СИНТЕТИКА]"))).toBe(true);
      expect(s.issues.some((i) => i.code === "MISSING_SOURCE")).toBe(false);
    }
  });
  it("contains the auditable seasonality, stockouts, growth, project, returns and unit scenarios", () => {
    for (const s of dataset.suppliers) {
      const find = (suffix: string) => s.products.find((p) => p.code.endsWith(`${suffix}_`))!;
      expect(find("007")).toMatchObject({ unit: "м", unitConversion: 305 });
      expect(s.stockouts).toHaveLength(1); expect(s.stockouts[0].confirmed).toBe(true);
      expect(s.stocks.find((p) => p.code === find("003").code && p.month === "2026-04")?.quantity).toBeNull();
      expect(s.transactions.some((t) => t.quantity < 0)).toBe(true);
      expect(s.transactions.some((t) => t.customerId === "SYN-SPLIT-CUSTOMER")).toBe(true);
      expect(s.transactions.some((t) => t.invoice.includes("SYN-PROJECT"))).toBe(true);
      expect(s.issues.some((i) => i.code === "INVALID_NUMBER")).toBe(true);
      expect(s.issues.some((i) => i.code === "DUPLICATE_MOQ")).toBe(true);
    }
    const iek = dataset.suppliers.find((s) => s.supplier === "IEK")!, se = dataset.suppliers.find((s) => s.supplier === "SE")!;
    expect(iek.deliveries.some((d) => d.eta < dataset.cutoffDate)).toBe(true);
    expect(iek.deliveries.some((d) => d.eta > "2026-12-31")).toBe(true);
    expect(iek.currentStock).toHaveLength(0); expect(se.currentStock).toHaveLength(24);
    expect(se.products.find((p) => p.code.endsWith("002_"))?.growthRate).toBe(0.3);
  });
  it("regenerates byte-identical archives, allowing idempotent seed hashes", async () => {
    const files = dataset.files.map((f) => join(directory, f.name));
    const hash = async (path: string) => createHash("sha256").update(await readFile(path)).digest("hex");
    const before = await Promise.all(files.map(hash)); await generateDemoWorkbooks(directory);
    expect(await Promise.all(files.map(hash))).toEqual(before);
  }, 30000);
});
