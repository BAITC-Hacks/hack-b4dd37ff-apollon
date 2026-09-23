import type { DatasetInput, SourceRef, Supplier } from "../contracts/engine";
import type { RawCell, RawRow } from "./raw-workbook";
import { addIssue, emptySupplier, findHeader, finish, ImportError, parseDate, processRow, type Context, type Header, type ImportOptions, type Kind, type Value } from "./index";

/** Version of the derived business interpretation, independently of the immutable OOXML archive. */
export const SOURCE_MAPPING_VERSION = "postgres-source-mapping-1";
export interface SourceMappingSheet {
  name: string;
  rows: Iterable<RawRow> | AsyncIterable<RawRow>;
}
export interface SourceMappingWorkbook {
  id: string;
  supplier: Supplier;
  filename: string;
  sha256: string;
  date1904?: boolean;
  sheets: Iterable<SourceMappingSheet> | AsyncIterable<SourceMappingSheet>;
}

/** Cached value only. Keep numeric strings lexical until an explicitly numeric field is interpreted. */
export function sourceCellValue(cell: RawCell): Value {
  if (cell.attributes.t === "e") return { error: cell.value ?? "" } as Value;
  let value: Value;
  if (["s", "inlineStr", "str"].includes(cell.attributes.t ?? "")) value = cell.text;
  else if (cell.attributes.t === "b") value = cell.value === null ? null : cell.value === "1";
  else value = cell.value;
  if (cell.formula && (value === null || value === "")) return { formula: "[source formula; no cached result]" };
  return value;
}
function rowValues(row: RawRow): Value[] {
  const values: Value[] = [];
  for (const cell of row.cells) {
    const address = cell.attributes.r?.match(/^([A-Z]+)([1-9]\d*)$/);
    if (!address) throw new ImportError("Исходная ячейка без корректного адреса: интерпретация остановлена.");
    const column = [...address[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    if (column > 250) throw new ImportError("Источник превышает лимит интерпретации 250 столбцов; оригинал сохранён.");
    if (column in values) throw new ImportError("Повтор адреса ячейки в исходной строке: интерпретация остановлена.");
    values[column] = sourceCellValue(cell);
  }
  return values;
}
function context(supplier: Supplier): Context {
  return { data: emptySupplier(supplier), products: new Map(), kinds: new Set(), sales: new Map(), stock: new Set(), moq: new Map(), transit: new Map(), transitRows: new Map(), current: new Set(), errors: new Map() };
}

/** Consume ordered PostgreSQL projections. No XLSX bytes, filesystem access or source mutations.
 * Caller supplies deterministic filename/sheet ordinal/row ordinal order. Mapping rules select
 * recognised planning fields; skipped/duplicate business rows remain intact in the source tables.
 */
export async function mapSourceWorkbooks(books: Iterable<SourceMappingWorkbook> | AsyncIterable<SourceMappingWorkbook>, options: ImportOptions = {}): Promise<DatasetInput> {
  const cutoff = options.cutoffDate ?? "2026-09-22";
  if (parseDate(cutoff) !== cutoff) throw new ImportError("Дата среза должна быть в формате YYYY-MM-DD.");
  const dataset: DatasetInput = { name: options.name ?? "Данные поставщиков из PostgreSQL", synthetic: options.synthetic ?? false, cutoffDate: cutoff, suppliers: [], files: [] };
  const contexts = new Map<Supplier, Context>();
  const hashes = new Set<string>();
  for await (const book of books) {
    if (book.date1904) throw new ImportError("Система дат Excel 1904 пока не поддерживается интерпретацией; оригинал сохранён.");
    let ctx = contexts.get(book.supplier);
    if (!ctx) { ctx = context(book.supplier); contexts.set(book.supplier, ctx); }
    const hashKey = `${book.supplier}:${book.sha256}`;
    const bookSource: SourceRef = { file: book.filename, workbookId: book.id };
    if (hashes.has(hashKey)) { addIssue(ctx, "DUPLICATE_FILE", `${book.filename}: идентичный источник уже включён в интерпретацию.`, bookSource); continue; }
    hashes.add(hashKey);
    const kinds = new Set<Kind>();
    let rows = 0, parsedRows = 0;
    for await (const sheet of book.sheets) {
      let header: Header | null = null;
      for await (const row of sheet.rows) {
        if (++rows > 600000) throw new ImportError("Источник превышает лимит интерпретации 600 000 строк; оригинал сохранён.");
        const rowNumber = Number(row.attributes.r ?? row.ordinal);
        if (!Number.isSafeInteger(rowNumber) || rowNumber < 1) throw new ImportError("Исходная строка без корректного номера: интерпретация остановлена.");
        const values = rowValues(row);
        if (!header && rowNumber <= 20) {
          header = findHeader(values, book.filename);
          if (header) { kinds.add(header.kind); ctx.kinds.add(header.kind); }
          continue;
        }
        if (!header) continue;
        processRow(ctx, header, values, { ...bookSource, sheet: sheet.name, row: rowNumber }, cutoff);
        parsedRows++;
      }
    }
    if (!kinds.size) addIssue(ctx, "UNRECOGNIZED_WORKBOOK", `${book.filename}: не найдены поддерживаемые заголовки.`, bookSource, "error");
    dataset.files.push({ name: book.filename, hash: book.sha256, supplier: book.supplier, workbookId: book.id, kind: [...kinds].join(",") || "unknown", rows: parsedRows });
  }
  for (const ctx of contexts.values()) { finish(ctx, cutoff, SOURCE_MAPPING_VERSION); dataset.suppliers.push(ctx.data); }
  if (!dataset.suppliers.some(s => s.products.length)) throw new ImportError("Ни один источник не содержит распознанных строк товаров.");
  return dataset;
}
