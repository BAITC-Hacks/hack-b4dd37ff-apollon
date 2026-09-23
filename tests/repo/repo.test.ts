import { afterAll, describe, expect, it } from "vitest";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { getDb } from "../../lib/db";
import { approveOrder, approvedExport, editOrder, getRun, json, loadDataset, orderAudit, saveDataset, saveRun } from "../../lib/repo";
import { calculatePlan } from "../../lib/engine";
import { makeEngineFixture } from "../fixtures/engine";
import type { DatasetInput, PlanResult } from "../../lib/contracts/engine";

// Local .env is optional; a clean checkout/CI without DATABASE_URL skips only DB tests.
config({ quiet: true });
const created = new Set<string>();
function input(): DatasetInput {
  const data = makeEngineFixture({ seasonal: true, customer: true });
  data.name = `REPO-TEST-${randomUUID()}`;
  data.files = [{ name: "synthetic-repository-test.xlsx", hash: randomUUID(), supplier: "SE", kind: "test", rows: 1 }];
  return data;
}
async function save(data: DatasetInput, reuseExisting = false) {
  const saved = await saveDataset(data, "test-parser", { reuseExisting }); created.add(saved.id); return saved;
}
async function order(customize?: (result: PlanResult) => void) {
  const data = input(), saved = await save(data), result = calculatePlan(data);
  customize?.(result);
  const run = await saveRun(saved.id, result);
  return { run, result, order: run.orders[0] };
}

describe.skipIf(!process.env.DATABASE_URL)("repository transactions (PostgreSQL)", () => {
  afterAll(async () => {
    if (!created.size) return;
    const db = getDb(), datasetIds = [...created];
    // Exact IDs created by this suite only. Relations without cascading deletion
    // are removed in dependency order; seeded/user datasets are never selected.
    const runs = await db.run.findMany({ where: { datasetId: { in: datasetIds } }, select: { id: true } });
    const orders = await db.order.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await db.$transaction([
      db.auditEvent.deleteMany({ where: { orderId: { in: orderIds } } }),
      db.approval.deleteMany({ where: { orderId: { in: orderIds } } }),
      db.order.deleteMany({ where: { id: { in: orderIds } } }),
      db.run.deleteMany({ where: { id: { in: runs.map((r) => r.id) } } }),
      db.product.deleteMany({ where: { datasetId: { in: datasetIds } } }),
      db.dataset.deleteMany({ where: { id: { in: datasetIds } } }),
    ]);
    await db.$disconnect();
  });

  it("round-trips all normalized facts, provenance, nulls and signed quantities", async () => {
    const data = input();
    data.suppliers[0].sales[0].quantity = null;
    data.suppliers[0].transactions.push({ code: "SYN-001", invoice: "RETURN", date: "2026-09-10", quantity: -3, source: { file: "source.xlsx", sheet: "Лист_1", row: 42 } });
    data.suppliers[0].issues.push({ severity: "warning", code: "TEST", message: "Синтетический аудит" });
    const saved = await save(data);
    expect(await loadDataset(saved.id)).toEqual(JSON.parse(JSON.stringify(data)));
    expect(saved.productCount).toBe(1); expect(saved.issueCount).toBe(1);
  });
  it("creates separate interactive datasets but reuses identical deploy seeds", async () => {
    const data = input();
    const first = await save(data), second = await save(data);
    expect(first.id).not.toBe(second.id);
    const seed1 = await save(data, true), seed2 = await save(data, true);
    expect(seed1.id).toBe(seed2.id); expect(seed1.id).not.toBe(first.id);
    const changed = { ...data, cutoffDate: "2026-09-21" };
    expect((await save(changed, true)).id).not.toBe(seed1.id);
  });
  it("blocks drafts, freezes approval content, and records the approving person", async () => {
    const { order: o, run } = await order();
    await expect(approvedExport(o.id, o.revision)).rejects.toMatchObject({ status: 409 });
    const approved = await approveOrder(o.id, o.revision, "Тестовый закупщик", true);
    const frozen = await approvedExport(o.id, approved.revision);
    expect(approved).toMatchObject({ status: "APPROVED", approver: "Тестовый закупщик", revision: 1 });
    expect(frozen.lines[0].quantity).toBe(o.quantities[frozen.lines[0].recommendation.key]);
    const live = structuredClone(run.result); live.recommendations[0].name = "Changed live result after approval";
    await getDb().run.update({ where: { id: run.id }, data: { result: json(live) } });
    expect((await approvedExport(o.id, approved.revision)).lines[0].recommendation.name).not.toBe(live.recommendations[0].name);
    expect((await orderAudit(o.id))[0]).toMatchObject({ action: "APPROVE", actor: "Тестовый закупщик", revision: 1 });
  });
  it("invalidates approval on editing while retaining the immutable historical snapshot", async () => {
    const { order: o } = await order();
    const approved = await approveOrder(o.id, 0, "Tester", true), key = Object.keys(o.quantities)[0];
    const edited = await editOrder(o.id, approved.revision, [{ key, quantity: o.quantities[key] + 1 }]);
    expect(edited).toMatchObject({ status: "DRAFT", revision: 2, approver: null, approvedAt: null, approvedKeys: [] });
    await expect(approvedExport(o.id, approved.revision)).rejects.toMatchObject({ status: 409 });
    await expect(approvedExport(o.id, edited.revision)).rejects.toMatchObject({ status: 409 });
    expect(await getDb().approval.count({ where: { orderId: o.id, revision: approved.revision } })).toBe(1);
    expect((await orderAudit(o.id)).map((event) => event.action)).toEqual(["EDIT", "APPROVE"]);
  });
  it("rejects stale revisions and atomically resolves two concurrent approvals", async () => {
    const { order: o } = await order();
    const results = await Promise.allSettled([
      approveOrder(o.id, 0, "First reviewer", true), approveOrder(o.id, 0, "Second reviewer", true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    expect(await getDb().approval.count({ where: { orderId: o.id } })).toBe(1);
    await expect(editOrder(o.id, 0, [{ key: Object.keys(o.quantities)[0], quantity: 100 }])).rejects.toMatchObject({ status: 409 });
  });
  it("a concurrent edit/approval race cannot approve quantities from a stale revision", async () => {
    const { order: o, run } = await order(), key = Object.keys(o.quantities)[0];
    const results = await Promise.allSettled([
      editOrder(o.id, 0, [{ key, quantity: 777 }]), approveOrder(o.id, 0, "Race reviewer", true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { status: 409 } });
    const current = (await getRun(run.id)).orders[0];
    if (current.status === "APPROVED") expect((await approvedExport(o.id, current.revision)).lines[0].quantity).toBe(o.quantities[key]);
    else expect(current.quantities[key]).toBe(777);
  });
  it("enforces MOQ and pack multiples and explicit acknowledgement of estimated inputs", async () => {
    const { order: o } = await order((r) => { Object.assign(r.recommendations[0].provenance, { moq: 10, multiple: 5 }); r.recommendations[0].needsReview = true; });
    const key = Object.keys(o.quantities)[0];
    const invalid = await editOrder(o.id, 0, [{ key, quantity: 6 }]);
    await expect(approveOrder(o.id, invalid.revision, "Reviewer", true)).rejects.toThrow("MOQ");
    const valid = await editOrder(o.id, invalid.revision, [{ key, quantity: 15 }]);
    await expect(approveOrder(o.id, valid.revision, "Reviewer", false)).rejects.toThrow("Acknowledge");
    expect((await approveOrder(o.id, valid.revision, "Reviewer", true)).status).toBe("APPROVED");
  });
  it("rejects foreign and duplicate selected lines; new scenario runs always start as drafts", async () => {
    const { order: o, run, result } = await order(), key = Object.keys(o.quantities)[0];
    await expect(editOrder(o.id, 0, [{ key: "OTHER:PRODUCT", quantity: 20 }])).rejects.toThrow("belong");
    await expect(approveOrder(o.id, 0, "Reviewer", true, [key, key])).rejects.toThrow("Invalid");
    await approveOrder(o.id, 0, "Reviewer", true);
    const next = await saveRun(run.datasetId, result, {}, run.id);
    expect(next.orders[0]).toMatchObject({ status: "DRAFT", revision: 0 });
    expect(next.scenarioDelta?.[0]).toMatchObject({ key, delta: 0 });
    await expect(approvedExport(next.orders[0].id, 1)).rejects.toMatchObject({ status: 409 });
  });
  it("validates quantities, own product keys and approver names at the service boundary", async () => {
    const { order: o } = await order(), key = Object.keys(o.quantities)[0];
    for (const quantity of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1e13]) await expect(editOrder(o.id, 0, [{ key, quantity }])).rejects.toBeInstanceOf(Error);
    await expect(editOrder(o.id, 0, [{ key: "toString", quantity: 5 }])).rejects.toBeInstanceOf(Error);
    await expect(approveOrder(o.id, 0, "  ", true)).rejects.toBeInstanceOf(Error);
  });
});
