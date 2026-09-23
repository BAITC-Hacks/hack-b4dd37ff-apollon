import { getRun } from "@/lib/repo";
import { apiError } from "@/lib/http";
export async function GET(_r:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json({run:await getRun((await params).id)});}catch(e){return apiError(e);}}
