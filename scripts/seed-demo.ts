import "dotenv/config";
import { readDirectory, PARSER_VERSION } from "../lib/ingest/index";
import { saveDataset } from "../lib/repo/index";
import { getDb } from "../lib/db";
async function main(){const input=await readDirectory(process.env.DEMO_DATA_DIR??"sample-data",{name:"Apollon · демонстрационные данные",synthetic:true,cutoffDate:"2026-09-22"});const dataset=await saveDataset(input,PARSER_VERSION,{reuseExisting:true});console.log(`Demo ready: ${dataset.id}, ${dataset.productCount} products, ${dataset.issueCount} import issues`);}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;}).finally(async()=>{await getDb().$disconnect();});
