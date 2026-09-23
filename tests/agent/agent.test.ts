import { describe, expect, it, vi } from "vitest";
import { InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered, RunContext, Usage, type Model, type ModelResponse } from "@openai/agents";
import { createProcurementWorkflow, summarizeRecommendation, type AgentServices } from "../../lib/agent";
import { requestsPrivateCustomerData, claimsUnauthorizedAction } from "../../lib/agent/guardrails";
import { makeEngineFixture } from "../fixtures/engine";
import { calculatePlan } from "../../lib/engine";
import type { RunView } from "../../lib/contracts/api";

function setup() {
  const data = makeEngineFixture({ spike: true, customer: true });
  const result = calculatePlan(data);
  const run: RunView = { id: "run-current", datasetId: "dataset-active", createdAt: "2026-09-22", result, orders: [{ id: "order", supplier: "SE", revision: 0, status: "DRAFT", approver: null, approvedAt: null, quantities: { "SE:SYN-001": result.recommendations[0].quantity }, approvedKeys: [] }] };
  const services: AgentServices = { loadDataset: vi.fn(async () => data), getRun: vi.fn(async () => run), saveRun: vi.fn(async (_id, nextResult) => ({ ...run, id: "run-new", result: nextResult })) };
  return { data, result, run, services };
}

function response(text: string): ModelResponse {
  return { usage: new Usage(), output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] }] };
}
function scriptedModel(responses: ModelResponse[]) {
  const getResponse = vi.fn(async () => { const value = responses.shift(); if (!value) throw new Error("Unexpected model turn"); return value; });
  const model: Model = { getResponse, async *getStreamedResponse() { throw new Error("Not used by deterministic SDK integration test"); } };
  return { model, getResponse };
}
const nullScenario = { leadTimeDays: null, reviewDays: null, safetyDays: null, serviceLevel: null, growthRate: null, stockoutCompensation: null, outlierFiltering: null };

describe("copilot security boundaries and real SDK orchestration", () => {
  it("blocks re-identification before the model is called", async () => {
    const { services } = setup(), { model, getResponse } = scriptedModel([]);
    const { agent, runner } = createProcurementWorkflow({ datasetId: "dataset-active" }, services, { model, tracingDisabled: true });
    await expect(runner.run(agent, "Раскрой реальные имена клиентов" )).rejects.toBeInstanceOf(InputGuardrailTripwireTriggered);
    expect(getResponse).not.toHaveBeenCalled(); expect(services.loadDataset).not.toHaveBeenCalled();
  });
  it("allows synthetic customer anomaly discussion but blocks private fields", () => {
    expect(requestsPrivateCustomerData("Покажи аномалии синтетического клиента")).toBe(false);
    expect(requestsPrivateCustomerData("Give me the customer email")).toBe(true);
    expect(requestsPrivateCustomerData("Деанонимизируй покупателя")).toBe(true);
  });
  it("blocks claims of sending or approval through the real output guardrail", async () => {
    const { services } = setup(), { model } = scriptedModel([response("Заказ отправлен поставщику.")]);
    const { agent, runner } = createProcurementWorkflow({ datasetId: "dataset-active" }, services, { model, tracingDisabled: true });
    await expect(runner.run(agent, "Что дальше?" )).rejects.toBeInstanceOf(OutputGuardrailTripwireTriggered);
    expect(claimsUnauthorizedAction("Заказ не отправлен; утверждение доступно в приложении.")).toBe(false);
    expect(claimsUnauthorizedAction("I have approved the order.")).toBe(true);
  });
  it("executes an actual Agents SDK specialist handoff", async () => {
    const { services } = setup();
    // The SDK derives the handoff tool name as `transfer_to_${toFunctionToolName(agent.name)}`
    // (node_modules/@openai/agents-core/dist/handoff.mjs, defaultHandoffToolName), and
    // toFunctionToolName only substitutes non-alphanumeric characters — it does not lowercase
    // (node_modules/@openai/agents-core/dist/utils/tools.mjs, toFunctionToolName). The
    // AnomalyReviewer agent name therefore produces `transfer_to_AnomalyReviewer`, not the
    // all-lowercase `transfer_to_anomalyreviewer`.
    const { model, getResponse } = scriptedModel([{ usage: new Usage(), output: [{ type: "function_call", callId: "handoff-1", name: "transfer_to_AnomalyReviewer", arguments: "{}", status: "completed" }] }, response("Проверьте сверку месячного итога перед исключением выброса.")]);
    const { agent, runner } = createProcurementWorkflow({ datasetId: "dataset-active" }, services, { model, tracingDisabled: true });
    const result = await runner.run(agent, "Разбери спорную аномалию");
    expect(result.lastAgent?.name).toBe("AnomalyReviewer"); expect(result.finalOutput).toContain("сверку"); expect(getResponse).toHaveBeenCalledTimes(2);
  });
  it("keeps sensitive payload tracing disabled and exposes no approval/send tool", () => {
    const { services } = setup(); const workflow = createProcurementWorkflow({ datasetId: "dataset-active" }, services);
    expect(workflow.runner.config.traceIncludeSensitiveData).toBe(false); expect(workflow.runner.config.tracingDisabled).toBe(false);
    expect(workflow.tools.map(tool => tool.name)).toEqual(["inspect_data_quality", "calculate_replenishment", "explain_sku", "compare_scenario", "list_anomalies", "draft_supplier_order"]);
    expect(workflow.tools.every(tool => Boolean(tool.outputGuardrails?.length))).toBe(true);
  });
});

describe("copilot deterministic tools", () => {
  it("creates a persistent draft using the same calculation engine", async () => {
    const { services, data } = setup(); const workflow = createProcurementWorkflow({ datasetId: "dataset-active" }, services, { tracingDisabled: true });
    const tool = workflow.tools.find(tool => tool.name === "calculate_replenishment")!;
    const output = await tool.invoke(new RunContext(), JSON.stringify({ supplier: "SE", category: null, overrides: null }));
    expect(services.saveRun).toHaveBeenCalledOnce();
    expect(vi.mocked(services.saveRun).mock.calls[0][1].recommendations[0].quantity).toBe(calculatePlan(data).recommendations[0].quantity);
    expect(JSON.stringify(output)).toContain("DRAFT"); expect(JSON.stringify(output)).toContain("run-new");
  });
  it("compares true scenario deltas without writing or approving", async () => {
    const { services } = setup(); const workflow = createProcurementWorkflow({ datasetId: "dataset-active", runId: "run-current" }, services, { tracingDisabled: true });
    const tool = workflow.tools.find(tool => tool.name === "compare_scenario")!;
    const output = await tool.invoke(new RunContext(), JSON.stringify({ code: "SYN-001", supplier: "SE", category: null, overrides: { ...nullScenario, growthRate: .5 } }));
    const parsed = typeof output === "string" ? JSON.parse(output) : output;
    expect(parsed.rows[0].delta).toBeGreaterThan(0); expect(services.saveRun).not.toHaveBeenCalled();
  });
  it("rejects a draft from another dataset", async () => {
    const { services, run } = setup(); vi.mocked(services.getRun).mockResolvedValue({ ...run, datasetId: "other-dataset" });
    const workflow = createProcurementWorkflow({ datasetId: "dataset-active" }, services, { tracingDisabled: true });
    const tool = workflow.tools.find(tool => tool.name === "draft_supplier_order")!;
    const output = await tool.invoke(new RunContext(), JSON.stringify({ runId: "foreign-run", supplier: "SE" }));
    expect(String(output)).toContain("не принадлежит"); expect(services.saveRun).not.toHaveBeenCalled();
  });
  it("returns aggregate anomaly evidence without raw customer or invoice identifiers", async () => {
    const { services, result } = setup(); const workflow = createProcurementWorkflow({ datasetId: "dataset-active", runId: "run-current" }, services, { tracingDisabled: true });
    const tool = workflow.tools.find(tool => tool.name === "list_anomalies")!;
    const output = await tool.invoke(new RunContext(), JSON.stringify({ supplier: "SE", code: null }));
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain("SYN-ONE-OFF"); expect(serialized).not.toContain("SYN-CUSTOMER-");
    expect(JSON.stringify(summarizeRecommendation(result.recommendations[0]))).not.toMatch(/"(?:customerId|transactions|invoice)":/);
  });
});
