import { approvedExport, AppError } from "@/lib/repo";
import { apiError } from "@/lib/http";
import { supplierCsv,supplierWorkbook,supplierEmail,exportColumns,type ExportColumn } from "@/lib/export";
export const runtime="nodejs";
export async function GET(request:Request){try{
 const q=new URL(request.url).searchParams;const id=q.get("orderId"),revision=Number(q.get("revision")),format=q.get("format")??"csv";
 if(!id||!Number.isInteger(revision)||revision<1)throw new AppError("Order ID and approved revision are required");
 if(!["csv","xlsx","email"].includes(format))throw new AppError("Unsupported export format");
 const{order,lines}=await approvedExport(id,revision);
 const requested=q.get("columns")?.split(",") as ExportColumn[]|undefined;
 if(requested&&(!requested.length||requested.some(c=>!(c in exportColumns))))throw new AppError("Invalid export column mapping");
 const body=format==="xlsx"?new Uint8Array(await supplierWorkbook(lines,order)):format==="email"?supplierEmail(lines,order):supplierCsv(lines,requested);
 return new Response(body,{headers:{"Content-Type":format==="xlsx"?"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":format==="email"?"text/plain; charset=utf-8":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="apollon-${order.supplier}-${revision}.${format==="email"?"txt":format}"`,"Cache-Control":"no-store"}});
}catch(e){return apiError(e);}}
