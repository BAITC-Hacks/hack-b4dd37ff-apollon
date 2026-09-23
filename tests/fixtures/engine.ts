import type { DatasetInput, Product, SupplierInput } from "../../lib/contracts/engine";

export const SEASON_PATTERN = [.65, .7, .8, .9, 1, 1.05, 1.1, 1.2, 1.5, 1.4, 1, .7];
export function makeEngineFixture(options: { seasonal?: boolean; stockout?: boolean; spike?: boolean; growth?: boolean; customer?: boolean } = {}): DatasetInput {
  const product: Product = { code: "SYN-001", supplierArticle: "DEMO-001", name: "Синтетический проверочный товар", unit: "шт", category: "2", moq: 1, multiple: 1, cost: 100 };
  const supplier: SupplierInput = { supplier: "SE", products: [product], sales: [], stocks: [], currentStock: [{ code: product.code, date: "2026-09-22", available: 10, kind: "current" }], transactions: [], deliveries: [], stockouts: [], seasonality: Array(12).fill(1), issues: [] };
  for (let year = 2024; year <= 2026; year++) for (let month = 1; month <= (year === 2026 ? 8 : 12); month++) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const growth = options.growth && key >= "2026-01" ? 2 : 1;
    let quantity = 120 * (options.seasonal ? SEASON_PATTERN[month - 1] : 1) * growth;
    if (options.stockout && (key === "2026-05" || key === "2026-06")) quantity = 20;
    supplier.sales.push({ code: product.code, month: key, quantity });
    supplier.stocks.push({ code: product.code, month: key, quantity: options.stockout && (key === "2026-05" || key === "2026-06") ? null : 300 });
    for (let invoice = 0; invoice < 6; invoice++) supplier.transactions.push({ code: product.code, date: `${key}-${String(invoice * 4 + 1).padStart(2, "0")}`, invoice: `SYN-${key}-${invoice}`, quantity: quantity / 6, customerId: options.customer ? `NORMAL-${invoice}` : undefined });
  }
  if (options.spike) {
    supplier.sales.find(row => row.month === "2026-07")!.quantity! += 6000;
    supplier.transactions.push({ code: product.code, date: "2026-07-28", invoice: "SYN-ONE-OFF", quantity: 6000 });
  }
  if (options.customer) {
    for (let i = 0; i < 10; i++) supplier.transactions.push({ code: product.code, date: `2026-07-${String(i + 1).padStart(2, "0")}`, invoice: `SYN-CUSTOMER-${i}`, quantity: 100, customerId: "SYN-CUSTOMER" });
    supplier.sales.find(row => row.month === "2026-07")!.quantity! += 1000;
  }
  return { name: "DEMO — синтетические проверки, реальные клиенты отсутствуют", synthetic: true, cutoffDate: "2026-09-22", suppliers: [supplier], files: [] };
}
