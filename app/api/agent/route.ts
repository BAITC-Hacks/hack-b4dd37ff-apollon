import { NextResponse } from "next/server";
import { InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered, ToolOutputGuardrailTripwireTriggered } from "@openai/agents";
import { z } from "zod";
import { createProcurementWorkflow, defaultAgentServices } from "@/lib/agent";
import { requestsPrivateCustomerData } from "@/lib/agent/guardrails";
import { rejectCrossOrigin, readJson, rateLimit } from "@/lib/http";
import { AppError } from "@/lib/repo";

export const runtime = "nodejs";
export const maxDuration = 300;
const requestSchema = z.object({ message: z.string().trim().min(1).max(6000), datasetId: z.string().min(1).max(200), runId: z.string().max(200).optional() });

export async function POST(request: Request) {
  try {
    rejectCrossOrigin(request);
    rateLimit(request, "agent", 10, 60_000);
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "ИИ-помощник недоступен: OPENAI_API_KEY не настроен. Расчёт, проверки и экспорт работают без ключа." }, { status: 503 });
    const body = requestSchema.parse(await readJson(request));
    if (requestsPrivateCustomerData(body.message)) return NextResponse.json({ error: "Помощник работает с агрегатами и не раскрывает персональные данные или личности клиентов." }, { status: 400 });
    const services = await defaultAgentServices();
    // Validate the active scope before starting an API request or a streaming response.
    const loadedDataset = await services.loadDataset(body.datasetId);
    if (body.runId && (await services.getRun(body.runId)).datasetId !== body.datasetId) return NextResponse.json({ error: "Расчёт относится к другому набору данных." }, { status: 400 });
    const { agent, runner } = createProcurementWorkflow(body, { ...services, loadDataset: async id => id === body.datasetId ? loadedDataset : services.loadDataset(id) });
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), { once: true });
    const timer = setTimeout(() => abort.abort(), 240000);
    try {
      const result = await runner.run(agent, body.message, { stream: true, maxTurns: 12, signal: abort.signal });
      // Buffer model text until the SDK output guardrail succeeds. An unsafe partial statement must never escape.
      for await (const event of result) { void event; }
      await result.completed;
      const finalText = result.finalOutput;
      if (typeof finalText !== "string" || !finalText.trim()) return NextResponse.json({ error: "Помощник не вернул ответ. Попробуйте уточнить вопрос." }, { status: 502 });
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) { for (const chunk of finalText.match(/.{1,160}/gsu) ?? []) controller.enqueue(encoder.encode(chunk)); controller.close(); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    } finally { clearTimeout(timer); }
  } catch (error) {
    // AppError covers rejectCrossOrigin (403), rateLimit (429), and dataset/run lookups (404/400):
    // each of those must reach the client with its real status, not fall through to the generic 502.
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Проверьте текст сообщения и выбранный набор данных." }, { status: 400 });
    if (error instanceof InputGuardrailTripwireTriggered) return NextResponse.json({ error: "Запрос заблокирован защитой персональных данных." }, { status: 400 });
    if (error instanceof OutputGuardrailTripwireTriggered || error instanceof ToolOutputGuardrailTripwireTriggered) return NextResponse.json({ error: "Ответ не прошёл проверку: утверждение заказа выполняется только менеджером в приложении." }, { status: 422 });
    // Never log SDK exception messages or request/response objects; they may contain tool payloads.
    console.error("Copilot request failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Помощник временно недоступен. Проверьте подключение API и попробуйте ещё раз; основной расчёт работает независимо." }, { status: 502 });
  }
}
