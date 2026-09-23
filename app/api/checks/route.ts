import { runCaseChecks } from "@/lib/engine/checks";
import { calculatePlan } from "@/lib/engine";
import { loadDataset } from "@/lib/repo";
import { apiError, rejectCrossOrigin, readJson } from "@/lib/http";
import { checksRequestSchema } from "@/lib/contracts/api";
export async function POST(request:Request){try{rejectCrossOrigin(request);const body=checksRequestSchema.parse((await readJson(request))??{});const d=body.datasetId?await loadDataset(body.datasetId):undefined;const checks=runCaseChecks(d);let realChecks=null;if(d){const result=calculatePlan(d);realChecks={synthetic:d.synthetic,rows:result.recommendations.length,finiteQuantities:result.recommendations.every(r=>Number.isFinite(r.quantity)&&r.quantity>=0),allExplained:result.recommendations.every(r=>r.explanation.length>0),flaggedAnomalies:result.recommendations.reduce((n,r)=>n+r.anomalies.length,0),productsWithEstimatedLostDemand:result.recommendations.filter(r=>r.provenance.lostDemand>0).length,note:"Data checks demonstrate calculation consistency; lost demand is estimated, not measured ground truth."};}return Response.json({checks,realChecks});}catch(e){return apiError(e);}}
