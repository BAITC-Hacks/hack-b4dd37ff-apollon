import { approveOrderSchema } from "@/lib/contracts/api";
import { approveOrder } from "@/lib/repo";
import { apiError, rejectCrossOrigin } from "@/lib/http";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{rejectCrossOrigin(request);const b=approveOrderSchema.parse(await request.json());return Response.json({order:await approveOrder((await params).id,b.expectedRevision,b.approver,b.acknowledgedEstimates,b.keys)});}catch(e){return apiError(e);}}
