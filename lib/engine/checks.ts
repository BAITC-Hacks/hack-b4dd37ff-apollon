import type { CaseCheck, DatasetInput } from "../contracts/engine";
import { calculatePlan } from "./index";
import { addDays } from "./math";

// Self-contained public demonstration fixture; these are explicitly synthetic domain inputs.
export function caseDataset(): DatasetInput {
  const sales = [], stocks = [], transactions = [];
  for (let year = 2024; year <= 2026; year++) for (let month = 1; month <= (year === 2026 ? 8 : 12); month++) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    sales.push({ code: "CHECK-001", month: key, quantity: 120 }); stocks.push({ code: "CHECK-001", month: key, quantity: 300 as number | null });
    for (let i = 0; i < 6; i++) transactions.push({ code: "CHECK-001", date: `${key}-${String(i * 4 + 1).padStart(2, "0")}`, invoice: `CHECK-${key}-${i}`, quantity: 20 });
  }
  return { name: "СИНТЕТИЧЕСКИЕ ПРОВЕРКИ — не реальные данные", synthetic: true, cutoffDate: "2026-09-22", files: [], suppliers: [{ supplier: "SE", products: [{ code: "CHECK-001", supplierArticle: "SYNTHETIC", name: "Проверочный товар", unit: "шт", category: "2", moq: 1, multiple: 1 }], sales, stocks, transactions, currentStock: [{ code: "CHECK-001", date: "2026-09-22", available: 10, kind: "current" }], deliveries: [], stockouts: [], seasonality: Array(12).fill(1), issues: [] }] };
}

export function runCaseChecks(dataset?: DatasetInput): CaseCheck[] {
  // Never run the demonstration fixture when an active dataset was supplied.
  if (dataset) return runDatasetChecks(dataset);
  const base = caseDataset(), get = (dataset: DatasetInput, overrides = {}) => calculatePlan(dataset, overrides).recommendations[0];
  const regular = get(base), moreSales = structuredClone(base), moreStock = structuredClone(base), inbound = structuredClone(base), late = structuredClone(base);
  moreSales.suppliers[0].sales.forEach(row => { row.quantity! *= 2; }); moreSales.suppliers[0].transactions.forEach(row => { row.quantity *= 2; });
  moreStock.suppliers[0].currentStock[0].available! += 50;
  inbound.suppliers[0].deliveries.push({ code: "CHECK-001", quantity: 50, eta: "2026-10-01" });
  late.suppliers[0].deliveries.push({ code: "CHECK-001", quantity: 50, eta: "2027-10-01" });
  const salesResult = get(moreSales), stockResult = get(moreStock), inboundResult = get(inbound), lateResult = get(late), growthResult = get(base, { growthRate: .5 }), categoryResult = get(base, { categorySafetyDays: { "2": 30 } });
  // Assert the direction of change on both the raw need (before MOQ/pack rounding can mask it) and the final quantity.
  const rawNeedDirectional = salesResult.provenance.rawNeed > regular.provenance.rawNeed && stockResult.provenance.rawNeed < regular.provenance.rawNeed && inboundResult.provenance.rawNeed < regular.provenance.rawNeed && lateResult.provenance.rawNeed === regular.provenance.rawNeed && growthResult.provenance.rawNeed > regular.provenance.rawNeed && categoryResult.provenance.rawNeed > regular.provenance.rawNeed;
  const quantityDirectional = salesResult.quantity > regular.quantity && stockResult.quantity < regular.quantity && inboundResult.quantity < regular.quantity && lateResult.quantity === regular.quantity && growthResult.quantity > regular.quantity && categoryResult.quantity > regular.quantity;
  const directional = rawNeedDirectional && quantityDirectional;
  const seasonal = structuredClone(base), pattern = [.6, .7, .8, .9, 1, 1.1, 1.2, 1.3, 1.6, 1.4, 1, .7];
  seasonal.suppliers[0].sales.forEach(row => { row.quantity! *= pattern[Number(row.month.slice(5, 7)) - 1]; }); seasonal.suppliers[0].transactions.forEach(row => { row.quantity *= pattern[Number(row.date.slice(5, 7)) - 1]; });
  const seasonalResult = get(seasonal), seasonalFactors = seasonalResult.provenance.seasonalFactors;
  const outOfStock = structuredClone(base);
  for (const month of ["2026-05", "2026-06"]) {
    outOfStock.suppliers[0].sales.find(row => row.month === month)!.quantity = 20;
    outOfStock.suppliers[0].stocks.find(row => row.month === month)!.quantity = null;
    outOfStock.suppliers[0].transactions.filter(row => row.date.startsWith(month)).forEach(row => { row.quantity = 20 / 6; });
  }
  const compensated = get(outOfStock), uncompensated = get(outOfStock, { stockoutCompensation: false });
  const spike = structuredClone(base); spike.suppliers[0].sales.find(row => row.month === "2026-07")!.quantity! += 6000;
  spike.suppliers[0].transactions.push({ code: "CHECK-001", invoice: "CHECK-ONE-OFF", date: "2026-07-28", quantity: 6000 });
  const cleaned = get(spike), change = Math.abs(cleaned.provenance.baseMonthlyDemand - regular.provenance.baseMonthlyDemand) / regular.provenance.baseMonthlyDemand;
  const rows = calculatePlan(base).recommendations;
  const checks: CaseCheck[] = [
    { id: "inputs", name: "1. Все входы меняют решение", passed: directional, details: "Синтетика. Продажи, остаток, ETA, категория и рост изменены по одному; направление проверено и на чистой потребности, и на итоговом количестве; поставка вне горизонта не уменьшает заказ.", values: { base: regular.quantity, sales: salesResult.quantity, stock: stockResult.quantity, inbound: inboundResult.quantity, lateInbound: lateResult.quantity, growth: growthResult.quantity, category: categoryResult.quantity, rawNeedBase: regular.provenance.rawNeed, rawNeedSales: salesResult.provenance.rawNeed, rawNeedStock: stockResult.provenance.rawNeed, rawNeedInbound: inboundResult.provenance.rawNeed } },
    { id: "seasonality", name: "2. Сезонность сохранена", passed: Math.max(...seasonalFactors) / Math.min(...seasonalFactors) > 1.3, details: "Синтетический годовой сезонный профиль нормирован; пик превышает минимум более чем на 30%.", values: { peak: Math.max(...seasonalFactors), trough: Math.min(...seasonalFactors) } },
    { id: "stockouts", name: "3. Упущенный спрос восстановлен", passed: compensated.provenance.lostDemand > 0 && compensated.quantity > uncompensated.quantity, details: "Синтетика. Внутренние пустые остатки и продажи ниже нормы дают оценку доступности и диапазон упущенного спроса.", values: { lost: compensated.provenance.lostDemand, low: compensated.provenance.lostDemandLow, high: compensated.provenance.lostDemandHigh, withCompensation: compensated.quantity, withoutCompensation: uncompensated.quantity } },
    { id: "one_off", name: "4. Разовый заказ не завышает норму", passed: cleaned.anomalies.some(row => row.invoice === "CHECK-ONE-OFF" && row.excluded) && change < .05, details: "Синтетика. Счёт на 50 месячных норм сверён с месячным итогом; после исключения базовый спрос меняется менее чем на 5%.", values: { baseline: regular.provenance.baseMonthlyDemand, cleaned: cleaned.provenance.baseMonthlyDemand, relativeChange: change, excluded: cleaned.provenance.excludedQuantity } },
    { id: "explanation", name: "5. Заказ прозрачен и разделён по поставщику", passed: rows.every(row => Boolean(row.supplier && row.explanation) && Number.isFinite(row.provenance.rawNeed) && Number.isFinite(row.quantity)), details: "Каждая строка содержит поставщика, русское объяснение и числовой расчёт. Проверка утверждённого экспорта выполняется отдельно на уровне приложения.", values: { lines: rows.length, explained: rows.filter(row => row.explanation.length > 50).length } },
  ];
  return checks;
}

/** Counterfactual evidence on one actual SKU, isolated to bound calculation cost. */
function runInputSensitivityCheck(dataset: DatasetInput, key: string | undefined): CaseCheck {
  const supplier = dataset.suppliers.find(input => input.products.some(product => `${input.supplier}:${product.code}` === key));
  const product = supplier?.products.find(product => `${supplier.supplier}:${product.code}` === key);
  if (!supplier || !product) return { id: "dataset-sensitivity", name: "Данные: влияние остатка и ETA", passed: false, details: "В наборе нет товара для проверки изменения входов.", values: { scopedProducts: 0 } };
  const sameCode = <T extends { code: string }>(rows: T[]) => rows.filter(row => row.code === product.code);
  const sample: DatasetInput = { ...dataset, suppliers: [{ ...supplier, products: [product], sales: sameCode(supplier.sales), stocks: sameCode(supplier.stocks), transactions: sameCode(supplier.transactions), currentStock: sameCode(supplier.currentStock), deliveries: sameCode(supplier.deliveries), stockouts: sameCode(supplier.stockouts) }] };
  const baseline = calculatePlan(sample).recommendations[0];
  const increment = Math.max(1, baseline.provenance.rawNeed / 2);
  const stock = calculatePlan(sample, { currentStockOverrides: { [baseline.key]: baseline.provenance.availableStock + increment } }).recommendations[0];
  const arriving = structuredClone(sample), late = structuredClone(sample);
  arriving.suppliers[0].deliveries.push({ code: product.code, quantity: increment, eta: addDays(dataset.cutoffDate, 1) });
  late.suppliers[0].deliveries.push({ code: product.code, quantity: increment, eta: addDays(dataset.cutoffDate, baseline.provenance.horizonDays + 1) });
  const inbound = calculatePlan(arriving).recommendations[0], outside = calculatePlan(late).recommendations[0];
  const close = (a: number, b: number) => Math.abs(a - b) <= .0001;
  const expected = Math.max(0, baseline.provenance.rawNeed - increment);
  return {
    id: "dataset-sensitivity", name: "Данные: влияние остатка и ETA",
    passed: close(stock.provenance.rawNeed, expected) && close(inbound.provenance.rawNeed, expected) && close(outside.provenance.rawNeed, baseline.provenance.rawNeed) && close(inbound.provenance.eligibleInbound, baseline.provenance.eligibleInbound + increment),
    details: "Контрфактическая проверка одного товара из активного набора: остаток и поставка внутри горизонта уменьшают чистую потребность, поставка за горизонтом её не меняет. Проверочные копии не сохраняются. Расчёт ограничен этим товаром, поэтому общий сезонный профиль набора здесь не применяется.",
    values: { sku: baseline.key, scopedProducts: 1, increment, baseNeed: baseline.provenance.rawNeed, moreStockNeed: stock.provenance.rawNeed, inboundNeed: inbound.provenance.rawNeed, lateInboundNeed: outside.provenance.rawNeed },
  };
}

/** Observed evidence on the active dataset; missing evidence remains a visible failure, never invented. */
export function runDatasetChecks(dataset: DatasetInput): CaseCheck[] {
  const result = calculatePlan(dataset), rows = result.recommendations;
  const source = dataset.synthetic ? "Активный синтетический набор" : "Реальные загруженные данные";
  const seasonal = rows.find(row => Math.max(...row.provenance.seasonalFactors) / Math.min(...row.provenance.seasonalFactors) > 1.3);
  const lost = rows.filter(row => row.provenance.lostDemand > 0).sort((a, b) => b.provenance.lostDemand - a.provenance.lostDemand)[0];
  const anomaly = rows.find(row => row.anomalies.some(p => p.excluded));
  const sample = rows.find(row => row.quantity > 0) ?? rows[0];
  const rounded = rows.every(row => row.quantity === 0 || (row.quantity + 1e-5 >= row.provenance.rawNeed && row.quantity + 1e-5 >= row.provenance.moq && Math.abs(row.quantity / row.provenance.multiple - Math.round(row.quantity / row.provenance.multiple)) < 1e-4));
  return [
    runInputSensitivityCheck(dataset, rows.find(row => row.provenance.rawNeed > 0)?.key ?? sample?.key),
    { id: "dataset-inputs", name: "Данные: входы и единицы расчёта", passed: Boolean(sample) && rows.every(row => Number.isFinite(row.provenance.rawNeed) && row.provenance.horizonDays > 0), details: `${source}. Пример сохраняет спрос, остаток, будущие поступления, категорию и рост.`, values: { sku: sample?.key ?? "нет", demand: sample?.provenance.forecastDemand ?? 0, stock: sample?.provenance.availableStock ?? 0, inbound: sample?.provenance.eligibleInbound ?? 0, category: sample?.category ?? "нет", growth: sample?.provenance.annualGrowth ?? 0 } },
    { id: "dataset-seasonality", name: "Данные: сезонный товар найден", passed: Boolean(seasonal), details: `${source}. ${seasonal ? "Пик профиля превышает минимум более чем на 30%." : "В текущем наборе нет подтверждения сильной сезонности; это отсутствие примера, не подставной успех."}`, values: { sku: seasonal?.key ?? "нет", peak: seasonal ? Math.max(...seasonal.provenance.seasonalFactors) : 0, trough: seasonal ? Math.min(...seasonal.provenance.seasonalFactors) : 0 } },
    { id: "dataset-stockouts", name: "Данные: пример упущенного спроса", passed: Boolean(lost), details: `${source}. Доступность является оценкой, кроме явно подтверждённых интервалов.`, values: { sku: lost?.key ?? "нет", lost: lost?.provenance.lostDemand ?? 0, low: lost?.provenance.lostDemandLow ?? 0, high: lost?.provenance.lostDemandHigh ?? 0 } },
    { id: "dataset-anomaly", name: "Данные: пример разовой продажи", passed: Boolean(anomaly), details: `${source}. ${anomaly ? "Выброс найден; вычитание счёта разрешено только при сверке. Все исправления доступны для восстановления." : "Не найдено достаточных оснований для автоматического исключения; клиентская проверка требует настоящего customerId."}`, values: { sku: anomaly?.key ?? "нет", excluded: anomaly?.provenance.excludedQuantity ?? 0, flags: anomaly?.anomalies.length ?? 0 } },
    { id: "dataset-provenance", name: "Данные: обоснование и ограничения заказа", passed: rows.length > 0 && rounded && rows.every(row => Boolean(row.supplier && row.explanation)), details: `${source}. Количество не ниже чистой потребности и MOQ, округлено по кратности; каждая строка имеет поставщика и объяснение.`, values: { lines: rows.length, quantitiesValid: rounded, explained: rows.filter(row => row.explanation).length } },
  ];
}
