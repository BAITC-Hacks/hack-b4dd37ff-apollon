import { z } from "zod";
import { calculatePlan } from "@/lib/engine";
import { runCaseChecks } from "@/lib/engine/checks";
import { listDatasets, loadDataset, AppError } from "@/lib/repo";
import { apiError, rateLimit } from "@/lib/http";
import type { Recommendation } from "@/lib/contracts/engine";

export const runtime = "nodejs";

export const quickTestQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  datasetId: z.string().min(1).max(200).optional(),
  supplier: z.enum(["IEK", "SE"]).optional(),
});

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const URGENCY_RANK: Record<Recommendation["urgency"], number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };

export async function GET(request: Request) {
  try {
    const started = Date.now();
    rateLimit(request, "quick-test", 10, 60_000);
    const parsed = quickTestQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw parsed.error;
    const { limit, datasetId, supplier } = parsed.data;

    const datasets = await listDatasets();
    if (!datasets.length) throw new AppError("Наборов данных нет. Запустите `npm run seed:sample`, чтобы загрузить синтетические данные.", 404);
    const summary = datasetId ? datasets.find((d) => d.id === datasetId) : datasets[0];
    if (!summary) throw new AppError("Набор данных не найден", 404);

    const dataset = await loadDataset(summary.id);
    const result = calculatePlan(dataset, {}, supplier ? { supplier } : {});
    const checks = runCaseChecks(dataset);
    const rows = result.recommendations;
    const byId = new Map(checks.map((c) => [c.id, c]));

    const mustHave = [
      { requirement: "1. Базовая потребность реагирует на входы (остаток, поставки, категория, рост)", id: "dataset-sensitivity" },
      { requirement: "2. Сезонность учтена в прогнозе спроса", id: "dataset-seasonality" },
      { requirement: "3. Упущенный спрос из дефицита восстановлен", id: "dataset-stockouts" },
      { requirement: "4. Разовые продажи исключены из базовой нормы", id: "dataset-anomaly" },
      { requirement: "5. Заказ прозрачен, объяснён и разделён по поставщику", id: "dataset-provenance" },
    ].map(({ requirement, id }) => {
      const check = byId.get(id);
      return {
        requirement,
        passed: check?.passed ?? false,
        evidence: check ? { name: check.name, details: check.details, ...check.values } : { error: "check unavailable" },
      };
    });

    const bySupplierMap = new Map<string, { supplier: string; lines: number; positiveQty: number; critical: number; high: number; normal: number }>();
    for (const r of rows) {
      const entry = bySupplierMap.get(r.supplier) ?? { supplier: r.supplier, lines: 0, positiveQty: 0, critical: 0, high: 0, normal: 0 };
      entry.lines += 1;
      if (r.quantity > 0) entry.positiveQty += r.quantity;
      if (r.urgency === "CRITICAL") entry.critical += 1;
      else if (r.urgency === "HIGH") entry.high += 1;
      else entry.normal += 1;
      bySupplierMap.set(r.supplier, entry);
    }

    const top = rows
      .filter((r) => r.quantity > 0)
      .slice()
      .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || (a.firstShortageDate ?? "9999-99-99").localeCompare(b.firstShortageDate ?? "9999-99-99"))
      .slice(0, limit)
      .map((r) => ({
        supplier: r.supplier, code: r.code, name: r.name, unit: r.unit,
        quantity: r.quantity, urgency: r.urgency, confidence: r.confidence,
        coverDays: r.coverDays, firstShortageDate: r.firstShortageDate,
        why: truncate(r.explanation),
      }));

    const body = {
      dataset: { id: summary.id, name: summary.name, synthetic: summary.synthetic, cutoffDate: summary.cutoffDate, products: summary.productCount },
      computedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      mustHave,
      summary: {
        recommendations: rows.length,
        bySupplier: [...bySupplierMap.values()],
        allExplained: rows.every((r) => r.explanation.length > 0),
        allFinite: rows.every((r) => Number.isFinite(r.quantity) && r.quantity >= 0),
        excludedAnomalies: rows.reduce((n, r) => n + r.anomalies.filter((a) => a.excluded).length, 0),
        productsWithLostDemand: rows.filter((r) => r.provenance.lostDemand > 0).length,
      },
      top,
      note: "Read-only: computed live by the deterministic engine on every request; nothing is saved. Full workflow (edit/approve/export) is in the UI.",
    };

    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
