import { describe, expect, it, vi } from "vitest";
import { OutputGuardrailTripwireTriggered, Usage, type Model, type ModelResponse } from "@openai/agents";
import { summarizeSku } from "../../lib/agent/summary";
import { calculatePlan } from "../../lib/engine";
import { makeEngineFixture } from "../fixtures/engine";

function modelReturning(text: string) {
  const response: ModelResponse = { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] };
  const getResponse = vi.fn(async (request: unknown) => { void request; return response; });
  const model: Model = { getResponse, async *getStreamedResponse() { throw new Error("not used"); } };
  return { model, getResponse };
}

describe("SKU summary agent", () => {
  const rec = calculatePlan(makeEngineFixture({ spike: true, customer: true })).recommendations[0];

  it("sends only calculated aggregates and returns the model text", async () => {
    const { model, getResponse } = modelReturning("  Рекомендуется заказать 6 шт.  ");
    await expect(summarizeSku(rec, { model, tracingDisabled: true })).resolves.toBe("Рекомендуется заказать 6 шт.");
    const input = (getResponse.mock.calls[0][0] as { input: { role: string; content: string | { text: string }[] }[] }).input;
    const user = input.find(item => item.role === "user")!;
    const payload = JSON.parse(typeof user.content === "string" ? user.content : user.content[0].text) as Record<string, unknown>;
    expect(payload.key).toBe(rec.key);
    for (const field of ["history", "projection", "anomalies", "transactions", "customerId"]) expect(payload).not.toHaveProperty(field);
  });

  it("blocks a summary that claims the order was approved or sent", async () => {
    const { model } = modelReturning("Заказ отправлен поставщику.");
    await expect(summarizeSku(rec, { model, tracingDisabled: true })).rejects.toBeInstanceOf(OutputGuardrailTripwireTriggered);
  });
});

describe("dataset and checks insights", () => {
  it("builds aggregate dataset facts without rows, customers or invoices", async () => {
    const { datasetFacts } = await import("../../lib/agent/summary");
    const dataset = makeEngineFixture({ spike: true, customer: true });
    const facts = datasetFacts({ ...dataset, suppliers: dataset.suppliers.map(sup => ({ supplier: sup.supplier, productCount: sup.products.length, issues: [...sup.issues, { severity: "warning", message: "x" }, { severity: "warning", message: "x" }] })) });
    expect(facts.suppliers[0].products).toBe(dataset.suppliers[0].products.length);
    expect(facts.suppliers[0].topIssues[0]).toMatchObject({ message: "x", count: 2 });
    expect(JSON.stringify(facts)).not.toMatch(/customerId|"invoice"/);
  });
  it("summarises checks through the SDK and returns the model text", async () => {
    const { checksFacts, summarizeInsight } = await import("../../lib/agent/summary");
    const facts = checksFacts([{ id: "a", name: "MOQ", passed: true, details: "ok", values: {} }, { id: "b", name: "Сезонность", passed: false, details: "нет данных", values: {} }]);
    expect(facts).toMatchObject({ total: 2, passed: 1 });
    const { model } = modelReturning("Итог: 1 из 2.");
    await expect(summarizeInsight("checks", facts, { model, tracingDisabled: true })).resolves.toBe("Итог: 1 из 2.");
  });
});
