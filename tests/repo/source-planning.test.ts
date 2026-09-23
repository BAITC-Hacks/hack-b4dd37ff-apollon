import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../generated/prisma/client";
import type { RawRow } from "../../lib/ingest/raw-workbook";
import { planningSources } from "../../lib/repo/source-planning";

function workbook(id = "source-a", filename = "report.xlsx") {
  return { id, supplier: "IEK", filename, sha256: "synthetic-test-hash", metadata: {}, sheets: [{ id: `${id}-sheet`, name: "Sheet1" }] };
}
function mockDatabase(books: ReturnType<typeof workbook>[], rows: RawRow[] = [], dates: { id: string; date1904: boolean }[] = []) {
  const findBooks = vi.fn(async () => books);
  const findRows = vi.fn(async (query: { where: { sheetId: string; ordinal: { gt: number } }; take: number }) => rows.filter(row => row.ordinal > query.where.ordinal.gt).slice(0, query.take));
  const dateSettings = vi.fn(async () => dates);
  return { db: { sourceWorkbook: { findMany: findBooks }, sourceRow: { findMany: findRows }, $queryRaw: dateSettings } as unknown as PrismaClient, findBooks, findRows, dateSettings };
}
async function sourceRows(db: PrismaClient): Promise<RawRow[]> {
  const result: RawRow[] = [];
  for await (const book of planningSources(db, ["source-a"])) {
    for await (const sheet of book.sheets) for await (const row of sheet.rows) result.push(row);
  }
  return result;
}

describe("PostgreSQL source selection", () => {
  it("pages physical row ordinals lazily and preserves original row numbers and cell facts", async () => {
    const rows: RawRow[] = Array.from({ length: 1001 }, (_, index) => ({
      ordinal: index * 2 + 1, attributes: { r: String(index + 700), hidden: "1" },
      cells: [{ attributes: { r: `A${index + 700}`, t: "n" }, value: index % 2 ? "0" : null, text: null, formula: null, extra: [] }], extra: [],
    }));
    const { db, findBooks, findRows } = mockDatabase([workbook()], rows);
    const sources = planningSources(db, ["source-a"]);
    const first = await sources.next();
    expect(first.done).toBe(false);
    expect(findRows).not.toHaveBeenCalled();
    const sheets = [];
    for await (const sheet of first.value!.sheets) sheets.push(sheet);
    const stored: RawRow[] = [];
    for await (const row of sheets[0].rows) stored.push(row);
    expect(stored).toEqual(rows);
    expect(findRows.mock.calls.map(([query]) => query.where.ordinal.gt)).toEqual([0, 1999, 2001]);
    expect(findRows.mock.calls.every(([query]) => query.take === 1000)).toBe(true);
    const query = findBooks.mock.calls[0] as unknown[];
    expect(query[0]).toMatchObject({ select: { id: true, sha256: true }, orderBy: [{ supplier: "asc" }, { filename: "asc" }, { id: "asc" }] });
    expect((query[0] as { select: object }).select).not.toHaveProperty("originalBytes");
    expect((query[0] as { select: object }).select).not.toHaveProperty("metadata");
  });
  it("rejects ambiguous revisions before reading any cells", async () => {
    const { db, findRows } = mockDatabase([workbook("old"), workbook("new")]);
    await expect(planningSources(db, ["old", "new"]).next()).rejects.toThrow("one revision");
    expect(findRows).not.toHaveBeenCalled();
  });
  it("rejects missing, repeated and empty selections rather than silently changing inputs", async () => {
    const { db, findBooks } = mockDatabase([workbook()]);
    await expect(planningSources(db, []).next()).rejects.toThrow("distinct");
    await expect(planningSources(db, ["source-a", "source-a"]).next()).rejects.toThrow("distinct");
    expect(findBooks).not.toHaveBeenCalled();
    await expect(planningSources(db, ["source-a", "missing"]).next()).rejects.toMatchObject({ status: 404 });
  });
  it("passes the stored date system into interpretation without reading workbook bytes", async () => {
    const book = workbook();
    const { db } = mockDatabase([book], [], [{ id: book.id, date1904: true }]);
    expect((await planningSources(db, [book.id]).next()).value).toMatchObject({ id: book.id, date1904: true });
  });
  it("retries a failed read at the same cursor without yielding earlier rows twice", async () => {
    vi.useFakeTimers();
    try {
      const rows: RawRow[] = Array.from({ length: 1001 }, (_, index) => ({ ordinal: index + 1, attributes: { r: String(index + 1) }, cells: [], extra: [] }));
      const { db, findRows } = mockDatabase([workbook()], rows);
      findRows.mockResolvedValueOnce(rows.slice(0, 1000)).mockRejectedValueOnce(new Error("Connection terminated unexpectedly"));
      const collected = sourceRows(db);
      await vi.runAllTimersAsync();
      expect(await collected).toEqual(rows);
      expect(findRows.mock.calls.map(([query]) => query.where.ordinal.gt)).toEqual([0, 1000, 1000, 1001]);
    } finally { vi.useRealTimers(); }
  });
  it("propagates a nontransport error immediately without retrying", async () => {
    const { db, findRows } = mockDatabase([workbook()]);
    const error = Object.assign(new Error("Invalid source query"), { code: "P2009" });
    findRows.mockRejectedValue(error);
    await expect(sourceRows(db)).rejects.toBe(error);
    expect(findRows).toHaveBeenCalledTimes(1);
  });
  it("stops after three failed transport attempts instead of retrying indefinitely", async () => {
    vi.useFakeTimers();
    try {
      const { db, findRows } = mockDatabase([workbook()]);
      const error = new Error("Connection terminated unexpectedly");
      findRows.mockRejectedValue(error);
      const assertion = expect(sourceRows(db)).rejects.toBe(error);
      await vi.runAllTimersAsync();
      await assertion;
      expect(findRows).toHaveBeenCalledTimes(3);
      expect(findRows.mock.calls.map(([query]) => query.where.ordinal.gt)).toEqual([0, 0, 0]);
    } finally { vi.useRealTimers(); }
  });
});
