import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/lib/repo";
export function apiError(error:unknown){
  if(error instanceof ZodError)return NextResponse.json({error:"Invalid request",details:error.issues},{status:400});
  if(error instanceof AppError)return NextResponse.json({error:error.message},{status:error.status});
  if(error instanceof SyntaxError)return NextResponse.json({error:"Invalid JSON request"},{status:400});
  console.error("Application operation failed",error instanceof Error?{name:error.name,message:error.message}:"unknown error");
  return NextResponse.json({error:"The operation could not complete. Check database connectivity or the uploaded workbook and try again."},{status:500});
}
export function rejectCrossOrigin(request:Request){const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin&&origin!==`https://${request.headers.get("host")}`)throw new AppError("Cross-origin mutation rejected",403);}
