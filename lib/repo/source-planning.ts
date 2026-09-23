import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import type { RawRow } from "../ingest/raw-workbook";
import { mapSourceWorkbooks, SOURCE_MAPPING_VERSION, type SourceMappingWorkbook } from "../ingest/source-mapping";
import type { Supplier } from "../contracts/engine";
import { AppError, saveDataset } from "./index";

/** A closed SSH connection can be reopened safely for an immutable page read. */
async function readPage<T>(query: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await query(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (attempt >= 2 || !/Connection terminated|connection (?:closed|reset)|ECONNRESET|ETIMEDOUT|server closed the connection/i.test(message)) throw error;
    }
  }
}

/** Streams immutable source cells; no filesystem reads or XLSX decoding occurs here. */
export async function* planningSources(db: PrismaClient, ids: string[]): AsyncGenerator<SourceMappingWorkbook> {
  if (!ids.length || ids.length > 24 || new Set(ids).size !== ids.length) throw new AppError("Select between 1 and 24 distinct source workbooks");
  const books = await db.sourceWorkbook.findMany({ where: { id: { in: ids } },
    select: { id: true, supplier: true, filename: true, sha256: true,
      sheets: { select: { id: true, name: true }, orderBy: { ordinal: "asc" } } },
    orderBy: [{ supplier: "asc" }, { filename: "asc" }, { id: "asc" }] });
  if (books.length !== ids.length) throw new AppError("Source workbook not found", 404);
  const dateSettings = await db.$queryRaw<{ id: string; date1904: boolean }[]>(Prisma.sql`
    SELECT id, EXISTS (SELECT 1 FROM jsonb_array_elements(metadata->'workbook'->'children') AS n
      WHERE n->'attributes'->>'date1904' IN ('1', 'true')) AS "date1904"
    FROM "SourceWorkbook" WHERE id IN (${Prisma.join(ids)})`);
  const identities = new Set<string>();
  for (const book of books) {
    if (book.supplier !== "IEK" && book.supplier !== "SE") throw new AppError("Unsupported source supplier");
    const identity = `${book.supplier}:${book.filename}`;
    if (identities.has(identity)) throw new AppError("Select only one revision of each source workbook");
    identities.add(identity);
  }
  async function* rows(sheetId: string): AsyncGenerator<RawRow> {
    let ordinal = 0;
    while (true) {
      const batch = await readPage(() => db.sourceRow.findMany({ where: { sheetId, ordinal: { gt: ordinal } },
        select: { ordinal: true, attributes: true, cells: true, extra: true }, orderBy: { ordinal: "asc" }, take: 1000 }));
      if (!batch.length) return;
      for (const row of batch) yield row as unknown as RawRow;
      ordinal = batch[batch.length - 1].ordinal;
    }
  }
  for (const book of books) {
    // Fail closed on an unsupported date system, including XML namespace variants.
    const date1904 = dateSettings.find(setting => setting.id === book.id)?.date1904 ?? false;
    yield { id: book.id, supplier: book.supplier as Supplier, filename: book.filename, sha256: book.sha256,
      date1904, sheets: book.sheets.map(sheet => ({ name: sheet.name, rows: rows(sheet.id) })) };
  }
}

export async function materializeSourceDataset(db: PrismaClient, ids: string[], name: string) {
  const input = await mapSourceWorkbooks(planningSources(db, ids), { name, synthetic: false, cutoffDate: "2026-09-22" });
  return saveDataset(input, SOURCE_MAPPING_VERSION, { reuseExisting: true });
}
