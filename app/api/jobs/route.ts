import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
export async function GET(){try{const jobs=await getDb().job.findMany({orderBy:{createdAt:"desc"},take:20});return Response.json({jobs:jobs.map(j=>({...j,status:j.status==="RUNNING"&&Date.now()-j.createdAt.getTime()>15*60*1000?"INTERRUPTED":j.status}))});}catch(e){return apiError(e);}}
