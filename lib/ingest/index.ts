import ExcelJS from "exceljs";
import JSZip from "jszip";
import { StringDecoder } from "node:string_decoder";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Readable } from "node:stream";
import type { DatasetInput, ImportIssue, Product, SourceRef, Supplier, SupplierInput } from "../contracts/engine";

export const PARSER_VERSION = "apollon-xlsx-1.0.0";
export const MAX_WORKBOOK_BYTES = 30 * 1024 * 1024;
export interface WorkbookFile { name: string; buffer: Buffer; supplier?: Supplier }
export interface ImportOptions { name?: string; synthetic?: boolean; cutoffDate?: string }
export class ImportError extends Error {
  constructor(message: string) { super(message); this.name = "ImportError"; }
}
export type Value = ExcelJS.CellValue | undefined;
export type Kind = "sales" | "stock" | "transactions" | "moq" | "transit" | "seasonality" | "supplement";
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** ExcelJS 4.4 streaming decodes each buffer separately, splitting Cyrillic UTF-8.
 * The narrow instance-local adapter preserves decoder state (no global patch),
 * and preloads workbook metadata for ZIPs that place workbook.xml after sheets.
 * Integration tests exercise both failures; review this shim on ExcelJS upgrades.
 */
async function readerFor(buffer: Buffer) {
  const archive = await JSZip.loadAsync(buffer);
  let inflatedBytes = 0;
  archive.forEach((_, entry) => {
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0;
    inflatedBytes += size;
  });
  if (inflatedBytes > 350 * 1024 * 1024) throw new ImportError("Распакованный XLSX превышает лимит 350 МБ.");
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), { worksheets: "emit", sharedStrings: "cache", styles: "cache", hyperlinks: "ignore", entries: "ignore" });
  interface Internals {
    _parseSharedStrings: (entry: Readable) => AsyncGenerator<unknown>;
    _parseWorksheet: (entry: AsyncIterable<Buffer | string>, id: string) => AsyncGenerator<unknown>;
    _parseWorkbook: (entry: Readable) => Promise<void>;
    _parseStyles: (entry: Readable) => Promise<void>;
  }
  const internal = reader as unknown as Internals;
  const strings = internal._parseSharedStrings.bind(reader);
  const worksheet = internal._parseWorksheet.bind(reader);
  async function* decode(entry: AsyncIterable<Buffer | string>) {
    const decoder = new StringDecoder("utf8");
    for await (const chunk of entry) yield typeof chunk === "string" ? chunk : decoder.write(chunk);
    const tail = decoder.end(); if (tail) yield tail;
  }
  internal._parseWorksheet = (entry, id) => worksheet(decode(entry), id);
  const metadata = archive.file("xl/workbook.xml");
  if (!metadata) throw new ImportError("XLSX не содержит xl/workbook.xml.");
  await internal._parseWorkbook(Readable.from([await metadata.async("string")]));
  const sharedStrings = archive.file("xl/sharedStrings.xml");
  if (sharedStrings) {
    for await (const event of strings(Readable.from([await sharedStrings.async("string")]))) void event;
    internal._parseSharedStrings = async function* (entry) { for await (const chunk of entry) void chunk; };
  }
  const styles = archive.file("xl/styles.xml");
  if (styles) await internal._parseStyles(Readable.from([await styles.async("string")]));
  return reader;
}

/** Cached formula results only: ExcelJS does not calculate Excel expressions. */
export function scalar(value: Value): string | number | Date | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || value instanceof Date) return value;
  if ("result" in value) return scalar(value.result);
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value) return value.text;
  return null;
}
export function parseNumber(value: Value): number | null {
  const v = scalar(value);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const clean = v.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(clean)) return null;
  const n = Number(clean.replace("%", ""));
  return Number.isFinite(n) ? n / (clean.endsWith("%") ? 100 : 1) : null;
}
function str(value: Value): string { const v = scalar(value); return v === null ? "" : String(v).trim(); }
function norm(value: Value): string { return str(value).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " "); }
export function parseMonth(value: Value): string | null {
  const v = scalar(value);
  if (v instanceof Date) return v.toISOString().slice(0, 7);
  if ((typeof v === "number" || typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v)) && Number(v) > 30000 && Number(v) < 80000) return parseDate(value)?.slice(0, 7) ?? null;
  const text = norm(value);
  const iso = text.match(/^(20\d{2})-(0[1-9]|1[0-2])(?:-\d{2})?$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const year = text.match(/20\d{2}/)?.[0];
  const m = MONTHS.findIndex((prefix) => text.startsWith(prefix) || (prefix === "май" && text.startsWith("мая")));
  return year && m >= 0 ? `${year}-${String(m + 1).padStart(2, "0")}` : null;
}
export function parseDate(value: Value, defaultYear?: number): string | null {
  const v = scalar(value);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if ((typeof v === "number" || typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v)) && Number(v) > 30000 && Number(v) < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v) * 86400000)).toISOString().slice(0, 10);
  if (typeof v !== "string") return null;
  const iso = v.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const ru = v.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(20\d{2}))?\b/);
  const words = v.toLowerCase().match(/\b(\d{1,2})\s+([а-я]+)\s+(20\d{2})/);
  let year: number, month: number, day: number;
  if (iso) [, year, month, day] = iso.map(Number);
  else if (ru && (ru[3] || defaultYear)) { year = Number(ru[3] || defaultYear); month = Number(ru[2]); day = Number(ru[1]); }
  else if (words) { year = Number(words[3]); month = MONTHS.findIndex((prefix) => words[2].startsWith(prefix) || (prefix === "май" && words[2] === "мая")) + 1; day = Number(words[1]); }
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}
export function guessSupplier(name: string): Supplier | undefined {
  if (/system|syseme|систем|сэ|(?:^|[/ _-])se(?:[/ _.-]|$)/i.test(name)) return "SE";
  if (/iek|иэк/i.test(name)) return "IEK";
  // These are the two original IEK export names without an explicit supplier.
  if (/Динамика продаж_2025-2026|Ежемесячные продажи в количественном выражении за последние 2 года/i.test(name)) return "IEK";
}
export function emptySupplier(supplier: Supplier): SupplierInput {
  return { supplier, products: [], sales: [], stocks: [], currentStock: [], transactions: [], deliveries: [], stockouts: [], seasonality: Array(12).fill(1), issues: [] };
}
export interface Context {
  data: SupplierInput; products: Map<string, Product>; kinds: Set<Kind>;
  sales: Map<string, { index: number; priority: number }>; stock: Set<string>;
  moq: Map<string, string>; transit: Map<string, string>; current: Set<string>;
  transitRows: Map<string, string>;
  errors: Map<string, number>;
}
export function addIssue(ctx: Context, code: string, message: string, source?: SourceRef, severity: ImportIssue["severity"] = "warning") {
  const count = ctx.errors.get(code) || 0;
  ctx.errors.set(code, count + 1);
  // Keep detailed first 100 examples per class, with a complete aggregate count below.
  if (count < 100) ctx.data.issues.push({ severity, code, message, supplier: ctx.data.supplier, source });
}
function numberProblem(value: Value): string {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if ("error" in value) return `ошибка Excel ${value.error || "(тип error без значения)"}`;
    if ("result" in value && value.result !== undefined && value.result !== null) return numberProblem(value.result);
    if ("formula" in value || "sharedFormula" in value) return "формула без сохранённого вычисленного значения";
  }
  return str(value) ? "значение не является числом" : "пустая ячейка";
}
export function sourceColumn(source: SourceRef, column: number): SourceRef {
  let letters = "", n = column;
  while (n > 0) { n--; letters = String.fromCharCode(65 + n % 26) + letters; n = Math.floor(n / 26); }
  return column > 0 && source.row ? { ...source, cell: `${letters}${source.row}` } : source;
}
function numeric(ctx: Context, value: Value, source: SourceRef, field: string): number | null {
  const n = parseNumber(value);
  if (n === null && value && typeof value === "object" && "error" in value && !value.error) {
    addIssue(ctx, "EMPTY_ERROR_CELL", `${field}: в источнике указан тип Excel error, но код ошибки и значение отсутствуют. Значение для расчёта неизвестно.`, source, "info");
    return null;
  }
  if (n === null && (str(value) !== "" || typeof value === "object" && value !== null && !(value instanceof Date))) {
    addIssue(ctx, "INVALID_NUMBER", `${field}: ${numberProblem(value)}. Значение для расчёта неизвестно.`, source);
  }
  return n;
}
export interface Header { kind: Kind; columns: Value[]; code: number; name: number; unit: number; article: number; months: { col: number; month: string }[] }
export function findHeader(values: Value[], filename: string): Header | null {
  const texts = values.map(norm);
  const find = (r: RegExp) => texts.findIndex((s) => r.test(s));
  const code = find(/^(номенклатура\.код|код\s*1[сc]|код|internal_code)$/);
  const name = find(/^(номенклатура|наименование)$/);
  const unit = find(/^(ед\.?\s*(изм\.?)?|единица|unit)$/);
  const article = find(/^артикул/);
  const months = values.flatMap((v, col) => { const month = parseMonth(v); return month ? [{ col, month }] : []; });
  let kind: Kind;
  if (code >= 0 && find(/^дата$/) >= 0 && find(/^документ$/) >= 0) kind = "transactions";
  else if (code >= 0 && find(/^(stockout_start|unit_conversion|current_stock)$/) >= 0) kind = "supplement";
  else if (code >= 0 && find(/свободный остаток|поступление до|в пути \d/) >= 0) kind = "transit";
  else if (code >= 0 && months.length) kind = /остат/i.test(filename) || unit >= 0 ? "stock" : "sales";
  else if (code >= 0 && find(/^кратность$|мин.*отгр|^moq$/) >= 0) kind = "moq";
  else if (find(/^год$/) >= 0 && texts.some((v) => v === "янв")) kind = "seasonality";
  else return null;
  return { kind, columns: values, code, name, unit, article, months };
}
function col(header: Header, re: RegExp): number { return header.columns.findIndex((v) => re.test(norm(v))); }
function product(ctx: Context, code: string, row: Value[], h: Header, source: SourceRef): Product {
  let p = ctx.products.get(code);
  if (!p) {
    p = { code, name: str(row[h.name]) || code, supplierArticle: "", unit: "", category: "unknown", source };
    ctx.products.set(code, p);
  }
  if (h.name >= 0 && str(row[h.name]) && (p.name === code || h.kind === "sales" || h.kind === "transit")) p.name = str(row[h.name]);
  if (h.unit >= 0 && str(row[h.unit])) p.unit = str(row[h.unit]);
  if (h.article >= 0 && str(row[h.article]) && (h.kind === "moq" || !p.supplierArticle)) p.supplierArticle = str(row[h.article]);
  return p;
}
function addSales(ctx: Context, code: string, month: string, quantity: number | null, source: SourceRef, priority: number) {
  const key = `${code}\0${month}`, old = ctx.sales.get(key);
  if (old) {
    if (old.priority === priority) { addIssue(ctx, "DUPLICATE_SALES", `${code}, ${month}: повторная месячная строка; сохранена первая.`, source); return; }
    if (old.priority > priority) return;
    ctx.data.sales[old.index] = { code, month, quantity, source }; old.priority = priority;
  } else {
    ctx.sales.set(key, { index: ctx.data.sales.length, priority }); ctx.data.sales.push({ code, month, quantity, source });
  }
}
export function processRow(ctx: Context, h: Header, row: Value[], source: SourceRef, cutoff: string) {
  if (h.kind === "seasonality") {
    const monthIndex = MONTHS.findIndex((m) => norm(row[2]).startsWith(m));
    const coefficient = parseNumber(row[12]);
    if (monthIndex >= 0 && coefficient !== null) addIssue(ctx, "SUPPLIED_SEASONAL_COEFFICIENT", `${MONTHS[monthIndex]}: предоставленный коэффициент ${coefficient}; денежный / неуточнённый профиль, только для сравнения.`, source, "info");
    const year = parseNumber(row[col(h, /^год$/)]);
    if (year === null || year >= Number(cutoff.slice(0, 4))) return;
    const totals = MONTHS.map((month) => parseNumber(row[col(h, new RegExp(`^${month}$`))]));
    if (totals.every((n) => n !== null && n >= 0)) {
      addIssue(ctx, "SUPPLIED_SEASONALITY", `Денежные / неуточнённые итоги ${year}: ${totals.join(", ")}. Только для сравнения; сезонность прогноза пересчитывается из единиц на дату среза.`, source, "info");
    }
    return;
  }
  const code = str(row[h.code]);
  if (!code || /^(итого|всего|номенклатура\.код|код\s*1[сc])$/i.test(code) || /^(итого|всего)$/i.test(str(row[h.name]))) return;
  if (h.kind === "transit") {
    const key = `${source.file}\0${source.sheet}\0${code}`, signature = JSON.stringify(row.map(scalar));
    if (ctx.transitRows.has(key)) {
      addIssue(ctx, ctx.transitRows.get(key) === signature ? "DUPLICATE_TRANSIT_ROW" : "CONFLICTING_TRANSIT_ROW", `${code}: повтор строки в пути; сохранена первая, повтор не суммируется.`, source);
      return;
    }
    ctx.transitRows.set(key, signature);
  }
  const p = product(ctx, code, row, h, source);
  if (h.kind === "sales" || h.kind === "stock" || h.kind === "transit") {
    for (const { col: c, month } of h.months) {
      const quantity = numeric(ctx, row[c], sourceColumn(source, c), month);
      if (h.kind === "stock") {
        const key = `${code}\0${month}`;
        if (ctx.stock.has(key)) { addIssue(ctx, "DUPLICATE_STOCK", `${code}, ${month}: повторный остаток; сохранён первый.`, source); continue; }
        ctx.stock.add(key); ctx.data.stocks.push({ code, month, quantity, source });
        if (quantity !== null && quantity < 0) addIssue(ctx, "NEGATIVE_STOCK", `${code}: отрицательный начальный остаток ${quantity} в ${month}.`, source);
      } else addSales(ctx, code, month, quantity, source, h.kind === "sales" ? 2 : 1);
    }
  }
  if (h.kind === "sales") {
    const multiple = parseNumber(row[col(h, /^кратность$/)]);
    if (!ctx.moq.has(code) && multiple !== null && multiple > 0) p.multiple = multiple;
  }
  if (h.kind === "moq") {
    const signature = `${str(row[h.article])}\0${str(row[col(h, /^кратность$|мин.*отгр|^moq$/)])}`;
    if (ctx.moq.has(code)) { addIssue(ctx, ctx.moq.get(code) === signature ? "DUPLICATE_MOQ" : "CONFLICTING_MOQ", `${code}: повтор MOQ; сохранена первая запись.`, source); return; }
    ctx.moq.set(code, signature);
    const quantityCol = col(h, /^кратность$|мин.*отгр|^moq$/);
    const quantity = parseNumber(row[quantityCol]);
    if (quantity !== null && quantity > 0) {
      if (col(h, /^кратность$/) >= 0) { p.multiple = quantity; p.moq = quantity; }
      else p.moq = quantity;
    } else addIssue(ctx, "UNKNOWN_MOQ", `${code}: MOQ/кратность — ${quantity === null ? numberProblem(row[quantityCol]) : "неположительное значение"}. Значение для расчёта неизвестно.`, sourceColumn(source, quantityCol));
  }
  if (h.kind === "transactions") {
    const document = str(row[col(h, /^документ$/)]);
    if (!/^Расходная накладная(?:\s|$)/i.test(document)) { addIssue(ctx, "NON_SALES_DOCUMENT", `${code}: документ не является расходной накладной; исключён.`, source, "info"); return; }
    const date = parseDate(row[col(h, /^дата$/)]), quantity = numeric(ctx, row[col(h, /^количество$/)], sourceColumn(source, col(h, /^количество$/)), "Количество"), invoice = str(row[col(h, /^номер$/)]);
    if (!date || quantity === null || !invoice) { addIssue(ctx, "INVALID_TRANSACTION", `${code}: нет корректной даты, количества или номера накладной.`, source); return; }
    if (date > cutoff) { addIssue(ctx, "AFTER_CUTOFF", `${code}: накладная ${date} позднее среза ${cutoff}; исключена.`, source, "info"); return; }
    const customerId = str(row[col(h, /^anonymized_customer_id$/)]);
    ctx.data.transactions.push({ code, date, quantity, invoice, warehouse: str(row[col(h, /^склад$/)]) || undefined, customerId: customerId || undefined, source });
  }
  if (h.kind === "transit") {
    const reportDate = parseDate(source.file) || cutoff;
    const category = str(row[col(h, /^категория/)]); if (category) p.category = category;
    const cost = parseNumber(row[col(h, /^сс реал$/)]); if (cost !== null) p.cost = cost;
    const growth = parseNumber(row[col(h, /^к[эо]ф\. роста$/)]); if (growth !== null) p.growthRate = growth;
    const freeCol = col(h, /^свободный остаток$/);
    if (freeCol >= 0 && !ctx.current.has(code)) {
      ctx.current.add(code);
      ctx.data.currentStock.push({ code, date: reportDate, available: numeric(ctx, row[freeCol], sourceColumn(source, freeCol), "Свободный остаток"), reserved: parseNumber(row[col(h, /^зарезервировано$/)]) ?? undefined, kind: "current", source });
    }
    if (/закупаются бухтами/i.test(p.name)) addIssue(ctx, "UNIT_CONVERSION_REQUIRED", `${code}: закупка бухтами, остатки метрами. Коэффициент не выводится из названия; нужен явный unit_conversion.`, source);
    h.columns.forEach((header, index) => {
      if (!/поступление до|в пути \d/i.test(str(header))) return;
      const quantity = numeric(ctx, row[index], sourceColumn(source, index), "В пути");
      if (quantity === null || quantity === 0) return;
      const etaText = str(header).split(/поступление до/i).at(-1)!;
      const eta = parseDate(etaText, Number(reportDate.slice(0, 4)));
      const orderDate = parseDate(str(header).split(/поступление до/i)[0]) || undefined;
      if (!eta || quantity < 0) { addIssue(ctx, "INVALID_DELIVERY", `${code}: некорректное количество или ETA; поставка исключена.`, source); return; }
      const key = `${source.file}\0${source.sheet}\0${code}\0${index}`;
      const signature = String(quantity);
      if (ctx.transit.has(key)) { addIssue(ctx, ctx.transit.get(key) === signature ? "DUPLICATE_DELIVERY" : "CONFLICTING_DELIVERY", `${code}: повтор ячейки одной поставки; сохранена первая.`, source); return; }
      ctx.transit.set(key, signature);
      ctx.data.deliveries.push({ code, eta, orderDate, quantity, source });
      if (eta < cutoff) addIssue(ctx, "OVERDUE_DELIVERY", `${code}: ETA ${eta} в прошлом, подтверждения приёмки нет. Остаток не увеличивается.`, source);
    });
  }
  if (h.kind === "supplement") {
    const conversion = numeric(ctx, row[col(h, /^unit_conversion$/)], sourceColumn(source, col(h, /^unit_conversion$/)), "unit_conversion");
    if (conversion !== null && conversion > 0) p.unitConversion = conversion;
    const start = parseDate(row[col(h, /^stockout_start$/)]), end = parseDate(row[col(h, /^stockout_end$/)]);
    if (start && end && start <= end) ctx.data.stockouts.push({ code, start, end, confirmed: true });
    const current = parseNumber(row[col(h, /^current_stock$/)]), date = parseDate(row[col(h, /^snapshot_date$/)]);
    if (current !== null && date && date <= cutoff) {
      ctx.data.currentStock = ctx.data.currentStock.filter((s) => s.code !== code || s.date !== date);
      ctx.data.currentStock.push({ code, date, available: current, kind: "current", source });
    }
  }
}

export function finish(ctx: Context, cutoff: string, version = PARSER_VERSION) {
  const d = ctx.data;
  d.products = [...ctx.products.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const kind of ["sales", "stock", "transactions", "moq", "transit", "seasonality"] as Kind[]) {
    if (!ctx.kinds.has(kind)) addIssue(ctx, "MISSING_SOURCE", `Не загружен источник ${kind}; расчёт будет предварительным.`);
  }
  const salesCodes = new Set(d.sales.map((s) => s.code));
  const moqMissing = [...salesCodes].filter((code) => !ctx.moq.has(code));
  if (moqMissing.length) addIssue(ctx, "MISSING_MOQ", `Нет отдельного MOQ для ${moqMissing.length} SKU с продажами. Первые коды: ${moqMissing.slice(0, 10).join(", ")}.`);
  const currentCodes = new Set(d.currentStock.filter((s) => s.available !== null).map((s) => s.code));
  const stockMissing = [...salesCodes].filter((code) => !currentCodes.has(code));
  if (stockMissing.length) addIssue(ctx, "MISSING_CURRENT_STOCK", `Нет измеренного текущего остатка для ${stockMissing.length} SKU с продажами. Доступны только предварительные оценки из начального остатка.`);
  for (const p of d.products) if (!p.unit) { p.unit = "unknown"; addIssue(ctx, "MISSING_UNIT", `${p.code}: единица измерения отсутствует; нельзя объединять с штуками или метрами.`, p.source); }
  const txTotals = new Map<string, number>();
  for (const tx of d.transactions) {
    const key = `${tx.code}\0${tx.date.slice(0, 7)}`;
    txTotals.set(key, (txTotals.get(key) || 0) + tx.quantity);
  }
  let compared = 0, exact = 0, within5 = 0;
  for (const sale of d.sales) {
    if (sale.month < "2025-01" || sale.month >= cutoff.slice(0, 7) || sale.quantity === null) continue;
    const txn = txTotals.get(`${sale.code}\0${sale.month}`);
    if (txn === undefined) continue;
    compared++;
    if (Math.abs(txn - sale.quantity) < 1e-8) exact++;
    if (Math.abs(txn - sale.quantity) / Math.max(1, Math.abs(sale.quantity)) <= 0.05) within5++;
    else addIssue(ctx, "RECONCILIATION_MISMATCH", `${sale.code}, ${sale.month}: месячный отчёт ${sale.quantity}, накладные ${txn}. Приоритет у месячного отчёта; источники не суммируются.`, sale.source);
  }
  addIssue(ctx, "RECONCILIATION_SUMMARY", `Сверка SKU×месяц: ${compared} пар, ${exact} точных совпадений, ${within5} в пределах 5%. Месячные продажи — источник прогноза; накладные — детализация.`, undefined, "info");
  if (d.supplier === "SE" && ctx.kinds.has("transit")) addIssue(ctx, "LEGACY_13_MONTH_FORMULA", "В исходном TDSheet «последние 12 мес» охватывает 13 месяцев / 12. Готовые средние и сезонные формулы не используются. Свободный остаток уже за вычетом резерва; рост — ratio − 1.", undefined, "info");
  addIssue(ctx, "STOCK_BLANK_POLICY", "Пустые остатки сохранены как неизвестные. Движок может оценивать их как нулевые только внутри активного периода SKU; это оценка, не измеренный stockout.", undefined, "info");
  addIssue(ctx, "PARSER_VERSION", `Интерпретация ${version}. Формулы читаются только по сохранённому результату; оригинальные данные не изменяются.`, undefined, "info");
  for (const [code, count] of ctx.errors) if (count > 100) d.issues.push({ severity: "info", code: `${code}_COUNT`, message: `Всего ${count} событий ${code}; показаны первые 100 примеров.`, supplier: d.supplier });
}

/** Sequential streaming bounds XLSX parser memory even for the 171k-row partner export. */
export async function parseWorkbooks(files: WorkbookFile[], options: ImportOptions = {}): Promise<DatasetInput> {
  if (!files.length) throw new ImportError("Выберите хотя бы один файл .xlsx.");
  const cutoff = options.cutoffDate || "2026-09-22";
  if (parseDate(cutoff) !== cutoff) throw new ImportError("Дата среза должна быть в формате YYYY-MM-DD.");
  const dataset: DatasetInput = { name: options.name || (options.synthetic ? "Демонстрационные данные (синтетические)" : "Загруженные данные"), synthetic: !!options.synthetic, cutoffDate: cutoff, suppliers: [], files: [] };
  const contexts = new Map<Supplier, Context>();
  const hints = new Set(files.map((f) => f.supplier || guessSupplier(f.name)).filter(Boolean));
  const seenHashes = new Set<string>();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (/(?:^|[/\\])~\$/.test(file.name)) continue;
    if (!/\.xlsx$/i.test(file.name)) throw new ImportError(`${file.name}: поддерживаются только файлы .xlsx.`);
    if (file.buffer.length > MAX_WORKBOOK_BYTES) throw new ImportError(`${file.name}: максимальный размер одного файла — 30 МБ.`);
    const supplier = file.supplier || guessSupplier(file.name) || (hints.size === 1 ? [...hints][0] : undefined);
    if (!supplier) throw new ImportError(`${file.name}: поставщик не определён. Выберите IEK или SE при загрузке.`);
    let ctx = contexts.get(supplier);
    if (!ctx) { ctx = { data: emptySupplier(supplier), products: new Map(), kinds: new Set(), sales: new Map(), stock: new Set(), moq: new Map(), transit: new Map(), transitRows: new Map(), current: new Set(), errors: new Map() }; contexts.set(supplier, ctx); }
    const hash = createHash("sha256").update(PARSER_VERSION).update("\0").update(file.buffer).digest("hex");
    if (seenHashes.has(`${supplier}:${hash}`)) { addIssue(ctx, "DUPLICATE_FILE", `${file.name}: идентичный файл уже загружен; повтор пропущен.`, { file: file.name }); continue; }
    seenHashes.add(`${supplier}:${hash}`);
    let rows = 0, parsedRows = 0;
    const kinds = new Set<Kind>();
    try {
      const reader = await readerFor(file.buffer);
      for await (const sheet of reader) {
        let header: Header | null = null;
        for await (const row of sheet) {
          rows++;
          if (rows > 600000) throw new ImportError(`${file.name}: слишком много строк (лимит 600 000).`);
          const values = row.values as Value[];
          if (values.length > 250) throw new ImportError(`${file.name}: слишком много столбцов (лимит 250).`);
          if (!header && row.number <= 20) {
            header = findHeader(values, file.name);
            if (header) { kinds.add(header.kind); ctx.kinds.add(header.kind); }
            continue;
          }
          if (!header) continue;
          processRow(ctx, header, values, { file: file.name, sheet: (sheet as unknown as { name: string }).name, row: row.number }, cutoff);
          parsedRows++;
        }
      }
      if (!kinds.size) addIssue(ctx, "UNRECOGNIZED_WORKBOOK", `${file.name}: не найдены поддерживаемые заголовки.`, { file: file.name }, "error");
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError(`${file.name}: файл повреждён, зашифрован или не является корректным XLSX. ${error instanceof Error ? error.message.slice(0, 120) : ""}`);
    }
    dataset.files.push({ name: file.name, hash, supplier, kind: [...kinds].join(",") || "unknown", rows: parsedRows });
  }
  for (const ctx of contexts.values()) { finish(ctx, cutoff); dataset.suppliers.push(ctx.data); }
  if (!dataset.suppliers.some((s) => s.products.length)) throw new ImportError("Ни один файл не содержит распознанных строк товаров. Проверьте шаблон и заголовки.");
  return dataset;
}

export async function readDirectory(directory: string, options: ImportOptions = {}): Promise<DatasetInput> {
  const files: WorkbookFile[] = [];
  async function visit(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (/\.xlsx$/i.test(entry.name)) files.push({ name: relative(directory, full), buffer: await readFile(full) });
    }
  }
  await visit(directory);
  return parseWorkbooks(files, options);
}
