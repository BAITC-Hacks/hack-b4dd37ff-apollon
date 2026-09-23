import { getDb } from "@/lib/db";
export const runtime="nodejs";
export async function GET(){try{await getDb().$queryRaw`SELECT 1`;return Response.json({status:"ok",database:"connected",copilotConfigured:Boolean(process.env.OPENAI_API_KEY)});}catch{return Response.json({status:"unavailable",database:"disconnected"},{status:503});}}
