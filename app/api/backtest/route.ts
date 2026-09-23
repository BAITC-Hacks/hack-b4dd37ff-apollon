import { backtest } from "@/lib/engine/backtest";
import { loadDataset, withJob } from "@/lib/repo";
import { apiError, rejectCrossOrigin, readJson } from "@/lib/http";
import { backtestRequestSchema } from "@/lib/contracts/api";
export const maxDuration=300;
export async function POST(request:Request){try{rejectCrossOrigin(request);const b=backtestRequestSchema.parse(await readJson(request));return Response.json({backtest:await withJob("BACKTEST",async()=>backtest(await loadDataset(b.datasetId)))});}catch(e){return apiError(e);}}
