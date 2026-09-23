import { z } from "zod";
import type { DatasetInput, PlanResult, Recommendation } from "./engine";
const quantity = z.number().finite().nonnegative().max(1e12);
export const policySchema = z.object({
  leadTimeDays: z.number().int().min(1).max(365), reviewDays: z.number().int().min(1).max(180),
  serviceLevel: z.number().min(0.5).max(0.999), safetyDays: z.number().min(0).max(180),
  growthRate: z.number().min(-0.95).max(3).nullable(), growthMode: z.enum(["replace", "additive"]),
  stockoutCompensation: z.boolean(), outlierFiltering: z.boolean(),
  categoryServiceLevels: z.record(z.string(), z.number().min(0.5).max(0.999)),
  categorySafetyDays: z.record(z.string(), z.number().min(0).max(180)),
  categoryFallbackDemand: z.record(z.string(), z.number().min(0).max(1e9)),
  restoredAnomalyIds: z.array(z.string()).max(10000),
  availabilityOverrides: z.record(z.string(), z.number().min(0).max(1)),
  currentStockOverrides: z.record(z.string(), quantity),
}).partial();
export const runRequestSchema = z.object({ datasetId: z.string().min(1), policy: policySchema.default({}), supplier: z.enum(["IEK", "SE"]).optional(), category: z.string().optional(), baseRunId: z.string().optional() });
export const editOrderSchema = z.object({ expectedRevision: z.number().int().nonnegative(), edits: z.array(z.object({ key: z.string(), quantity })).min(1).max(10000) });
export const approveOrderSchema = z.object({ expectedRevision: z.number().int().nonnegative(), approver: z.string().trim().min(2).max(100), acknowledgedEstimates: z.boolean(), keys: z.array(z.string()).optional() });
export const checksRequestSchema = z.object({ datasetId: z.string().min(1).max(200) });
export const backtestRequestSchema = z.object({ datasetId: z.string().min(1).max(200) });
export interface DatasetSummary { id: string; name: string; synthetic: boolean; cutoffDate: string; createdAt: string; productCount: number; issueCount: number; files: DatasetInput["files"] }
export interface OrderView { id: string; supplier: string; revision: number; status: "DRAFT" | "APPROVED"; approver: string | null; approvedAt: string | null; quantities: Record<string, number>; approvedKeys: string[] }
export interface RunView { id: string; datasetId: string; createdAt: string; result: PlanResult; orders: OrderView[]; scenarioDelta?: { key: string; before: number; after: number; delta: number }[] }
export interface ApiError { error: string; details?: unknown }
export interface JobView { id: string; type: string; status: string; error: string | null; createdAt: string; finishedAt: string | null }
export interface ExportLine { recommendation: Recommendation; quantity: number }
