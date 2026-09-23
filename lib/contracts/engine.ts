/** Pure serializable domain contracts. No persistence or framework dependencies. */
export type Supplier = "IEK" | "SE";
export type Confidence = "high" | "medium" | "low";
export interface SourceRef { file: string; sheet?: string; row?: number; cell?: string; workbookId?: string }
export interface ImportIssue { severity: "info" | "warning" | "error"; message: string; code?: string; supplier?: Supplier; source?: SourceRef }
export interface SourceFile { name: string; hash: string; supplier: Supplier; kind: string; rows: number; workbookId?: string }
export interface Product {
  code: string; name: string; supplierArticle: string; unit: string; category: string;
  cost?: number; moq?: number; multiple?: number; unitConversion?: number; growthRate?: number; source?: SourceRef;
}
export interface MonthlySale { code: string; month: string; quantity: number | null; source?: SourceRef }
export interface StockPoint { code: string; month: string; quantity: number | null; source?: SourceRef }
export interface StockSnapshot { code: string; date: string; available: number | null; reserved?: number; kind: "current" | "opening" | "estimated"; source?: SourceRef }
export interface SalesTransaction { code: string; date: string; invoice: string; quantity: number; customerId?: string; warehouse?: string; source?: SourceRef }
export interface Delivery { code: string; quantity: number; eta: string; orderDate?: string; receivedDate?: string; source?: SourceRef }
export interface StockoutInterval { code: string; start: string; end: string; confirmed: boolean }
export interface SupplierInput {
  supplier: Supplier; products: Product[]; sales: MonthlySale[]; stocks: StockPoint[]; currentStock: StockSnapshot[];
  transactions: SalesTransaction[]; deliveries: Delivery[]; stockouts: StockoutInterval[]; seasonality: number[]; issues: ImportIssue[];
}
export interface DatasetInput { name: string; synthetic: boolean; cutoffDate: string; suppliers: SupplierInput[]; files: SourceFile[] }
export interface Policy {
  leadTimeDays: number; reviewDays: number; serviceLevel: number; safetyDays: number;
  growthRate: number | null; growthMode: "replace" | "additive"; stockoutCompensation: boolean; outlierFiltering: boolean;
  categoryServiceLevels: Record<string, number>; categorySafetyDays: Record<string, number>;
  /** Additive (2026-09-23): explicit per-category monthly demand prior used only when a SKU has zero
   *  observed demand basis (new SKU or fully unavailable history), so the engine never falls back to a
   *  silent zero. Labelled as an assumption in provenance when applied. */
  categoryFallbackDemand: Record<string, number>;
  restoredAnomalyIds: string[]; availabilityOverrides: Record<string, number>; currentStockOverrides: Record<string, number>;
}
export const DEFAULT_POLICY: Policy = {
  leadTimeDays: 45, reviewDays: 30, serviceLevel: 0.95, safetyDays: 7, growthRate: null, growthMode: "replace",
  stockoutCompensation: true, outlierFiltering: true,
  categoryServiceLevels: { "1": 0.98, "2": 0.95, "3": 0.92, "5": 0.90, "7": 0.85 },
  categorySafetyDays: {}, categoryFallbackDemand: {}, restoredAnomalyIds: [], availabilityOverrides: {}, currentStockOverrides: {},
};
export interface AnomalyFlag { id: string; code: string; date: string; invoice?: string; quantity: number; threshold: number; reason: string; excluded: boolean }
export interface DemandPoint { month: string; raw: number; cleaned: number; adjusted: number; lost: number; lostLow: number; lostHigh: number; availability: number; forecast?: number }
export interface ProjectionPoint { date: string; stock: number; demand: number; inbound: number }
export interface Provenance {
  baseMonthlyDemand: number; seasonalFactors: number[]; annualGrowth: number; growthSource: string;
  horizonDays: number; forecastDemand: number; safetyStock: number; availableStock: number; stockDate: string; stockKind: string;
  eligibleInbound: number; excludedQuantity: number; lostDemand: number; lostDemandLow: number; lostDemandHigh: number;
  rawNeed: number; moq: number; multiple: number; serviceLevel: number; assumptions: string[];
}
export interface Recommendation {
  key: string; supplier: Supplier; code: string; supplierArticle: string; name: string; unit: string; category: string;
  abc: "A" | "B" | "C"; xyz: "X" | "Y" | "Z"; cost?: number;
  quantity: number; urgency: "CRITICAL" | "HIGH" | "NORMAL"; confidence: Confidence; needsReview: boolean;
  coverDays: number | null; firstShortageDate: string | null; shortageBeforeInbound: boolean;
  explanation: string; warnings: string[]; provenance: Provenance; history: DemandPoint[]; projection: ProjectionPoint[]; anomalies: AnomalyFlag[];
}
export interface PlanFilter { supplier?: Supplier; category?: string }
export interface PlanResult { recommendations: Recommendation[]; policy: Policy; cutoffDate: string; warnings: string[] }
export interface CaseCheck { id: string; name: string; passed: boolean; details: string; values: Record<string, number | string | boolean> }
export interface BacktestRow {
  supplier: Supplier; code: string; unit: string; origin: string; month: string;
  /** Additive (2026-09-23): forecast horizon in months (1-3) from the origin, so metrics can be reported per horizon. */
  horizon: number;
  actual: number; predicted: number; seasonalNaive: number; meanBaseline: number;
}
export interface BacktestResult {
  rows: BacktestRow[];
  /** Additive (2026-09-23): metrics are grouped by horizon and by unit so incompatible units (шт vs м) are never summed together. */
  metrics: { model: string; horizon: number; unit: string; mae: number; wape: number | null; bias: number; count: number }[];
  warnings: string[];
}
