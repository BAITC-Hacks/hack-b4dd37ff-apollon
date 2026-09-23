import { getDb } from "@/lib/db";
import { AppError } from "@/lib/repo";
import { SOURCE_MAPPING_VERSION } from "@/lib/ingest/source-mapping";
import type { SupplierInput } from "@/lib/contracts/engine";
import { apiError } from "@/lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params, db = getDb();
    const d = await db.dataset.findUnique({ where: { id }, select: { name: true, synthetic: true, parserVersion: true, cutoffDate: true, files: true, suppliers: true } });
    if (!d) throw new AppError("Dataset not found", 404);
    if (d.synthetic || d.parserVersion !== SOURCE_MAPPING_VERSION) throw new AppError("Выберите актуальные данные кейса.", 410);
    // Summaries do not load the full transaction history into the application.
    const counts = await db.$queryRaw<{ supplier: string; category: string; products: number; transactions: number }[]>`
      SELECT supplier, category, count(*)::int AS products,
        coalesce(sum(jsonb_array_length(transactions)), 0)::int AS transactions
      FROM "Product" WHERE "datasetId" = ${id} GROUP BY supplier, category`;
    const suppliers = (d.suppliers as unknown as Pick<SupplierInput, "supplier" | "issues" | "seasonality">[]).map(s => {
      const rows = counts.filter(r => r.supplier === s.supplier);
      const missing = rows.filter(r => !r.category || r.category === "unknown").reduce((n, r) => n + r.products, 0);
      const productCount = rows.reduce((n, r) => n + r.products, 0);
      return { ...s, productCount, transactionCount: rows.reduce((n, r) => n + r.transactions, 0),
        categories: rows.map(r => r.category).sort(), categoryCoverage: { specified: productCount - missing, missing } };
    });
    return Response.json({ name: d.name, synthetic: false, cutoffDate: d.cutoffDate, files: d.files, suppliers });
  } catch (error) { return apiError(error); }
}
