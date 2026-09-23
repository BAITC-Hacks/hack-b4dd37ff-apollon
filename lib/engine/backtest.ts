import type { BacktestResult, DatasetInput } from "../contracts/engine";
import { forecastMonthlySeries } from "./index";
import { addMonths, endOfMonth, mean, monthDistance, round, sum } from "./math";

/** Rebuild all model inputs at each origin; future snapshots, transactions and receipts cannot leak. */
export function backtest(dataset: DatasetInput): BacktestResult {
  const rows: BacktestResult["rows"] = [], warnings: string[] = [];
  const latestActual = dataset.cutoffDate < "2026-08-31" ? dataset.cutoffDate : "2026-08-31";
  for (const originMonth of ["2026-05", "2026-06", "2026-07"]) {
    const origin = endOfMonth(originMonth);
    if (origin >= latestActual) continue;
    const months = [1, 2, 3].map(n => addMonths(originMonth, n)).filter(month => endOfMonth(month) <= latestActual);
    const training: DatasetInput = { ...dataset, cutoffDate: origin, suppliers: dataset.suppliers.map(input => ({
      ...input,
      // Supplied growth and monetary coefficients have no historical version timestamp.
      products: input.products.map(product => ({ ...product, growthRate: undefined })),
      sales: input.sales.filter(row => row.month <= originMonth),
      stocks: input.stocks.filter(row => `${row.month}-01` <= origin),
      currentStock: input.currentStock.filter(row => row.date <= origin),
      transactions: input.transactions.filter(row => row.date.slice(0, 10) <= origin),
      deliveries: input.deliveries.filter(row => row.orderDate && row.orderDate <= origin).map(row => ({ ...row, receivedDate: row.receivedDate && row.receivedDate <= origin ? row.receivedDate : undefined })),
      stockouts: input.stockouts.filter(row => row.start <= origin).map(row => ({ ...row, end: row.end > origin ? origin : row.end })),
      seasonality: Array(12).fill(1),
    })) };
    const predictions = forecastMonthlySeries(training, months);
    for (const supplier of dataset.suppliers) {
      const sales = new Map<string, Map<string, number>>();
      for (const row of supplier.sales) if (row.quantity !== null && Number.isFinite(row.quantity)) {
        const product = sales.get(row.code) ?? new Map<string, number>();
        product.set(row.month, (product.get(row.month) ?? 0) + row.quantity); sales.set(row.code, product);
      }
      for (const product of supplier.products) {
        const actuals = sales.get(product.code) ?? new Map<string, number>();
        const history = [...actuals].filter(([month]) => month <= originMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([, quantity]) => Math.max(0, quantity));
        if (!history.length) continue;
        for (const month of months) {
          const actual = actuals.get(month), predicted = predictions.get(`${supplier.supplier}:${product.code}`)?.get(month);
          if (actual === undefined || predicted === undefined) continue;
          const horizon = monthDistance(originMonth, month);
          rows.push({ supplier: supplier.supplier, code: product.code, unit: product.unit, origin, month, horizon, actual: Math.max(0, actual), predicted, seasonalNaive: Math.max(0, actuals.get(addMonths(month, -12)) ?? mean(history)), meanBaseline: mean(history) });
        }
      }
    }
  }
  warnings.push("Каждый прогноз переобучен на своём срезе. Неверсионированные коэффициенты роста из текущего отчёта исключены; полные фактические месяцы ограничены августом 2026.");
  warnings.push("Оценивается наблюдаемый спрос: фактические продажи могут быть ограничены дефицитом. Метрики сгруппированы по горизонту и единице измерения; разные единицы никогда не суммируются.");
  if (!rows.length) warnings.push("Нет подходящих полных фактических месяцев для исторической проверки.");
  // Group by (horizon, unit) so sample counts are reported per horizon and quantities from
  // incompatible units (шт vs м) are never summed into a single denominator or error total.
  const groups = new Map<string, typeof rows>();
  for (const row of rows) { const key = `${row.horizon}:${row.unit}`, list = groups.get(key) ?? []; list.push(row); groups.set(key, list); }
  const metrics = ([['Модель', 'predicted'], ['Сезонный наивный', 'seasonalNaive'], ['Среднее 12 месяцев', 'meanBaseline']] as const).flatMap(([model, key]) =>
    [...groups.entries()].map(([groupKey, groupRows]) => {
      const [horizon, unit] = groupKey.split(":"), errors = groupRows.map(row => row[key] - row.actual), denominator = sum(groupRows.map(row => Math.abs(row.actual)));
      return { model, horizon: Number(horizon), unit, mae: round(mean(errors.map(Math.abs))), wape: denominator > 0 ? round(sum(errors.map(Math.abs)) / denominator, 6) : null, bias: round(mean(errors)), count: groupRows.length };
    })
  ).sort((a, b) => a.horizon - b.horizon || a.unit.localeCompare(b.unit) || a.model.localeCompare(b.model));
  return { rows, metrics, warnings };
}
