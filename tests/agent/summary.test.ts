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
