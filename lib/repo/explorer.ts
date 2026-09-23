/** Read-only, bounded/paginated queries for the "Данные" explorer. Never loads a full dataset into memory. */
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { SOURCE_MAPPING_VERSION } from "@/lib/ingest/source-mapping";
import type { Product as ProductAttrs } from "@/lib/contracts/engine";

export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number }
export interface ProductRow { code: string; article: string; name: string; unit: string; category: string; moq: number | null; multiple: number | null; unitConversion: number | null; cost: number | null; growthRate: number | null }
export interface SaleRow { code: string; article: string; name: string; unit: string; month: string; quantity: number | null }
export interface StockRow { code: string; article: string; name: string; unit: string; month: string; quantity: number | null }
export interface TxnRow { code: string; article: string; name: string; unit: string; date: string; invoice: string; quantity: number; warehouse: string | null }
export interface DeliveryRow { code: string; article: string; name: string; unit: string; quantity: number; eta: string; orderDate: string | null; receivedDate: string | null }

function clampPage(page?: number) { const n = Math.floor(page ?? 0); return Number.isFinite(n) ? Math.max(0, n) : 0; }
function clampSize(pageSize?: number) { const n = Math.floor(pageSize ?? 50); return Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : 50; }

export interface ExplorerFilter { datasetId: string; supplier?: string; search?: string }

function searchFragment(search?: string) {
  const term = search?.trim();
  if (!term) return Prisma.empty;
  const pattern = `%${term.replace(/[%_]/g, c => `\\${c}`)}%`;
  return Prisma.sql`AND (p.code ILIKE ${pattern} OR p.article ILIKE ${pattern} OR p.name ILIKE ${pattern})`;
}
function supplierFragment(supplier?: string) { return supplier ? Prisma.sql`AND p.supplier = ${supplier}` : Prisma.empty; }

export async function listProducts(filter: ExplorerFilter, page?: number, pageSize?: number): Promise<Page<ProductRow>> {
  const db = getDb(); const p = clampPage(page), size = clampSize(pageSize);
  const term = filter.search?.trim();
  const where: Prisma.ProductWhereInput = {
    datasetId: filter.datasetId,
    ...(filter.supplier ? { supplier: filter.supplier } : {}),
    ...(term ? { OR: [{ code: { contains: term, mode: "insensitive" } }, { article: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }] } : {}),
  };
  const [total, products] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({ where, select: { code: true, article: true, name: true, unit: true, category: true, attributes: true }, orderBy: { code: "asc" }, skip: p * size, take: size }),
  ]);
  const rows = products.map(row => {
    const attrs = row.attributes as unknown as ProductAttrs;
    return { code: row.code, article: row.article, name: row.name, unit: row.unit, category: row.category, moq: attrs.moq ?? null, multiple: attrs.multiple ?? null, unitConversion: attrs.unitConversion ?? null, cost: attrs.cost ?? null, growthRate: attrs.growthRate ?? null };
  });
  return { rows, total, page: p, pageSize: size };
}

export async function listMonthlySales(filter: ExplorerFilter, page?: number, pageSize?: number): Promise<Page<SaleRow>> {
  const db = getDb(); const p = clampPage(page), size = clampSize(pageSize);
  const rows = await db.$queryRaw<(SaleRow & { total: bigint })[]>(Prisma.sql`
    SELECT p.code, p.article, p.name, p.unit, s.month, s.quantity, count(*) OVER() AS total
    FROM "Product" p CROSS JOIN LATERAL jsonb_to_recordset(p."monthlySales") AS s(month text, quantity double precision)
    WHERE p."datasetId" = ${filter.datasetId} ${supplierFragment(filter.supplier)} ${searchFragment(filter.search)}
    ORDER BY p.code, s.month LIMIT ${size} OFFSET ${p * size}`);
  return { rows: rows.map(r => ({ code: r.code, article: r.article, name: r.name, unit: r.unit, month: r.month, quantity: r.quantity })), total: rows[0] ? Number(rows[0].total) : 0, page: p, pageSize: size };
}

export async function listStockHistory(filter: ExplorerFilter, page?: number, pageSize?: number): Promise<Page<StockRow>> {
  const db = getDb(); const p = clampPage(page), size = clampSize(pageSize);
  const rows = await db.$queryRaw<(StockRow & { total: bigint })[]>(Prisma.sql`
    SELECT p.code, p.article, p.name, p.unit, s.month, s.quantity, count(*) OVER() AS total
    FROM "Product" p CROSS JOIN LATERAL jsonb_to_recordset(p."stockHistory") AS s(month text, quantity double precision)
    WHERE p."datasetId" = ${filter.datasetId} ${supplierFragment(filter.supplier)} ${searchFragment(filter.search)}
    ORDER BY p.code, s.month LIMIT ${size} OFFSET ${p * size}`);
  return { rows: rows.map(r => ({ code: r.code, article: r.article, name: r.name, unit: r.unit, month: r.month, quantity: r.quantity })), total: rows[0] ? Number(rows[0].total) : 0, page: p, pageSize: size };
}

export async function listTransactions(filter: ExplorerFilter, page?: number, pageSize?: number): Promise<Page<TxnRow>> {
  const db = getDb(); const p = clampPage(page), size = clampSize(pageSize);
  const rows = await db.$queryRaw<(TxnRow & { total: bigint })[]>(Prisma.sql`
    SELECT p.code, p.article, p.name, p.unit, t.date, t.invoice, t.quantity, t.warehouse, count(*) OVER() AS total
    FROM "Product" p CROSS JOIN LATERAL jsonb_to_recordset(p."transactions") AS t(date text, invoice text, quantity double precision, warehouse text)
    WHERE p."datasetId" = ${filter.datasetId} ${supplierFragment(filter.supplier)} ${searchFragment(filter.search)}
    ORDER BY t.date DESC, p.code LIMIT ${size} OFFSET ${p * size}`);
  return { rows: rows.map(r => ({ code: r.code, article: r.article, name: r.name, unit: r.unit, date: r.date, invoice: r.invoice, quantity: r.quantity, warehouse: r.warehouse })), total: rows[0] ? Number(rows[0].total) : 0, page: p, pageSize: size };
}

export interface RunHistoryOrder { supplier: string; status: string; revision: number; approver: string | null; approvedAt: string | null }
export interface RunHistoryEntry { id: string; datasetId: string; datasetName: string; synthetic: boolean; createdAt: string; baseRunId: string | null; scope: { supplier?: string; category?: string } | null; orders: RunHistoryOrder[] }

/** Read-only history listing for the "История расчётов" panel: adds dataset name/type and per-supplier order status on top of what /api/runs exposes, without recalculating anything. */
export async function listRunHistory(datasetId?: string): Promise<RunHistoryEntry[]> {
  const db = getDb();
  const runs = await db.run.findMany({
    where: { ...(datasetId ? { datasetId } : {}), dataset: { synthetic: false, parserVersion: SOURCE_MAPPING_VERSION } },
    select: {
      id: true, datasetId: true, createdAt: true, baseRunId: true, filter: true,
      dataset: { select: { name: true, synthetic: true } },
      orders: { select: { supplier: true, status: true, revision: true, approver: true, approvedAt: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return runs.map(r => ({
    id: r.id, datasetId: r.datasetId, datasetName: r.dataset.name, synthetic: r.dataset.synthetic,
    createdAt: r.createdAt.toISOString(), baseRunId: r.baseRunId,
    scope: (r.filter as { supplier?: string; category?: string } | null) ?? null,
    orders: r.orders.map(o => ({ supplier: o.supplier, status: o.status, revision: o.revision, approver: o.approver, approvedAt: o.approvedAt?.toISOString() ?? null })),
  }));
}

export async function listDeliveries(filter: ExplorerFilter, page?: number, pageSize?: number): Promise<Page<DeliveryRow>> {
  const db = getDb(); const p = clampPage(page), size = clampSize(pageSize);
  const rows = await db.$queryRaw<(DeliveryRow & { total: bigint })[]>(Prisma.sql`
    SELECT p.code, p.article, p.name, p.unit, d.quantity, d.eta, d."orderDate", d."receivedDate", count(*) OVER() AS total
    FROM "Product" p CROSS JOIN LATERAL jsonb_to_recordset(p."deliveries") AS d(quantity double precision, eta text, "orderDate" text, "receivedDate" text)
    WHERE p."datasetId" = ${filter.datasetId} ${supplierFragment(filter.supplier)} ${searchFragment(filter.search)}
    ORDER BY d.eta, p.code LIMIT ${size} OFFSET ${p * size}`);
  return { rows: rows.map(r => ({ code: r.code, article: r.article, name: r.name, unit: r.unit, quantity: r.quantity, eta: r.eta, orderDate: r.orderDate, receivedDate: r.receivedDate })), total: rows[0] ? Number(rows[0].total) : 0, page: p, pageSize: size };
}
