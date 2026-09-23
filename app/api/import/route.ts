import { readDirectory, parseWorkbooks, PARSER_VERSION } from "@/lib/ingest";
import { saveDataset, withJob, AppError } from "@/lib/repo";
import { apiError, rejectCrossOrigin } from "@/lib/http";
import type { Supplier } from "@/lib/contracts/engine";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request){try{
  rejectCrossOrigin(request);
  if(Number(request.headers.get("content-length"))>80*1024*1024)throw new AppError("Upload exceeds 80 MB",413);
  const dataset=await withJob("IMPORT",async()=>{
    if(request.headers.get("content-type")?.includes("application/json")){
      const body=await request.json();if(body.source!=="demo")throw new AppError("Choose demo or upload workbooks");
      return saveDataset(await readDirectory(process.env.DEMO_DATA_DIR??"sample-data",{name:"Apollon · демонстрационные данные",synthetic:true,cutoffDate:"2026-09-22"}),PARSER_VERSION);
    }
    const form=await request.formData();const uploaded=form.getAll("files").filter((f):f is File=>f instanceof File);
    if(!uploaded.length||uploaded.length>24)throw new AppError("Upload between 1 and 24 Excel workbooks");
    if(uploaded.reduce((n,f)=>n+f.size,0)>80*1024*1024)throw new AppError("Combined upload exceeds 80 MB",413);
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
