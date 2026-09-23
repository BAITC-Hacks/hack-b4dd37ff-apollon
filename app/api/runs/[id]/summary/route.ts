import { NextResponse } from "next/server";
import { OutputGuardrailTripwireTriggered } from "@openai/agents";
import { z } from "zod";
import { summarizeSku } from "@/lib/agent/summary";
import { getRun, AppError } from "@/lib/repo";
import { rejectCrossOrigin, readJson, rateLimit } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 60;
const bodySchema = z.object({ key: z.string().min(1).max(300) });
// Saved runs are immutable, so a summary per run+SKU can be reused across drawer openings.
const cache = new Map<string, string>();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    rejectCrossOrigin(request);
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "Резюме ИИ недоступно: OPENAI_API_KEY не настроен." }, { status: 503 });
    const { id } = await params;
    const { key } = bodySchema.parse(await readJson(request));
    const cacheKey = `${id}:${key}`;
    const cached = cache.get(cacheKey);
    if (cached) return NextResponse.json({ summary: cached });
    rateLimit(request, "sku-summary", 30, 60_000);
    const run = await getRun(id);
    const rec = run.result.recommendations.find(r => r.key === key);
    if (!rec) return NextResponse.json({ error: "Позиция не найдена в этом расчёте." }, { status: 404 });
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const timer = setTimeout(() => abort.abort(), 45_000);
    try {
      const summary = await summarizeSku(rec, { signal: abort.signal });
      if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, summary);
      return NextResponse.json({ summary });
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный запрос резюме." }, { status: 400 });
    if (error instanceof OutputGuardrailTripwireTriggered) return NextResponse.json({ error: "Резюме не прошло проверку и не показано." }, { status: 422 });
    console.error("SKU summary failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Не удалось получить резюме ИИ. Расчёт ниже от него не зависит." }, { status: 502 });
  }
}
