import { runRequestSchema } from "@/lib/contracts/api";
import { calculatePlan } from "@/lib/engine";
import { listRuns, loadDataset, saveRun, withJob, getRun, AppError } from "@/lib/repo";
import { apiError, rejectCrossOrigin, readJson } from "@/lib/http";
export const maxDuration=300;
export async function GET(request:Request){try{return Response.json({runs:await listRuns(new URL(request.url).searchParams.get("datasetId")??undefined)});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{rejectCrossOrigin(request);const b=runRequestSchema.parse(await readJson(request));
  const run=await withJob("CALCULATE",async()=>{if(b.baseRunId&&(await getRun(b.baseRunId)).datasetId!==b.datasetId)throw new AppError("Scenario must use the same dataset");const d=await loadDataset(b.datasetId);return saveRun(b.datasetId,calculatePlan(d,b.policy,{supplier:b.supplier,category:b.category}),{supplier:b.supplier,category:b.category},b.baseRunId);});
  return Response.json({run});}catch(e){return apiError(e);}}
