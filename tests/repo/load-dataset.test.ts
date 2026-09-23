import { beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_MAPPING_VERSION } from "../../lib/ingest/source-mapping";
import { loadDataset } from "../../lib/repo";

const db = vi.hoisted(() => ({ dataset: { findUnique: vi.fn() }, product: { findMany: vi.fn() } }));
vi.mock("../../lib/db", () => ({ getDb: () => db }));
function metadata() {
  return { name: "Synthetic paging regression", synthetic: false, cutoffDate: "2026-09-22", parserVersion: SOURCE_MAPPING_VERSION, files: [], suppliers: [
    { supplier: "SE", seasonality: [1], issues: [] }, { supplier: "IEK", seasonality: [2], issues: [] },
  ] };
}
function product(index: number) {
  const code = `TEST-${index}`, source = { file: "synthetic.xlsx", sheet: "Sheet1", row: index + 1, cell: `B${index + 1}`, workbookId: "test-source" };
  return {
    id: String(index).padStart(5, "0"), supplier: index % 2 ? "SE" : "IEK",
    attributes: { code, name: "Synthetic test", supplierArticle: "0001", unit: "шт", category: "unknown", source },
    monthlySales: [{ code, month: "2026-01", quantity: null, source }], stockHistory: [{ code, month: "2026-01", quantity: 0, source }],
    currentStock: [{ code, date: "2026-09-22", available: -1, kind: "current", source }],
    transactions: [{ code, date: "2026-01-01", invoice: "0001", quantity: -3, source }],
    deliveries: [{ code, quantity: 2, eta: "2026-10-01", source }], stockouts: [{ code, start: "2026-01-01", end: "2026-01-03", confirmed: true }],
  };
}
beforeEach(() => vi.resetAllMocks());

describe("bounded dataset loading", () => {
  it("loads metadata separately and appends every fact across stable 100-product pages", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => product(index));
    db.dataset.findUnique.mockResolvedValue(metadata());
    db.product.findMany.mockImplementation(async (query) => rows.filter(row => !query.where.id || row.id > query.where.id.gt).slice(0, query.take));
    const loaded = await loadDataset("dataset");
    expect(db.dataset.findUnique.mock.calls[0][0]).not.toHaveProperty("include");
    expect(db.dataset.findUnique.mock.calls[0][0].select).not.toHaveProperty("products");
    expect(db.product.findMany.mock.calls.map(([query]) => query.where.id?.gt)).toEqual([undefined, "00099", "00199", "00200"]);
    expect(db.product.findMany.mock.calls.every(([query]) => query.take === 100 && query.orderBy.id === "asc" && query.where.datasetId === "dataset")).toBe(true);
    expect(loaded.suppliers.map(supplier => supplier.supplier)).toEqual(["SE", "IEK"]);
    for (const supplier of loaded.suppliers) {
      const expected = rows.filter(row => row.supplier === supplier.supplier);
      expect(supplier.products).toEqual(expected.map(row => row.attributes));
      expect(supplier.sales).toEqual(expected.flatMap(row => row.monthlySales));
      expect(supplier.stocks).toEqual(expected.flatMap(row => row.stockHistory));
      expect(supplier.currentStock).toEqual(expected.flatMap(row => row.currentStock));
      expect(supplier.transactions).toEqual(expected.flatMap(row => row.transactions));
      expect(supplier.deliveries).toEqual(expected.flatMap(row => row.deliveries));
      expect(supplier.stockouts).toEqual(expected.flatMap(row => row.stockouts));
    }
  });
  it("appends a large single-product transaction history without argument-spread limits", async () => {
    const row = product(0), transaction = row.transactions[0];
    row.transactions = Array(150_000).fill(transaction);
    db.dataset.findUnique.mockResolvedValue(metadata());
    db.product.findMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const loaded = await loadDataset("dataset");
    expect(loaded.suppliers[1].transactions).toHaveLength(150_000);
    expect(loaded.suppliers[1].transactions.at(-1)).toEqual(transaction);
  });
  it("rejects old or synthetic datasets before reading any products, with an explicit internal override", async () => {
    db.dataset.findUnique.mockResolvedValue({ ...metadata(), synthetic: true });
    await expect(loadDataset("old")).rejects.toMatchObject({ status: 410 });
    db.dataset.findUnique.mockResolvedValue({ ...metadata(), parserVersion: "legacy" });
    await expect(loadDataset("old")).rejects.toMatchObject({ status: 410 });
    expect(db.product.findMany).not.toHaveBeenCalled();
    db.product.findMany.mockResolvedValue([]);
    expect((await loadDataset("old", { includeLegacy: true })).suppliers).toHaveLength(2);
  });
  it("does not query products when the dataset is absent", async () => {
    db.dataset.findUnique.mockResolvedValue(null);
    await expect(loadDataset("missing")).rejects.toMatchObject({ status: 404 });
    expect(db.product.findMany).not.toHaveBeenCalled();
  });
});
