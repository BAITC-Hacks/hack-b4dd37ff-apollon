import { NextResponse } from "next/server";
import { OutputGuardrailTripwireTriggered } from "@openai/agents";
import { z } from "zod";
import { checksFacts, datasetFacts, summarizeInsight, type DatasetOverview } from "@/lib/agent/summary";
import { getDb } from "@/lib/db";
import { runCaseChecks } from "@/lib/engine/checks";
import { loadDataset, AppError } from "@/lib/repo";
import { rejectCrossOrigin, readJson, rateLimit } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;
const bodySchema = z.object({ kind: z.enum(["data", "checks"]), datasetId: z.string().min(1).max(200) });
// Datasets are immutable once materialised, so one summary per dataset and kind is reused.
const cache = new Map<string, string>();

/** AI summary of the active dataset ("data") or of the case checks ("checks"). Facts are computed here, never taken from the client. */
export async function POST(request: Request) {
  try {
    rejectCrossOrigin(request);
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Резюме ИИ недоступно: OPENAI_API_KEY не настроен." }, { status: 503 });
    const { kind, datasetId } = bodySchema.parse(await readJson(request));
    const cacheKey = `${kind}:${datasetId}`;
    const cached = cache.get(cacheKey);
    if (cached) return NextResponse.json({ summary: cached });
    rateLimit(request, "insight", 20, 60_000);
    const facts = kind === "data" ? datasetFacts(await datasetOverview(datasetId)) : checksFacts(runCaseChecks(await loadDataset(datasetId)));
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const summary = await summarizeInsight(kind, facts, { signal: abort.signal });
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, summary);
      return NextResponse.json({ summary });
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный запрос резюме." }, { status: 400 });
    if (error instanceof OutputGuardrailTripwireTriggered) return NextResponse.json({ error: "Резюме не прошло проверку и не показано." }, { status: 422 });
    console.error("Insight summary failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Не удалось получить резюме ИИ. Данные и проверки ниже от него не зависят." }, { status: 502 });
  }
}

/** Light read for the data summary: stored file manifest, import issues and product counts; no sales history is loaded. */
async function datasetOverview(id: string): Promise<DatasetOverview> {
  const db = getDb();
  const d = await db.dataset.findUnique({ where: { id }, select: { name: true, cutoffDate: true, files: true, suppliers: true } });
  if (!d) throw new AppError("Dataset not found", 404);
  const counts = await db.product.groupBy({ by: ["supplier"], where: { datasetId: id }, _count: { _all: true } });
  const suppliers = (d.suppliers as unknown as { supplier: string; issues?: DatasetOverview["suppliers"][number]["issues"] }[]).map(s => ({
    supplier: s.supplier, issues: s.issues ?? [], productCount: counts.find(c => c.supplier === s.supplier)?._count._all ?? 0,
  }));
  return { name: d.name, cutoffDate: String(d.cutoffDate).slice(0, 10), files: d.files as unknown as DatasetOverview["files"], suppliers };
}
