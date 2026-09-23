import { listDatasets } from "@/lib/repo";
import { apiError } from "@/lib/http";
export async function GET(){try{return Response.json({datasets:await listDatasets()});}catch(e){return apiError(e);}}
