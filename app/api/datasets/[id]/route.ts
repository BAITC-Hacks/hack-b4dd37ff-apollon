import { loadDataset } from "@/lib/repo";
import { apiError } from "@/lib/http";
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){try{const d=await loadDataset((await params).id);return Response.json({name:d.name,synthetic:d.synthetic,cutoffDate:d.cutoffDate,files:d.files,suppliers:d.suppliers.map(s=>({supplier:s.supplier,productCount:s.products.length,transactionCount:s.transactions.length,categories:[...new Set(s.products.map(p=>p.category))].sort(),issues:s.issues,seasonality:s.seasonality}))});}catch(e){return apiError(e);}}
