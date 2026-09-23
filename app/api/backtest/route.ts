import { backtest } from "@/lib/engine/backtest";
import { loadDataset, withJob, AppError } from "@/lib/repo";
import { apiError, rejectCrossOrigin } from "@/lib/http";
export const maxDuration=300;
export async function POST(request:Request){try{rejectCrossOrigin(request);const b=await request.json();if(typeof b.datasetId!=="string")throw new AppError("Choose a dataset");return Response.json({backtest:await withJob("BACKTEST",async()=>backtest(await loadDataset(b.datasetId)))});}catch(e){return apiError(e);}}
