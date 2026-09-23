import { describe, expect, it } from "vitest";
import { calculatePlan } from "../../lib/engine";
import { backtest } from "../../lib/engine/backtest";
import { runCaseChecks } from "../../lib/engine/checks";
import { makeEngineFixture, SEASON_PATTERN } from "../fixtures/engine";
import { mean, sum } from "../../lib/engine/math";

const first = (dataset = makeEngineFixture(), overrides = {}) => calculatePlan(dataset, overrides).recommendations[0];
describe("five required behaviors", () => {
  it("runs all five public case checks through real calculations", () => { for (const check of runCaseChecks()) expect(check.passed, `${check.name}: ${JSON.stringify(check.values)}`).toBe(true); });
  it("retains strong seasonality and sustained growth", () => {
    const seasonal = first(makeEngineFixture({ seasonal: true }));
    const factors = seasonal.provenance.seasonalFactors, x = SEASON_PATTERN.map(n => n - mean(SEASON_PATTERN)), y = factors.map(n => n - mean(factors));
    const correlation = x.reduce((total, n, i) => total + n * y[i], 0) / Math.sqrt(x.reduce((n, v) => n + v * v, 0) * y.reduce((n, v) => n + v * v, 0));
    expect(correlation).toBeGreaterThan(.8); expect(Math.max(...factors) / Math.min(...factors)).toBeGreaterThan(1.3);
    const growth = first(makeEngineFixture({ growth: true })); expect(growth.provenance.baseMonthlyDemand).toBeGreaterThan(first().provenance.baseMonthlyDemand); expect(growth.anomalies.filter(p => p.excluded)).toHaveLength(0);
  });
  it("aggregates invoice lines and supports restoring a genuine one-off", () => {
    const data = makeEngineFixture({ spike: true }), transaction = data.suppliers[0].transactions.find(p => p.invoice === "SYN-ONE-OFF")!;
    transaction.quantity = 3000; data.suppliers[0].transactions.push({ ...transaction });
    const row = first(data), anomaly = row.anomalies.find(p => p.invoice === "SYN-ONE-OFF")!;
    expect(anomaly.quantity).toBe(6000); expect(anomaly.excluded).toBe(true);
    expect(first(data, { restoredAnomalyIds: [anomaly.id] }).quantity).toBeGreaterThan(row.quantity);
  });
  it("removes a historical spike from both the product and pooled seasonal profile", () => {
    const data = makeEngineFixture(), baseline = first(data);
    data.suppliers[0].sales.find(row => row.month === "2025-07")!.quantity! += 6000;
    data.suppliers[0].transactions.push({ code: "SYN-001", date: "2025-07-28", invoice: "OLD-SPIKE", quantity: 6000 });
    const row = first(data); expect(row.anomalies.some(p => p.invoice === "OLD-SPIKE" && p.excluded)).toBe(true);
    expect(row.provenance.seasonalFactors).toEqual(baseline.provenance.seasonalFactors);
    expect(row.provenance.baseMonthlyDemand).toEqual(baseline.provenance.baseMonthlyDemand);
  });
  it("preserves a large permanent step-up through the persistence guard", () => {
    const data = makeEngineFixture();
    data.suppliers[0].sales.filter(p => p.month >= "2026-01").forEach(p => { p.quantity! *= 10; });
    data.suppliers[0].transactions.filter(p => p.date >= "2026-01-01").forEach(p => { p.quantity *= 10; });
    expect(first(data).anomalies.filter(p => p.excluded)).toHaveLength(0);
    expect(first(data).provenance.baseMonthlyDemand).toBeGreaterThan(500);
  });
  it("detects split customer concentration using customer IDs only", () => {
    const data = makeEngineFixture({ customer: true }), row = first(data);
    expect(row.anomalies.some(p => p.reason.includes("customerId") && p.excluded)).toBe(true);
    expect(row.provenance.baseMonthlyDemand).toBeCloseTo(first().provenance.baseMonthlyDemand, 0);
    data.suppliers[0].transactions.forEach(p => { delete p.customerId; });
    expect(first(data).anomalies.some(p => p.reason.includes("customerId"))).toBe(false);
  });
});

describe("active dataset evidence", () => {
  it("reports only supplied dataset evidence and counterfactuals, without demo checks", () => {
    const dataset = makeEngineFixture();
    dataset.synthetic = false;
    const before = structuredClone(dataset);
    const checks = runCaseChecks(dataset);
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every(check => check.id.startsWith("dataset-"))).toBe(true);
    expect(JSON.stringify(checks)).not.toContain("CHECK-001");
    expect(JSON.stringify(checks)).not.toContain("Синтетика");
    const sensitivity = checks.find(check => check.id === "dataset-sensitivity")!;
    expect(sensitivity.passed).toBe(true);
    expect(sensitivity.values.sku).toBe("SE:SYN-001");
    expect(sensitivity.values.scopedProducts).toBe(1);
    expect(Number(sensitivity.values.inboundNeed)).toBeLessThan(Number(sensitivity.values.baseNeed));
    expect(dataset).toEqual(before);
  });
  it("reports lack of evidence on an empty active dataset without falling back to the fixture", () => {
    const dataset = makeEngineFixture(); dataset.suppliers = []; dataset.synthetic = false;
    const checks = runCaseChecks(dataset);
    expect(checks.every(check => check.id.startsWith("dataset-") && !check.passed)).toBe(true);
    expect(JSON.stringify(checks)).not.toContain("CHECK-001");
  });
  it("separates calculation assumptions, import diagnostics and per-product warnings", () => {
    const dataset = makeEngineFixture();
    dataset.suppliers[0].issues.push({ severity: "warning", message: "Ошибка исходной ячейки MOQ" });
    delete dataset.suppliers[0].products[0].moq;
    const result = calculatePlan(dataset), row = result.recommendations[0];
    expect(result.warnings).toEqual([...new Set(row.provenance.assumptions)]);
    expect(result.warnings).not.toContain("Ошибка исходной ячейки MOQ");
    expect(row.warnings).toContain("MOQ не задан; применяется минимальное техническое значение 1.");
    expect(dataset.suppliers[0].issues).toHaveLength(1);
    expect(calculatePlan(dataset, {}, { category: "absent" }).warnings).toEqual([]);
  });
});

describe("stock, cutoff, and procurement invariants", () => {
  it("never invents a receipt from a past ETA", () => {
    const data = makeEngineFixture(); data.suppliers[0].currentStock = [{ code: "SYN-001", date: "2026-09-01", available: 30, kind: "opening" }];
    data.suppliers[0].deliveries.push({ code: "SYN-001", quantity: 500, eta: "2026-09-10" });
    expect(first(data).provenance.availableStock).toBe(30); expect(first(data).provenance.eligibleInbound).toBe(0);
    data.suppliers[0].deliveries[0].receivedDate = "2026-09-12"; expect(first(data).provenance.availableStock).toBe(530);
  });
  it("uses a future ETA only on the correct day, even if a shortage happens first", () => {
    const data = makeEngineFixture(); data.suppliers[0].deliveries.push({ code: "SYN-001", quantity: 1000, eta: "2026-11-01" });
    const row = first(data); expect(row.quantity).toBe(0); expect(row.shortageBeforeInbound).toBe(true); expect(row.urgency).toBe("CRITICAL");
    expect(row.projection.find(p => p.date === "2026-11-01")!.inbound).toBe(1000);
  });
  it("respects current-stock overrides without subtracting reservations twice", () => {
    const data = makeEngineFixture(); data.suppliers[0].currentStock[0].reserved = 100;
    expect(first(data).provenance.availableStock).toBe(10);
    expect(first(data, { currentStockOverrides: { "SE:SYN-001": 5000 } }).quantity).toBe(0);
  });
  it("distinguishes missing current stock and unknown outside-span balances", () => {
    const data = makeEngineFixture(); data.suppliers[0].currentStock = []; data.suppliers[0].stocks = data.suppliers[0].stocks.map(p => ({ ...p, quantity: null }));
    const row = first(data); expect(row.provenance.stockKind).toBe("unknown"); expect(row.provenance.lostDemand).toBe(0); expect(row.needsReview).toBe(true);
  });
  it("unions confirmed stockout days and gives them precedence over inferred blanks", () => {
    const data = makeEngineFixture(); data.suppliers[0].stockouts = [{ code: "SYN-001", start: "2026-06-01", end: "2026-06-15", confirmed: true }, { code: "SYN-001", start: "2026-06-10", end: "2026-06-20", confirmed: true }];
    const point = first(data).history.find(p => p.month === "2026-06")!;
    expect(point.availability).toBeCloseTo(1 / 3); expect(point.lostLow).toBe(point.lostHigh); expect(point.lost).toBeGreaterThan(0);
  });
  it("clamps override availability and honors the stockout toggle", () => {
    const data = makeEngineFixture({ stockout: true });
    const row = first(data, { availabilityOverrides: { "SE:SYN-001:2026-06": -1 } });
    expect(row.history.find(p => p.month === "2026-06")!.availability).toBe(0);
    expect(first(data, { stockoutCompensation: false }).provenance.lostDemand).toBe(0);
    expect(row.provenance.lostDemandLow).toBeLessThanOrEqual(row.provenance.lostDemand); expect(row.provenance.lostDemandHigh).toBeGreaterThanOrEqual(row.provenance.lostDemand);
  });
  it("separates MOQ, pack multiple and unit conversion", () => {
    const data = makeEngineFixture(); Object.assign(data.suppliers[0].products[0], { moq: 5, multiple: 2, unitConversion: 100, unit: "м" });
    const row = first(data); expect(row.quantity).toBe(600); expect(row.provenance.moq).toBe(500); expect(row.provenance.multiple).toBe(200);
    data.suppliers[0].currentStock[0].available = 100000; expect(first(data).quantity).toBe(0);
  });
  it("preserves signed returns in raw history and clamps only training", () => {
    const data = makeEngineFixture(); data.suppliers[0].sales.find(p => p.month === "2026-07")!.quantity = -10;
    const point = first(data).history.find(p => p.month === "2026-07")!; expect(point.raw).toBe(-10); expect(point.cleaned).toBe(0);
  });
  it("does not auto-subtract unreconciled invoices or sparse invoice history", () => {
    const data = makeEngineFixture({ spike: true }); data.suppliers[0].sales.find(p => p.month === "2026-07")!.quantity = 120;
    expect(first(data).anomalies.filter(p => p.invoice && p.excluded)).toHaveLength(0);
    data.suppliers[0].transactions = data.suppliers[0].transactions.filter(p => p.invoice === "SYN-ONE-OFF");
    expect(first(data).anomalies.filter(p => p.invoice)).toHaveLength(0);
  });
  it("does not flatten intermittent products", () => {
    const data = makeEngineFixture(); data.suppliers[0].transactions = []; data.suppliers[0].sales.forEach((p, i) => { p.quantity = i % 3 === 0 ? 1000 : 0; });
    expect(first(data).anomalies.filter(p => p.excluded)).toHaveLength(0);
  });
  it("never trains on unfinished months or future transactions", () => {
    const data = makeEngineFixture(), baseline = first(data);
    data.suppliers[0].sales.push({ code: "SYN-001", month: "2026-09", quantity: 1e9 });
    data.suppliers[0].transactions.push({ code: "SYN-001", invoice: "FUTURE", date: "2026-10-01", quantity: 1e9 });
    expect(first(data).quantity).toBe(baseline.quantity);
  });
  it("uses normalized seasonal pools and unit-separated ABC", () => {
    const data = makeEngineFixture(); const supplier = data.suppliers[0]; supplier.supplier = "IEK";
    supplier.products.push({ ...supplier.products[0], code: "METRES", unit: "м" });
    supplier.sales.push(...supplier.sales.map(p => ({ ...p, code: "METRES", quantity: p.quantity! * 1000 })));
    const rows = calculatePlan(data).recommendations; expect(rows.every(p => p.abc === "A")).toBe(true);
    expect(first(data).provenance.seasonalFactors.reduce((total, n) => total + n, 0) / 12).toBeCloseTo(1, 5);
  });
  it("returns finite conservative values for sparse and zero-demand products", () => {
    const data = makeEngineFixture(); data.suppliers[0].sales = []; data.suppliers[0].transactions = []; const row = first(data);
    expect(row.quantity).toBe(0); expect(row.coverDays).toBeNull(); expect(row.confidence).toBe("low"); expect(JSON.stringify(row)).not.toContain("NaN");
    expect(calculatePlan({ ...data, suppliers: [] }).recommendations).toHaveLength(0);
  });
  it("uses an explicit per-category fallback demand for a new SKU instead of dividing by zero", () => {
    const data = makeEngineFixture(); data.suppliers[0].sales = []; data.suppliers[0].transactions = []; data.suppliers[0].stocks = [];
    const withoutFallback = first(data);
    expect(withoutFallback.provenance.baseMonthlyDemand).toBe(0); expect(withoutFallback.quantity).toBe(0);
    const withFallback = first(data, { categoryFallbackDemand: { "2": 80 } });
    expect(withFallback.provenance.baseMonthlyDemand).toBe(80);
    expect(withFallback.quantity).toBeGreaterThan(0);
    expect(withFallback.confidence).toBe("low");
    expect(withFallback.warnings.some(w => w.includes("категории"))).toBe(true);
    expect(JSON.stringify(withFallback)).not.toContain("NaN");
    // A different category with no configured prior stays at the safe zero fallback, never invents a number.
    const otherCategory = structuredClone(data); otherCategory.suppliers[0].products[0].category = "9";
    expect(first(otherCategory, { categoryFallbackDemand: { "2": 80 } }).provenance.baseMonthlyDemand).toBe(0);
  });
  it("downgrades confidence when a large share of observed demand was excluded as anomalous", () => {
    const data = makeEngineFixture({ spike: true }), row = first(data);
    const observedDemand = sum(row.history.filter(p => p.forecast === undefined).map(p => Math.max(0, p.raw)));
    expect(row.provenance.excludedQuantity).toBeGreaterThan(0);
    expect(row.provenance.excludedQuantity / observedDemand).toBeGreaterThan(.3);
    expect(row.confidence).toBe("low");
  });
});

describe("rolling-origin backtests", () => {
  it("refits cutoffs and excludes incomplete or unavailable actuals", () => {
    const data = makeEngineFixture(), result = backtest(data);
    expect(result.rows).toHaveLength(6); expect(result.rows.every(row => row.month <= "2026-08" && row.month > row.origin.slice(0, 7))).toBe(true);
    // Horizon 1 has 3 fully-observed origins (May->Jun, Jun->Jul, Jul->Aug), horizon 2 has 2 (May->Jul, Jun->Aug), horizon 3 has 1 (May->Aug).
    expect(result.rows.filter(row => row.horizon === 1)).toHaveLength(3);
    expect(result.rows.filter(row => row.horizon === 2)).toHaveLength(2);
    expect(result.rows.filter(row => row.horizon === 3)).toHaveLength(1);
    expect(result.rows.every(row => row.unit === "шт")).toBe(true);
    // Metrics are reported per horizon and never mix units; sample counts must match the row counts above.
    for (const model of ["Модель", "Сезонный наивный", "Среднее 12 месяцев"]) {
      const forModel = result.metrics.filter(row => row.model === model);
      expect(forModel.every(row => row.unit === "шт" && Number.isFinite(row.mae))).toBe(true);
      expect(forModel.find(row => row.horizon === 1)?.count).toBe(3);
      expect(forModel.find(row => row.horizon === 2)?.count).toBe(2);
      expect(forModel.find(row => row.horizon === 3)?.count).toBe(1);
    }
    expect(result.metrics.reduce((total, row) => total + (row.model === "Модель" ? row.count : 0), 0)).toBe(6);
  });
  it("future sales, customer evidence and supplied growth cannot change an earlier-origin prediction", () => {
    const data = makeEngineFixture(), before = backtest(data).rows.filter(row => row.origin === "2026-05-31");
    data.suppliers[0].sales.filter(p => p.month > "2026-05").forEach(p => { p.quantity = 1e7; });
    data.suppliers[0].products[0].growthRate = 4;
    data.suppliers[0].transactions.filter(p => p.date > "2026-05-31").forEach(p => { p.quantity = 1e7; });
    const after = backtest(data).rows.filter(row => row.origin === "2026-05-31"); expect(after.map(p => p.predicted)).toEqual(before.map(p => p.predicted));
  });
});
