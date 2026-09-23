import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { rawWorkbookSummary, type RawWorkbook } from "../ingest/raw-workbook";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function equal(actual: unknown, expected: unknown, label: string) {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`Source verification failed: ${label}`);
}

/** Reads back every stored row; errors contain coordinates only, never partner values. */
export async function verifyRawWorkbook(db: PrismaClient, id: string, book: RawWorkbook) {
  const stored = await db.sourceWorkbook.findUniqueOrThrow({ where: { id }, include: { sheets: { orderBy: { ordinal: "asc" } } } });
  equal(createHash("sha256").update(stored.originalBytes).digest("hex"), book.sha256, "original byte SHA-256");
  equal(Buffer.from(stored.originalBytes), book.originalBytes, "original bytes");
  equal(stored.metadata, book.metadata, "workbook metadata");
  equal(stored.parserVersion, book.parserVersion, "parser version");
  equal(stored.sha256, book.sha256, "recorded hash");
  equal(stored.sheets.length, book.sheets.length, "sheet count");
  for (let i = 0; i < book.sheets.length; i++) {
    const source = book.sheets[i], sheet = stored.sheets[i];
    for (const key of ["ordinal", "name", "path", "dimension", "attributes", "metadata"] as const) equal(sheet[key], source[key], `sheet ${i + 1} ${key}`);
    equal(await db.sourceRow.count({ where: { sheetId: sheet.id } }), source.rows.length, `sheet ${i + 1} row count`);
    for (let offset = 0; offset < source.rows.length; offset += 1000) {
      const rows = await db.sourceRow.findMany({ where: { sheetId: sheet.id, ordinal: { gt: offset } }, orderBy: { ordinal: "asc" }, take: 1000 });
      equal(rows.map(({ ordinal, attributes, cells, extra }) => ({ ordinal, attributes, cells, extra })), source.rows.slice(offset, offset + 1000), `sheet ${i + 1} rows ${offset + 1} onward`);
    }
  }
  return { id, verified: true, ...rawWorkbookSummary(book) };
}

/** A source row's identity is its position, never product code or invoice number. */
export async function saveRawWorkbook(db: PrismaClient, book: RawWorkbook, filename: string, supplier: string) {
  const identity = { supplier, sha256: book.sha256, parserVersion: book.parserVersion };
  const existing = await db.sourceWorkbook.findUnique({ where: { supplier_sha256_parserVersion: identity }, select: { id: true } });
  if (existing) return { reused: true, ...await verifyRawWorkbook(db, existing.id, book) };
  let id: string;
  try {
    id = await db.$transaction(async tx => {
      const source = await tx.sourceWorkbook.create({ data: { ...identity, filename, originalBytes: new Uint8Array(book.originalBytes), metadata: json(book.metadata) }, select: { id: true } });
      for (const sheet of book.sheets) {
        const saved = await tx.sourceSheet.create({ data: { workbookId: source.id, ordinal: sheet.ordinal, name: sheet.name,
          path: sheet.path, dimension: sheet.dimension, attributes: json(sheet.attributes), metadata: json(sheet.metadata) }, select: { id: true } });
        for (let offset = 0; offset < sheet.rows.length; offset += 1000) {
          await tx.sourceRow.createMany({ data: sheet.rows.slice(offset, offset + 1000).map(row => ({
            sheetId: saved.id, ordinal: row.ordinal, attributes: json(row.attributes), cells: json(row.cells), extra: json(row.extra),
          })) });
        }
      }
      return source.id;
    }, { timeout: 600000, maxWait: 15000 });
  } catch (error) {
    // A simultaneous identical import can win the unique constraint. Other failures propagate.
    const raced = await db.sourceWorkbook.findUnique({ where: { supplier_sha256_parserVersion: identity }, select: { id: true } });
    if (!raced) throw error;
    return { reused: true, ...await verifyRawWorkbook(db, raced.id, book) };
  }
  return { reused: false, ...await verifyRawWorkbook(db, id, book) };
}
