import { parseWorkbooks, PARSER_VERSION } from "@/lib/ingest";
import { saveDataset, withJob, AppError } from "@/lib/repo";
import { apiError, rejectCrossOrigin, readCappedBody, rateLimit } from "@/lib/http";
import type { Supplier } from "@/lib/contracts/engine";
export const runtime="nodejs";
export const maxDuration=300;
const MAX_UPLOAD_BYTES=80*1024*1024;
export async function POST(request:Request){try{
  rejectCrossOrigin(request);
  rateLimit(request,"import",5,60_000);
  // Read the whole body through a byte-capped streaming reader first: Content-Length is attacker-controlled
  // and chunked-encoded requests can omit it entirely, so it cannot be trusted to bound request.formData()'s
  // internal buffering. Multipart is then re-parsed from the already-capped buffer.
  const contentType=request.headers.get("content-type")??"";
  if(contentType.includes("application/json"))throw new AppError("Импорт встроенных данных удалён. Используйте сохранённые наборы из базы данных.",410);
  const body=await readCappedBody(request,MAX_UPLOAD_BYTES);
  const dataset=await withJob("IMPORT",async()=>{
    const form=await new Response(new Uint8Array(body),{headers:{"content-type":contentType}}).formData();
    const uploaded=form.getAll("files").filter((f):f is File=>f instanceof File);
    if(!uploaded.length||uploaded.length>24)throw new AppError("Upload between 1 and 24 Excel workbooks");
    if(uploaded.reduce((n,f)=>n+f.size,0)>MAX_UPLOAD_BYTES)throw new AppError("Combined upload exceeds 80 MB",413);
    const supplier=form.get("supplier");
    const files=await Promise.all(uploaded.map(async f=>{
      if(!f.name.toLowerCase().endsWith(".xlsx")||f.name.startsWith("~$")||f.size>20*1024*1024)throw new AppError("Only .xlsx workbooks up to 20 MB each are supported");
      return{name:f.name,buffer:Buffer.from(await f.arrayBuffer()),supplier:(supplier==="IEK"||supplier==="SE"?supplier:undefined) as Supplier|undefined};
    }));
    let parsed;
    try{parsed=await parseWorkbooks(files,{name:String(form.get("name")||"Загруженные данные").slice(0,120),synthetic:false,cutoffDate:"2026-09-22"});}catch(e){throw new AppError(e instanceof Error?e.message:"Invalid workbook");}
    return saveDataset(parsed,PARSER_VERSION);
  });return Response.json({dataset});
}catch(e){return apiError(e);}}
