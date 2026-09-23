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
// Origin is not sent by curl/CLI clients and legitimately absent for same-origin browser requests in some
// configurations, so this cannot fail closed on Origin alone. sec-fetch-site is set by all modern browsers
// and is the more reliable signal: any cross-site/same-site value (as opposed to "none"/absent, i.e. a
// direct/non-fetch navigation such as curl) is rejected outright. When Origin is present it must match the
// request's own origin, accounting for Railway's reverse proxy rewriting host/proto via x-forwarded-*. When
// both signals are absent (curl, server-to-server, judges' scripts) the request is allowed through.
export function rejectCrossOrigin(request:Request){
  const secFetchSite=request.headers.get("sec-fetch-site");
  if(secFetchSite==="cross-site"||secFetchSite==="same-site")throw new AppError("Cross-origin mutation rejected",403);
  const origin=request.headers.get("origin");
  if(!origin)return;
  const url=new URL(request.url);
  const forwardedHost=request.headers.get("x-forwarded-host")??request.headers.get("host");
  const forwardedProto=request.headers.get("x-forwarded-proto")??url.protocol.replace(":","");
  const effectiveOrigin=forwardedHost?`${forwardedProto}://${forwardedHost}`:url.origin;
  if(origin!==url.origin&&origin!==effectiveOrigin)throw new AppError("Cross-origin mutation rejected",403);
}
// Reads the request body as a byte stream, aborting once maxBytes is exceeded, instead of trusting
// Content-Length (which chunked-encoded requests can omit or misreport) or buffering an unbounded body
// via request.formData()/request.json().
export async function readCappedBody(request:Request,maxBytes:number):Promise<Buffer>{
  const reader=request.body?.getReader();
  if(!reader)return Buffer.alloc(0);
  const chunks:Uint8Array[]=[];let total=0;
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!value)continue;
      total+=value.byteLength;
      if(total>maxBytes){await reader.cancel().catch(()=>{});throw new AppError("Request body too large",413);}
      chunks.push(value);
    }
  }finally{try{reader.releaseLock();}catch{/* already released via cancel */}}
  return Buffer.concat(chunks);
}
const DEFAULT_JSON_LIMIT=256*1024;
export async function readJson(request:Request,maxBytes:number=DEFAULT_JSON_LIMIT):Promise<unknown>{
  const buf=await readCappedBody(request,maxBytes);
  if(!buf.length)return undefined;
  return JSON.parse(buf.toString("utf-8"));
}
// Single-instance Railway deployment, so an in-process token bucket is sufficient (no shared cache needed).
// Keyed by the first hop of x-forwarded-for (the client closest to Railway's edge), falling back to a
// constant bucket when no proxy header is present (e.g. local dev, curl without the header).
const buckets=new Map<string,{tokens:number;updatedAt:number}>();
export function rateLimit(request:Request,scope:string,limit:number,windowMs:number){
  const forwardedFor=request.headers.get("x-forwarded-for");
  const client=forwardedFor?forwardedFor.split(",")[0].trim():"unknown";
  const key=`${scope}:${client}`;
  const now=Date.now();
  const bucket=buckets.get(key)??{tokens:limit,updatedAt:now};
  const elapsed=now-bucket.updatedAt;
  const refill=(elapsed/windowMs)*limit;
  bucket.tokens=Math.min(limit,bucket.tokens+refill);
  bucket.updatedAt=now;
  if(bucket.tokens<1){buckets.set(key,bucket);throw new AppError("Слишком много запросов. Повторите попытку позже.",429);}
  bucket.tokens-=1;
  buckets.set(key,bucket);
}
