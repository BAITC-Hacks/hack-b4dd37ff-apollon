import { editOrderSchema } from "@/lib/contracts/api";
import { editOrder, orderAudit } from "@/lib/repo";
import { apiError, rejectCrossOrigin } from "@/lib/http";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){try{rejectCrossOrigin(request);const b=editOrderSchema.parse(await request.json());return Response.json({order:await editOrder((await params).id,b.expectedRevision,b.edits)});}catch(e){return apiError(e);}}
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){try{return Response.json({events:await orderAudit((await params).id)});}catch(e){return apiError(e);}}
