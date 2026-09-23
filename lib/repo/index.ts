import { createHash, randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { SOURCE_MAPPING_VERSION } from "@/lib/ingest/source-mapping";
import type { Prisma, Dataset, Order, Run } from "@/generated/prisma/client";
import type { DatasetInput, SupplierInput, Product, PlanResult, PlanFilter, Recommendation, Policy } from "@/lib/contracts/engine";
import type { DatasetSummary, OrderView, RunView, ExportLine } from "@/lib/contracts/api";

export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function group<T extends {code: string}>(rows: T[]): Map<string,T[]> { const map = new Map<string,T[]>(); for(const row of rows) { const existing=map.get(row.code); if(existing) existing.push(row); else map.set(row.code,[row]); } return map; }
const datasetSelect = { id: true, name: true, synthetic: true, cutoffDate: true, createdAt: true, files: true, issues: true, _count: {select: {products: true}} } as const;
function summary(d: Pick<Dataset, "id"|"name"|"synthetic"|"cutoffDate"|"createdAt"|"files"|"issues"> & {_count:{products:number}}): DatasetSummary {
  return {id:d.id,name:d.name,synthetic:d.synthetic,cutoffDate:d.cutoffDate,createdAt:d.createdAt.toISOString(),files:d.files as unknown as DatasetInput["files"],productCount:d._count.products,issueCount:Array.isArray(d.issues)?d.issues.length:0};
}
export async function listDatasets(): Promise<DatasetSummary[]> { return (await getDb().dataset.findMany({where:{synthetic:false,parserVersion:SOURCE_MAPPING_VERSION},select:datasetSelect,orderBy:{createdAt:"desc"},take:100})).map(summary); }
export async function saveDataset(input: DatasetInput, parserVersion: string, options: { reuseExisting?: boolean } = {}): Promise<DatasetSummary> {
  const db=getDb();
  const hash=createHash("sha256").update(JSON.stringify({parserVersion,cutoff:input.cutoffDate,synthetic:input.synthetic,files:input.files.map(f=>`${f.supplier}:${f.name}:${f.hash}:${f.workbookId??""}`).sort(),importId:options.reuseExisting?undefined:randomUUID()})).digest("hex");
  const existing=await db.dataset.findUnique({where:{contentHash:hash},select:datasetSelect}); if(existing) return summary(existing);
  if(!input.suppliers.some(s=>s.products.length)) throw new AppError("No valid products were found. Check workbook headers and supplier selection.");
  try {
    const id=await db.$transaction(async tx=>{
      const d=await tx.dataset.create({data:{name:input.name,contentHash:hash,synthetic:input.synthetic,cutoffDate:input.cutoffDate,parserVersion,files:json(input.files),issues:json(input.suppliers.flatMap(s=>s.issues)),suppliers:json(input.suppliers.map(s=>({supplier:s.supplier,seasonality:s.seasonality,issues:s.issues})))}});
      for(const s of input.suppliers){
        const sales=group(s.sales), stocks=group(s.stocks), current=group(s.currentStock), transactions=group(s.transactions), deliveries=group(s.deliveries), stockouts=group(s.stockouts);
        for(let offset=0;offset<s.products.length;offset+=100){
          await tx.product.createMany({data:s.products.slice(offset,offset+100).map(p=>({datasetId:d.id,supplier:s.supplier,code:p.code,name:p.name,article:p.supplierArticle,unit:p.unit,category:p.category,attributes:json(p),monthlySales:json(sales.get(p.code)??[]),stockHistory:json(stocks.get(p.code)??[]),currentStock:json(current.get(p.code)??[]),transactions:json(transactions.get(p.code)??[]),deliveries:json(deliveries.get(p.code)??[]),stockouts:json(stockouts.get(p.code)??[])}))});
        }
      }
      return d.id;
    },{timeout:120000,maxWait:15000});
    return summary(await db.dataset.findUniqueOrThrow({where:{id},select:datasetSelect}));
  }catch(error){
    const raced=await db.dataset.findUnique({where:{contentHash:hash},select:datasetSelect}); if(raced)return summary(raced); throw error;
  }
}
export async function loadDataset(id:string, options: { includeLegacy?: boolean } = {}):Promise<DatasetInput>{
  const db=getDb();
  const d=await db.dataset.findUnique({where:{id},select:{name:true,synthetic:true,cutoffDate:true,parserVersion:true,files:true,suppliers:true}}); if(!d)throw new AppError("Dataset not found",404);
  if(!options.includeLegacy && (d.synthetic || d.parserVersion!==SOURCE_MAPPING_VERSION))throw new AppError("Выберите актуальный набор из исходных данных PostgreSQL.",410);
  const meta=d.suppliers as unknown as Pick<SupplierInput,"supplier"|"seasonality"|"issues">[];
  const suppliers:SupplierInput[]=meta.map(m=>({...m,products:[],sales:[],stocks:[],currentStock:[],transactions:[],deliveries:[],stockouts:[]}));
  const bySupplier=new Map(suppliers.map(s=>[s.supplier,s]));
  // Decode bounded result pages rather than one JSON-heavy Product relation. Keep only
  // the final normalized facts; product/page wrappers can be collected between queries.
  const append=<T>(target:T[],source:T[])=>{for(const row of source)target.push(row);};
  let afterId:string|undefined;
  while(true){
    const page=await db.product.findMany({where:{datasetId:id,...(afterId?{id:{gt:afterId}}:{})},orderBy:{id:"asc"},take:100,
      select:{id:true,supplier:true,attributes:true,monthlySales:true,stockHistory:true,currentStock:true,transactions:true,deliveries:true,stockouts:true}});
    if(!page.length)break;
    for(const p of page){
      const supplier=bySupplier.get(p.supplier as SupplierInput["supplier"]);
      if(!supplier)throw new AppError("Product supplier is missing from dataset metadata",500);
      supplier.products.push(p.attributes as unknown as Product);
      append(supplier.sales,p.monthlySales as unknown as SupplierInput["sales"]);
      append(supplier.stocks,p.stockHistory as unknown as SupplierInput["stocks"]);
      append(supplier.currentStock,p.currentStock as unknown as SupplierInput["currentStock"]);
      append(supplier.transactions,p.transactions as unknown as SupplierInput["transactions"]);
      append(supplier.deliveries,p.deliveries as unknown as SupplierInput["deliveries"]);
      append(supplier.stockouts,p.stockouts as unknown as SupplierInput["stockouts"]);
    }
    afterId=page[page.length-1].id;
  }
  return {name:d.name,synthetic:d.synthetic,cutoffDate:d.cutoffDate,files:d.files as unknown as DatasetInput["files"],suppliers};
}
function orderView(o:Order):OrderView{return{id:o.id,supplier:o.supplier,revision:o.revision,status:o.status as OrderView["status"],approver:o.approver,approvedAt:o.approvedAt?.toISOString()??null,quantities:o.quantities as Record<string,number>,approvedKeys:o.approvedKeys as string[]};}
function runView(r:Run & {orders:Order[]}):RunView{return{id:r.id,datasetId:r.datasetId,createdAt:r.createdAt.toISOString(),result:r.result as unknown as PlanResult,orders:r.orders.map(orderView)};}
export async function saveRun(datasetId:string,result:PlanResult,filter:PlanFilter={},baseRunId?:string):Promise<RunView>{
  const suppliers=[...new Set(result.recommendations.map(r=>r.supplier))];
  const r=await getDb().run.create({data:{datasetId,policy:json(result.policy),filter:json(filter),result:json(result),engineVersion:"1.0.0",inputHash:createHash("sha256").update(JSON.stringify({datasetId,filter,policy:result.policy})).digest("hex"),baseRunId,orders:{create:suppliers.map(s=>({supplier:s,quantities:json(Object.fromEntries(result.recommendations.filter(r=>r.supplier===s).map(r=>[r.key,r.quantity]))),approvedKeys:[]}))}},include:{orders:true}});
  const view=runView(r);
  if(baseRunId){const base=await getDb().run.findUnique({where:{id:baseRunId}});if(base&&base.datasetId===datasetId){const prior=new Map((base.result as unknown as PlanResult).recommendations.map(r=>[r.key,r.quantity]));view.scenarioDelta=result.recommendations.map(r=>({key:r.key,before:prior.get(r.key)??0,after:r.quantity,delta:r.quantity-(prior.get(r.key)??0)}));}}
  return view;
}
export async function getRun(id:string):Promise<RunView>{const r=await getDb().run.findUnique({where:{id},include:{orders:true}});if(!r)throw new AppError("Run not found",404);return runView(r);}
export async function listRuns(datasetId?:string){return getDb().run.findMany({where:{...(datasetId?{datasetId}:{}),dataset:{synthetic:false,parserVersion:SOURCE_MAPPING_VERSION}},select:{id:true,datasetId:true,createdAt:true,baseRunId:true,_count:{select:{orders:true}}},orderBy:{createdAt:"desc"},take:30});}
const MAX_ORDER_QUANTITY=1_000_000;
const PIECE_UNITS=new Set(["шт","штук","pcs","pc"]);
function validateEditedQuantity(quantity:number,unit:string|undefined):void{
  if(typeof quantity!=="number"||!Number.isFinite(quantity))throw new AppError("Quantity must be a finite number");
  if(quantity<0)throw new AppError("Quantity cannot be negative");
  if(quantity>MAX_ORDER_QUANTITY)throw new AppError("Quantity is unreasonably large");
  if(unit&&PIECE_UNITS.has(unit)&&!Number.isInteger(quantity))throw new AppError("Quantity must be a whole number for piece units");
}
function validateApproverName(approver:string):string{
  const trimmed=approver.trim();
  if(!trimmed)throw new AppError("Approver name is required");
  if(trimmed.length>200)throw new AppError("Approver name is too long");
  return trimmed;
}
export async function editOrder(id:string,expectedRevision:number,edits:{key:string;quantity:number}[]):Promise<OrderView>{
 return getDb().$transaction(async tx=>{
  const o=await tx.order.findUnique({where:{id},include:{run:true}});if(!o)throw new AppError("Order not found",404);
  const quantities=Object.assign(Object.create(null) as Record<string,number>,o.quantities as Record<string,number>);
  const recs=(o.run.result as unknown as PlanResult).recommendations.filter(r=>r.supplier===o.supplier);
  const units=new Map(recs.map(r=>[r.key,r.unit]));
  for(const e of edits){
    if(!Object.hasOwn(quantities,e.key))throw new AppError("Product does not belong to this order");
    validateEditedQuantity(e.quantity,units.get(e.key));
    quantities[e.key]=e.quantity;
  }
  const updated=await tx.order.updateMany({where:{id,revision:expectedRevision},data:{quantities:json(quantities),revision:{increment:1},status:"DRAFT",approver:null,approvedAt:null,approvedKeys:[]}});
  if(!updated.count)throw new AppError("This order changed. Reload it before saving.",409);
  await tx.auditEvent.create({data:{orderId:id,action:"EDIT",revision:expectedRevision+1,detail:json(edits)}});
  return orderView(await tx.order.findUniqueOrThrow({where:{id}}));
 });
}
export async function approveOrder(id:string,expectedRevision:number,approver:string,acknowledgedEstimates:boolean,keys?:string[]):Promise<OrderView>{
 const approverName=validateApproverName(approver);
 return getDb().$transaction(async tx=>{
  const o=await tx.order.findUnique({where:{id},include:{run:true}});if(!o)throw new AppError("Order not found",404);
  const quantities=Object.assign(Object.create(null) as Record<string,number>,o.quantities as Record<string,number>);
  const recs=(o.run.result as unknown as PlanResult).recommendations.filter(r=>r.supplier===o.supplier);
  const selected=keys??recs.filter(r=>quantities[r.key]>0).map(r=>r.key);
  if(!selected.length)throw new AppError("Select at least one positive order line");
  if(new Set(selected).size!==selected.length||selected.some(k=>!Object.hasOwn(quantities,k)))throw new AppError("Invalid selected order lines");
  const lines:ExportLine[]=selected.map(k=>{const recommendation=recs.find(r=>r.key===k);if(!recommendation)throw new AppError("Recommendation missing");return{recommendation,quantity:quantities[k]};});
  for(const {quantity:q,recommendation:r} of lines){
    if(!Number.isFinite(q)||q<=0)throw new AppError("Approved quantities must be positive");
    const multiple=r.provenance.multiple||1;
    if(q<r.provenance.moq||Math.abs(q/multiple-Math.round(q/multiple))>1e-7)throw new AppError(`${r.code}: quantity must satisfy MOQ ${r.provenance.moq} and multiple ${multiple}`);
  }
  if(lines.some(l=>l.recommendation.needsReview||l.recommendation.confidence==="low")&&!acknowledgedEstimates)throw new AppError("Acknowledge estimated inputs and review warnings before approval");
  const revision=expectedRevision+1;
  const changed=await tx.order.updateMany({where:{id,revision:expectedRevision},data:{status:"APPROVED",revision,approver:approverName,approvedAt:new Date(),approvedKeys:json(selected)}});
  if(!changed.count)throw new AppError("This order changed. Reload it before approval.",409);
  await tx.approval.create({data:{orderId:id,revision,approver:approverName,acknowledgedEstimates,snapshot:json(lines)}});
  await tx.auditEvent.create({data:{orderId:id,action:"APPROVE",actor:approverName,revision,detail:json({keys:selected})}});
  return orderView(await tx.order.findUniqueOrThrow({where:{id}}));
 });
}
export async function approvedExport(id:string,revision:number){
 const o=await getDb().order.findUnique({where:{id},include:{approvals:{where:{revision}}}});
 if(!o)throw new AppError("Order not found",404);
 if(o.status!=="APPROVED"||o.revision!==revision||!o.approvals[0])throw new AppError("Only the current frozen approved revision can be exported",409);
 return {order:orderView(o),lines:o.approvals[0].snapshot as unknown as ExportLine[]};
}
export async function orderAudit(id:string){return getDb().auditEvent.findMany({where:{orderId:id},orderBy:{createdAt:"desc"},take:100});}
export async function withJob<T>(type:string,work:()=>Promise<T>):Promise<T>{
 const db=getDb();const job=await db.job.create({data:{type}});
 try{const result=await work();await db.job.update({where:{id:job.id},data:{status:"SUCCEEDED",finishedAt:new Date()}});return result;}
 catch(error){await db.job.update({where:{id:job.id},data:{status:"FAILED",error:error instanceof AppError?error.message:"Operation failed; inspect server logs",finishedAt:new Date()}});throw error;}
}
export type { Policy, Recommendation };
