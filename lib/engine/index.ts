import { DEFAULT_POLICY, recommendationNeedsReview, type AnomalyFlag, type DatasetInput, type DemandPoint, type MonthlySale, type PlanFilter, type PlanResult, type Policy, type Product, type Recommendation, type SalesTransaction, type SupplierInput } from "../contracts/engine";
import { addDays, addMonths, clamp, dateOf, daysInMonth, diffDays, endOfMonth, finite, mad, mean, median, monthDistance, monthIndex, normalQuantile, normalized, quantile, round, std, sum, theilSen } from "./math";

interface Invoice { id: string; date: string; quantity: number; customerId?: string }
interface SeriesPoint { month: string; quantity: number }
interface Fit { level: number; factors: number[]; growth: number; growthSource: string; reference: string; errors: number[]; usedCategoryFallback: boolean }
export const ENGINE_THRESHOLDS = { reconciliationTolerance: .05, minimumPriorInvoices: 6, invoiceMonthlyShare: .3, monthlyRatio: 3, madMultiplier: 6, iqrMultiplier: 3, persistenceMonths: 6, persistenceMinimum: 3, intermittentZeroShare: .4, annualTrendCap: .5, availabilitySensitivity: .25 } as const;

function grouped<T extends { code: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) { const values = result.get(row.code) ?? []; values.push(row); result.set(row.code, values); }
  return result;
}

function seriesFrom(rows: MonthlySale[], cutoff: string): SeriesPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) if (row.month < cutoff.slice(0, 7) || endOfMonth(row.month) <= cutoff) {
    if (row.quantity !== null && Number.isFinite(row.quantity)) map.set(row.month, (map.get(row.month) ?? 0) + row.quantity);
  }
  return [...map].map(([month, quantity]) => ({ month, quantity })).sort((a, b) => a.month.localeCompare(b.month));
}

/** Each SKU contributes normalized seasonal ratios, so neither expensive SKUs nor metres dominate pieces. */
function profile(series: SeriesPoint[], fallback: number[] = Array(12).fill(1)): number[] {
  const byYear = new Map<string, SeriesPoint[]>();
  for (const point of series) { const key = point.month.slice(0, 4), values = byYear.get(key) ?? []; values.push(point); byYear.set(key, values); }
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  for (const points of byYear.values()) {
    if (points.length < 9) continue;
    const positives = points.map(p => Math.max(0, p.quantity));
    const typical = median(positives.filter(n => n > 0));
    const capped = positives.map(n => Math.min(n, typical * 4));
    const average = mean(capped);
    if (average <= 0) continue;
    points.forEach((p, i) => buckets[monthIndex(p.month)].push(capped[i] / average));
  }
  return normalized(buckets.map((values, index) => values.length ? median(values) : fallback[index]));
}

function invoiceRows(transactions: SalesTransaction[], cutoff: string): Invoice[] {
  const map = new Map<string, Invoice>();
  for (const row of transactions) {
    if (row.date.slice(0, 10) > cutoff) continue;
    const id = row.invoice || `unnamed:${row.date}`;
    const existing = map.get(id);
    if (existing) { existing.quantity += finite(row.quantity); if (row.date < existing.date) existing.date = row.date.slice(0, 10); }
    else map.set(id, { id, date: row.date.slice(0, 10), quantity: finite(row.quantity), customerId: row.customerId });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function persistent(month: string, series: SeriesPoint[], factors: number[], baseline: number): boolean {
  return series.filter(p => p.month > month && p.month <= addMonths(month, ENGINE_THRESHOLDS.persistenceMonths))
    .filter(p => Math.max(0, p.quantity) / factors[monthIndex(p.month)] > baseline * 1.5).length >= ENGINE_THRESHOLDS.persistenceMinimum;
}

function cleanSeries(code: string, supplier: string, series: SeriesPoint[], invoices: Invoice[], factors: number[], policy: Policy, warnings: string[]): { cleaned: SeriesPoint[]; anomalies: AnomalyFlag[] } {
  const totals = new Map<string, number>();
  for (const row of invoices) totals.set(row.date.slice(0, 7), (totals.get(row.date.slice(0, 7)) ?? 0) + row.quantity);
  const reconciled = new Set(series.filter(p => totals.has(p.month) && Math.abs((totals.get(p.month) ?? 0) - p.quantity) <= Math.max(1e-6, Math.abs(p.quantity) * ENGINE_THRESHOLDS.reconciliationTolerance)).map(p => p.month));
  if (series.some(p => totals.has(p.month) && !reconciled.has(p.month))) warnings.push("Счета и месячный отчёт расходятся более чем на 5%; вычитание счетов для таких месяцев запрещено.");
  const anomalies: AnomalyFlag[] = [];
  const removed = new Map<string, number>();
  const positive = series.map(p => Math.max(0, p.quantity) / factors[monthIndex(p.month)]);
  const baseline = median(positive.filter(n => n > 0));
  const intermittent = positive.filter(n => n === 0).length / Math.max(1, positive.length) > ENGINE_THRESHOLDS.intermittentZeroShare;
  const seenInvoice = new Set<string>();
  const flagInvoice = (invoice: Invoice, threshold: number, reason: string) => {
    if (seenInvoice.has(invoice.id)) return;
    seenInvoice.add(invoice.id);
    const month = invoice.date.slice(0, 7), id = `${supplier}:${code}:invoice:${invoice.id}`;
    const excluded = policy.outlierFiltering && reconciled.has(month) && !policy.restoredAnomalyIds.includes(id);
    anomalies.push({ id, code, date: invoice.date, invoice: invoice.id, quantity: round(invoice.quantity), threshold: round(threshold), reason: reason + (reconciled.has(month) ? "" : " Автокоррекция запрещена: нет сверки месячного итога."), excluded });
    if (excluded) removed.set(month, (removed.get(month) ?? 0) + invoice.quantity);
  };
  invoices.forEach((invoice, i) => {
    const month = invoice.date.slice(0, 7);
    const prior: number[] = [];
    for (let previous = i - 1; previous >= 0 && prior.length < 60; previous--) if (invoices[previous].quantity > 0 && invoices[previous].date < invoice.date) prior.push(invoices[previous].quantity);
    if (prior.length < ENGINE_THRESHOLDS.minimumPriorInvoices || intermittent || !series.some(p => p.month === month)) return;
    const priorMonths = series.filter(p => p.month < month).map(p => Math.max(0, p.quantity) / factors[monthIndex(p.month)]);
    const monthlyBaseline = median(priorMonths.filter(n => n > 0)) || baseline;
    const expected = monthlyBaseline * factors[monthIndex(month)];
    const threshold = Math.max(median(prior) + ENGINE_THRESHOLDS.madMultiplier * mad(prior) * 1.4826, quantile(prior, .75) + ENGINE_THRESHOLDS.iqrMultiplier * (quantile(prior, .75) - quantile(prior, .25)), expected * ENGINE_THRESHOLDS.monthlyRatio);
    if (invoice.quantity > threshold && invoice.quantity >= Math.max(0, totals.get(month) ?? 0) * ENGINE_THRESHOLDS.invoiceMonthlyShare && !persistent(month, series, factors, monthlyBaseline)) flagInvoice(invoice, threshold, "Разовый заказ: устойчивое превышение медианы/MAD, IQR и сезонного спроса; есть ≥6 предыдущих счетов.");
  });
  // Optional true customer IDs only; an invoice number is never used as a customer identifier.
  const customers = new Map<string, Invoice[]>();
  for (const invoice of invoices) if (invoice.customerId) { const rows = customers.get(invoice.customerId) ?? []; rows.push(invoice); customers.set(invoice.customerId, rows); }
  for (const customer of customers.values()) for (const last of customer) {
    const window = customer.filter(p => p.date <= last.date && diffDays(p.date, last.date) < 60);
    if (window.length < 2) continue;
    const previous = invoices.filter(p => p.date < window[0].date && p.quantity > 0);
    if (previous.length < ENGINE_THRESHOLDS.minimumPriorInvoices || intermittent) continue;
    const total = sum(window.map(p => p.quantity));
    const threshold = Math.max(baseline * 6, median(previous.map(p => p.quantity)) * 12);
    if (total > threshold && !persistent(last.date.slice(0, 7), series, factors, baseline)) for (const invoice of window) flagInvoice(invoice, threshold, "Аномальная сумма покупок одного обезличенного клиента за 60 дней; клиент определён по customerId.");
  }
  const cleaned = series.map(point => {
    let quantity = Math.max(0, point.quantity - (removed.get(point.month) ?? 0));
    // Monthly-only fallback applies solely where invoice totals cannot be safely reconciled.
    if (!reconciled.has(point.month) && !intermittent && positive.length >= 12) {
      const peers = series.filter(p => p.month !== point.month).map(p => Math.max(0, p.quantity) / factors[monthIndex(p.month)]);
      const center = median(peers), threshold = Math.max(center * 3, center + 6 * mad(peers) * 1.4826);
      if (quantity / factors[monthIndex(point.month)] > threshold && !persistent(point.month, series, factors, center)) {
        const id = `${supplier}:${code}:month:${point.month}`, excluded = policy.outlierFiltering && !policy.restoredAnomalyIds.includes(id);
        const replacement = center * factors[monthIndex(point.month)];
        anomalies.push({ id, code, date: `${point.month}-01`, quantity: round(quantity - replacement), threshold: round(threshold * factors[monthIndex(point.month)]), reason: "Месячный выброс после удаления сезонности: сравнение медианы и MAD; коррекция до типичного сезонного спроса.", excluded });
        if (excluded) quantity = replacement;
      }
    }
    return { month: point.month, quantity };
  });
  return { cleaned, anomalies };
}

function availabilityHistory(input: SupplierInput, product: Product, series: SeriesPoint[], raw: SeriesPoint[], stocks: SupplierInput["stocks"], invoices: Invoice[], factors: number[], policy: Policy, warnings: string[]): DemandPoint[] {
  const stock = new Map(stocks.map(p => [p.month, p.quantity]));
  const nonblank = stocks.filter(p => p.quantity !== null && Number.isFinite(p.quantity)).map(p => p.month).sort();
  const stockAt = (month: string): number | null => { if (!stock.has(month)) return null; const value = stock.get(month); return value === null || value === undefined ? nonblank.length && month > nonblank[0] && month < nonblank[nonblank.length - 1] ? 0 : null : finite(value); };
  const usable = series.filter(p => (stockAt(p.month) ?? 1) > 0).map(p => p.quantity / factors[monthIndex(p.month)]);
  const typical = median(usable.filter(n => n > 0)) || median(series.map(p => p.quantity / factors[monthIndex(p.month)]).filter(n => n > 0));
  let estimated = false;
  return series.map((point, i) => {
    const days = daysInMonth(point.month), expected = typical * factors[monthIndex(point.month)];
    let availability = 1, confirmed = false;
    const intervals = input.stockouts.filter(p => p.code === product.code && p.confirmed && p.start <= endOfMonth(point.month) && p.end >= `${point.month}-01`);
    if (intervals.length) {
      const missing = new Set<number>();
      for (const interval of intervals) for (let day = 1; day <= days; day++) { const date = `${point.month}-${String(day).padStart(2, "0")}`; if (date >= interval.start && date <= interval.end) missing.add(day); }
      availability = 1 - missing.size / days; confirmed = true;
    } else {
      const opening = stockAt(point.month), next = stockAt(addMonths(point.month, 1));
      if (expected > 0 && point.quantity < expected * .8 && (opening === 0 || next === 0)) {
        const saleDates = invoices.filter(p => p.date.startsWith(point.month) && p.quantity > 0).map(p => Number(p.date.slice(8, 10)));
        const fraction = next === 0 && opening !== 0 && saleDates.length ? Math.max(...saleDates) / days : point.quantity / expected;
        availability = clamp(fraction, .05, .95); estimated = true;
      }
    }
    const override = policy.availabilityOverrides[`${input.supplier}:${product.code}:${point.month}`] ?? policy.availabilityOverrides[`${input.supplier}:${product.code}`] ?? policy.availabilityOverrides[product.code];
    if (override !== undefined && Number.isFinite(override)) { availability = clamp(override, 0, 1); confirmed = false; estimated = true; }
    const capacity = Math.max(0, expected * 2 - point.quantity);
    const loss = (a: number) => policy.stockoutCompensation ? Math.min(capacity, expected * (1 - clamp(a, 0, 1))) : 0;
    const lost = loss(availability), sensitivity = confirmed ? 0 : ENGINE_THRESHOLDS.availabilitySensitivity;
    if (estimated && !warnings.includes("Доступность товара оценена по остаткам и продажам; интервал чувствительности ±0,25 не является доверительным интервалом.")) warnings.push("Доступность товара оценена по остаткам и продажам; интервал чувствительности ±0,25 не является доверительным интервалом.");
    return { month: point.month, raw: raw[i].quantity, cleaned: point.quantity, adjusted: point.quantity + lost, lost, lostLow: availability < 1 ? loss(availability + sensitivity) : 0, lostHigh: availability < 1 ? loss(availability - sensitivity) : 0, availability };
  });
}

function fitSeries(history: DemandPoint[], pooled: number[], product: Product, policy: Policy): Fit {
  const points = history.map(p => ({ month: p.month, quantity: p.adjusted }));
  const own = profile(points, pooled), fullYears = Math.floor(points.length / 12), weight = fullYears / (fullYears + 1);
  const factors = normalized(own.map((n, i) => weight * n + (1 - weight) * pooled[i]));
  const recent = points.slice(-12), values = recent.map(p => p.quantity / factors[monthIndex(p.month)]);
  const slope = theilSen(values), average = mean(values);
  // A new SKU or one with an all-period stockout has no demand basis at all (average === 0 across
  // every observed month); dividing/forecasting from zero would silently manufacture a zero
  // recommendation. Fall back to an explicit, editable per-category prior instead (BUILD_PLAN §1.4/§4.4).
  const hasDemandBasis = values.some(n => n > 0);
  const fallbackDemand = policy.categoryFallbackDemand[product.category];
  const usedCategoryFallback = !hasDemandBasis && fallbackDemand !== undefined && Number.isFinite(fallbackDemand) && fallbackDemand > 0;
  const inferred = average > 0 ? clamp(slope * 12 / average, -.5, .5) : 0;
  const supplied = policy.growthRate ?? product.growthRate;
  const growth = usedCategoryFallback ? 0 : supplied !== undefined && supplied !== null ? clamp(supplied + (policy.growthMode === "additive" ? inferred : 0), -.95, 5) : inferred;
  const growthSource = usedCategoryFallback ? "нет истории: рост не применяется" : policy.growthRate !== null ? "параметр сценария" : product.growthRate !== undefined ? "коэффициент из отчёта" : "робастный тренд Theil–Sen";
  // Anchor level at the last observed complete month; growth is applied from this reference only.
  const level = usedCategoryFallback ? Math.max(0, fallbackDemand!) : Math.max(0, average + (values.length > 1 ? clamp(slope, -average / 24, average / 24) * (values.length - 1) / 2 : 0));
  const errors: number[] = [];
  for (let i = 6; i < points.length; i++) {
    const training = points.slice(0, i), localFactors = profile(training), localRecent = training.slice(-12);
    const predicted = mean(localRecent.map(p => p.quantity / localFactors[monthIndex(p.month)])) * localFactors[monthIndex(points[i].month)];
    errors.push(points[i].quantity - predicted);
  }
  return { level, factors, growth, growthSource, reference: points.at(-1)?.month ?? "2026-08", errors, usedCategoryFallback };
}

function forecast(fit: Fit, month: string): number {
  return Math.max(0, finite(fit.level * fit.factors[monthIndex(month)] * (1 + fit.growth) ** (monthDistance(fit.reference, month) / 12)));
}

function stockAtCutoff(input: SupplierInput, product: Product, cutoff: string, snapshots: SupplierInput["currentStock"], stocks: SupplierInput["stocks"], transactions: SalesTransaction[], deliveries: SupplierInput["deliveries"], policy: Policy, warnings: string[]) {
  const override = policy.currentStockOverrides[`${input.supplier}:${product.code}`] ?? policy.currentStockOverrides[product.code];
  if (override !== undefined && Number.isFinite(override)) return { available: override, date: cutoff, kind: "override" };
  const known = snapshots.filter(p => p.date <= cutoff && p.available !== null && Number.isFinite(p.available)).sort((a, b) => b.date.localeCompare(a.date));
  const snapshot = known[0];
  if (snapshot?.kind === "current" || snapshot?.kind === "estimated") {
    if (snapshot.date < cutoff) warnings.push(`Остаток на ${snapshot.date}; движение после снимка не подтверждено.`);
    return { available: finite(snapshot.available), date: snapshot.date, kind: snapshot.kind };
  }
  const opening = snapshot ?? stocks.filter(p => `${p.month}-01` <= cutoff && p.quantity !== null).sort((a, b) => b.month.localeCompare(a.month)).map(p => ({ available: p.quantity, date: `${p.month}-01`, kind: "opening" as const }))[0];
  if (opening) {
    const sold = sum(transactions.filter(p => p.date.slice(0, 10) >= opening.date && p.date.slice(0, 10) <= cutoff).map(p => p.quantity));
    const received = sum(deliveries.filter(p => p.receivedDate && p.receivedDate >= opening.date && p.receivedDate <= cutoff).map(p => p.quantity));
    warnings.push("Текущий остаток оценён: начальный остаток − подписанные продажи + только подтверждённые поступления. ETA не доказывает получение.");
    return { available: finite(opening.available) - sold + received, date: opening.date, kind: "estimated" };
  }
  warnings.push("Текущий остаток неизвестен: для расчёта принято 0; требуется проверка менеджера.");
  return { available: 0, date: cutoff, kind: "unknown" };
}

export function calculatePlan(dataset: DatasetInput, overrides: Partial<Policy> = {}, filter: PlanFilter = {}): PlanResult {
  const policy: Policy = { ...DEFAULT_POLICY, ...overrides, categoryServiceLevels: { ...DEFAULT_POLICY.categoryServiceLevels, ...overrides.categoryServiceLevels }, categorySafetyDays: { ...DEFAULT_POLICY.categorySafetyDays, ...overrides.categorySafetyDays }, categoryFallbackDemand: { ...DEFAULT_POLICY.categoryFallbackDemand, ...overrides.categoryFallbackDemand }, restoredAnomalyIds: overrides.restoredAnomalyIds ?? [], availabilityOverrides: overrides.availabilityOverrides ?? {}, currentStockOverrides: overrides.currentStockOverrides ?? {} };
  policy.leadTimeDays = Math.round(clamp(policy.leadTimeDays, 0, 730)); policy.reviewDays = Math.round(clamp(policy.reviewDays, 0, 365)); policy.safetyDays = clamp(policy.safetyDays, 0, 365); policy.serviceLevel = clamp(policy.serviceLevel, .5, .9999);
  const cutoff = dataset.cutoffDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff) || !Number.isFinite(dateOf(cutoff).getTime())) throw new Error("Некорректная дата расчёта");
  const recommendations: Recommendation[] = [];
  for (const input of dataset.suppliers) {
    if (filter.supplier && input.supplier !== filter.supplier) continue;
    if (filter.suppliers?.length && !filter.suppliers.includes(input.supplier)) continue;
    const sales = grouped(input.sales), stocks = grouped(input.stocks), snapshots = grouped(input.currentStock), transactions = grouped(input.transactions), deliveries = grouped(input.deliveries);
    const complete = new Map(input.products.map(p => [p.code, seriesFrom(sales.get(p.code) ?? [], cutoff)]));
    const pool = new Map<string, number[][]>();
    for (const product of input.products) { const series = complete.get(product.code) ?? []; if (series.length < 12 || !series.some(p => p.quantity > 0)) continue; const profiles = pool.get(product.unit) ?? []; profiles.push(profile(series)); pool.set(product.unit, profiles); }
    const initialPooled = new Map([...pool].map(([unit, profiles]) => [unit, normalized(Array.from({ length: 12 }, (_, i) => median(profiles.map(p => p[i]))))]));
    const cleanByCode = new Map<string, ReturnType<typeof cleanSeries>>(), warningsByCode = new Map<string, string[]>();
    const cleanPool = new Map<string, number[][]>();
    for (const product of input.products) {
      const warnings: string[] = [];
      const clean = cleanSeries(product.code, input.supplier, complete.get(product.code) ?? [], invoiceRows(transactions.get(product.code) ?? [], cutoff), initialPooled.get(product.unit) ?? Array(12).fill(1), policy, warnings);
      cleanByCode.set(product.code, clean); warningsByCode.set(product.code, warnings);
      if (clean.cleaned.length >= 12 && clean.cleaned.some(p => p.quantity > 0)) { const profiles = cleanPool.get(product.unit) ?? []; profiles.push(profile(clean.cleaned)); cleanPool.set(product.unit, profiles); }
    }
    // Re-estimate pooled profiles after cleaning: an excluded historical spike cannot survive through the prior.
    const pooled = new Map([...cleanPool].map(([unit, profiles]) => [unit, normalized(Array.from({ length: 12 }, (_, i) => median(profiles.map(p => p[i]))))]));
    const supplierRows: Recommendation[] = [];
    for (const product of input.products) {
      const raw = complete.get(product.code) ?? [], warnings = warningsByCode.get(product.code) ?? [];
      const productStocks = (stocks.get(product.code) ?? []).filter(p => `${p.month}-01` <= cutoff), productTransactions = (transactions.get(product.code) ?? []).filter(p => p.date.slice(0, 10) <= cutoff);
      const productDeliveries = (deliveries.get(product.code) ?? []).filter(p => !p.orderDate || p.orderDate <= cutoff);
      const invoices = invoiceRows(productTransactions, cutoff), factors = pooled.get(product.unit) ?? Array(12).fill(1);
      const { cleaned, anomalies } = cleanByCode.get(product.code)!;
      const history = availabilityHistory(input, product, cleaned, raw, productStocks, invoices, factors, policy, warnings);
      const fit = fitSeries(history, factors, product, policy);
      if (fit.usedCategoryFallback) warnings.push(`Нет истории спроса (новый товар или полный дефицит за всё наблюдение): использован допущенный спрос по категории ${product.category} — ${round(fit.level, 1)} ${product.unit}/мес.`);
      const horizonDays = policy.leadTimeDays + policy.reviewDays, end = addDays(cutoff, horizonDays);
      const stock = stockAtCutoff(input, product, cutoff, snapshots.get(product.code) ?? [], productStocks, productTransactions, productDeliveries, policy, warnings);
      const inbound = productDeliveries.filter(p => (!p.receivedDate || p.receivedDate > cutoff) && p.eta > cutoff && p.eta <= end && finite(p.quantity) > 0);
      if (productDeliveries.some(p => (!p.receivedDate || p.receivedDate > cutoff) && p.eta <= cutoff)) warnings.push("Есть просроченные неподтверждённые поставки: в доступный остаток и будущие поступления они не включены.");
      if (productStocks.some(p => finite(p.quantity) < 0) || stock.available < 0) warnings.push("Отрицательный остаток сохранён как обязательство; проверьте исходные данные.");
      if (raw.length < 12) warnings.push("Менее 12 полных месяцев: сезонность и тренд имеют низкую надёжность.");
      if (product.moq === undefined) warnings.push("MOQ не задан; применяется минимальное техническое значение 1.");
      if (/бух|катуш|reel|упак/i.test(product.unit) && !product.unitConversion) warnings.push("Неизвестен коэффициент перевода упаковки/бухты в единицы спроса.");
      const inboundByDay = new Map<string, number>();
      for (const delivery of inbound) inboundByDay.set(delivery.eta, (inboundByDay.get(delivery.eta) ?? 0) + delivery.quantity);
      let balance = stock.available, forecastDemand = 0, firstShortageDate: string | null = stock.available < 0 ? cutoff : null;
      const projection: Recommendation["projection"] = [];
      for (let day = 1; day <= horizonDays; day++) {
        const date = addDays(cutoff, day), demand = forecast(fit, date.slice(0, 7)) / daysInMonth(date.slice(0, 7)), arriving = inboundByDay.get(date) ?? 0;
        balance += arriving - demand; forecastDemand += demand;
        if (balance < -1e-8 && !firstShortageDate) firstShortageDate = date;
        projection.push({ date, stock: round(balance), demand: round(demand, 8), inbound: arriving });
      }
      const serviceLevel = clamp(policy.categoryServiceLevels[product.category] ?? policy.serviceLevel, .5, .9999);
      const safetyDays = clamp(policy.categorySafetyDays[product.category] ?? policy.safetyDays, 0, 365);
      const statisticalSafety = fit.errors.length >= 12 ? Math.max(0, quantile(fit.errors, serviceLevel)) * Math.sqrt(horizonDays / 30) : normalQuantile(serviceLevel) * std(fit.errors) * Math.sqrt(horizonDays / 30);
      const safetyStock = horizonDays > 0 ? Math.max(statisticalSafety, forecastDemand / horizonDays * safetyDays) : 0;
      const eligibleInbound = sum(inbound.map(p => p.quantity));
      const rawNeed = Math.max(0, forecastDemand + safetyStock - stock.available - eligibleInbound);
      // moq and multiple are procurement-unit constraints. Recommendations always use the demand unit.
      const conversion = product.unitConversion && product.unitConversion > 0 ? product.unitConversion : 1;
      const moq = Math.max(0, finite(product.moq, 1)) * conversion, multiple = Math.max(.000001, finite(product.multiple, 1) || 1) * conversion;
      const quantity = rawNeed <= 1e-8 ? 0 : round(Math.ceil((Math.max(rawNeed, moq) - 1e-9) / multiple) * multiple, 6);
      const coverDays = firstShortageDate ? Math.max(0, diffDays(cutoff, firstShortageDate) - 1) : forecastDemand > 0 ? Math.max(horizonDays, stock.available / (forecastDemand / Math.max(horizonDays, 1))) : null;
      const nextArrival = inbound.map(p => p.eta).sort()[0];
      const shortageBeforeInbound = firstShortageDate !== null && (!nextArrival || firstShortageDate < nextArrival);
      const urgency = firstShortageDate && firstShortageDate < addDays(cutoff, policy.leadTimeDays) ? "CRITICAL" : firstShortageDate ? "HIGH" : "NORMAL";
      const excludedQuantity = sum(anomalies.filter(p => p.excluded).map(p => p.quantity)), lostDemand = sum(history.map(p => p.lost));
      // Anomaly share: how much of the observed demand was excluded as a one-off. A heavily corrected
      // history is less trustworthy even when every other signal looks clean.
      const observedDemand = sum(raw.map(p => Math.max(0, finite(p.quantity))));
      const anomalyShare = observedDemand > 0 ? clamp(excludedQuantity / observedDemand, 0, 1) : 0;
      const confidence = fit.usedCategoryFallback || warnings.some(p => /неизвест|расходятся|Неизвест|Менее/.test(p)) || stock.kind === "estimated" || raw.length < 12 || anomalyShare > .3
        ? "low"
        : warnings.length || raw.length < 24 || anomalyShare > .1
          ? "medium"
          : "high";
      const assumptions = ["Обучение использует только полные месяцы до даты расчёта; незавершённый месяц исключён.", "Сезонные индексы нормированы до среднего 1; объединение только внутри единиц измерения.", "Категории не имеют придуманного смысла; уровни сервиса и дни запаса — редактируемые допущения.", fit.errors.length >= 12 ? `Страховой запас: эмпирический квантиль ${fit.errors.length} последовательных ошибок × √(H/30), минимум ${safetyDays} дней.` : `Страховой запас: z × σ ошибки за месяц × √(H/30), минимум ${safetyDays} дней; ошибки предполагаются независимыми.`, `Пороговые значения: ${JSON.stringify(ENGINE_THRESHOLDS)}`, `Рост отсчитывается от ${fit.reference}, режим ${policy.growthMode}; денежные сезонные коэффициенты поставщика не участвуют в прогнозе.`, ...(conversion !== 1 ? [`MOQ и кратность переведены в единицы спроса с коэффициентом ${conversion}.`] : []), ...(fit.usedCategoryFallback ? [`Нет наблюдаемого спроса: базовый спрос заменён допущением по категории ${product.category}, а не делением на ноль.`] : [])];
      const provenance: Recommendation["provenance"] = { baseMonthlyDemand: round(fit.level), seasonalFactors: fit.factors.map(n => round(n, 6)), annualGrowth: round(fit.growth, 6), growthSource: fit.growthSource, horizonDays, forecastDemand: round(forecastDemand), safetyStock: round(safetyStock), availableStock: round(stock.available), stockDate: stock.date, stockKind: stock.kind, eligibleInbound: round(eligibleInbound), excludedQuantity: round(excludedQuantity), lostDemand: round(lostDemand), lostDemandLow: round(sum(history.map(p => p.lostLow))), lostDemandHigh: round(sum(history.map(p => p.lostHigh))), rawNeed: round(rawNeed), moq, multiple, serviceLevel, assumptions };
      const explanation = `Базовый спрос ${round(fit.level, 1)} ${product.unit}/мес. Исключено разовых продаж: ${round(excludedQuantity, 1)}; восстановленный упущенный спрос: ${round(lostDemand, 1)} (диапазон ${provenance.lostDemandLow}–${provenance.lostDemandHigh}; оценка при отсутствии подтверждённых интервалов). Сезонность следующего месяца ×${round(fit.factors[monthIndex(addMonths(cutoff.slice(0, 7), 1))], 2)}; годовой рост ${round(fit.growth * 100, 1)}% (${fit.growthSource}). На ${horizonDays} дней: спрос ${provenance.forecastDemand} + страховой запас ${provenance.safetyStock} − доступный остаток ${provenance.availableStock} − подтверждённые по графику будущие поставки ${provenance.eligibleInbound} = чистая потребность ${provenance.rawNeed}. MOQ ${moq}, кратность ${multiple} → заказ ${quantity} ${product.unit}. Срочность: ${urgency === "CRITICAL" ? "КРИТИЧЕСКАЯ" : urgency === "HIGH" ? "ВЫСОКАЯ" : "ОБЫЧНАЯ"}; ${firstShortageDate ? `первый дефицит ${firstShortageDate}` : "дефицита в горизонте нет"}. Остаток: ${stock.kind}, дата ${stock.date}.`;
      const historyWithForecast = history.map(p => ({ ...p }));
      const firstForecastMonth = endOfMonth(cutoff.slice(0, 7)) <= cutoff ? addMonths(cutoff.slice(0, 7), 1) : cutoff.slice(0, 7);
      for (let month = firstForecastMonth; month <= end.slice(0, 7); month = addMonths(month, 1)) {
        const monthToDate = month === cutoff.slice(0, 7) ? sum((sales.get(product.code) ?? []).filter(p => p.month === month).map(p => finite(p.quantity))) : 0;
        historyWithForecast.push({ month, raw: monthToDate, cleaned: monthToDate, adjusted: monthToDate, lost: 0, lostLow: 0, lostHigh: 0, availability: 1, forecast: round(forecast(fit, month)) });
      }
      const cv = mean(history.map(p => p.adjusted)) > 0 ? std(history.map(p => p.adjusted)) / mean(history.map(p => p.adjusted)) : Infinity;
      supplierRows.push({ key: `${input.supplier}:${product.code}`, supplier: input.supplier, code: product.code, supplierArticle: product.supplierArticle, name: product.name, unit: product.unit, category: product.category, abc: "C", xyz: cv <= .5 ? "X" : cv <= 1 ? "Y" : "Z", cost: product.cost, quantity, urgency, confidence, needsReview: recommendationNeedsReview({ confidence, warnings, anomalies }), coverDays: coverDays === null ? null : round(coverDays, 1), firstShortageDate, shortageBeforeInbound, explanation, warnings: [...new Set(warnings)], provenance, history: historyWithForecast, projection, anomalies });
    }
    const abcGroups = new Map<string, Recommendation[]>();
    for (const row of supplierRows) { const key = input.supplier === "SE" && row.cost !== undefined && row.cost > 0 ? "value" : `unit:${row.unit}`; const rows = abcGroups.get(key) ?? []; rows.push(row); abcGroups.set(key, rows); }
    for (const [key, rows] of abcGroups) {
      const weight = (row: Recommendation) => sum(row.history.filter(p => p.forecast === undefined).slice(-12).map(p => p.adjusted)) * (key === "value" ? finite(row.cost) : 1);
      rows.sort((a, b) => weight(b) - weight(a)); const total = sum(rows.map(weight)); let cumulative = 0;
      for (const row of rows) { const fraction = total > 0 ? cumulative / total : 1; row.abc = fraction < .8 ? "A" : fraction < .95 ? "B" : "C"; cumulative += weight(row); }
    }
    recommendations.push(...supplierRows.filter(p => !filter.category || p.category === filter.category));
  }
  const rank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
  recommendations.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity) || a.key.localeCompare(b.key));
  // Import diagnostics belong to the dataset. This summary contains only assumptions
  // actually used by the returned calculation rows; product warnings remain on each row.
  return { recommendations, policy, cutoffDate: cutoff, warnings: [...new Set(recommendations.flatMap(row => row.provenance.assumptions))] };
}

/** Public daily-consistent monthly forecast values for scenario charts and rolling-origin evaluation. */
export function forecastMonthlySeries(dataset: DatasetInput, months: string[]): Map<string, Map<string, number>> {
  const farthest = months.slice().sort().at(-1);
  const days = farthest ? Math.max(1, diffDays(dataset.cutoffDate, endOfMonth(farthest))) : 1;
  const result = calculatePlan(dataset, { leadTimeDays: days, reviewDays: 0 });
  return new Map(result.recommendations.map(row => [row.key, new Map(row.history.filter(p => p.forecast !== undefined && months.includes(p.month)).map(p => [p.month, p.forecast!]))]));
}
