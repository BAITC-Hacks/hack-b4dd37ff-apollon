import "dotenv/config";
import { readDirectory, PARSER_VERSION } from "../lib/ingest/index";
import { saveDataset } from "../lib/repo/index";
import { getDb } from "../lib/db";
async function main(){const i=process.argv.indexOf("--dir");const directory=i>=0?process.argv[i+1]:process.env.DATA_DIR??"case and data";if(!directory)throw new Error("Supply a directory after --dir");const input=await readDirectory(directory,{name:"IEK / Systeme Electric · партнёрские данные",synthetic:false,cutoffDate:"2026-09-22"});const result=await saveDataset(input,PARSER_VERSION);console.log(`Imported ${result.productCount} products; dataset ${result.id}; ${result.issueCount} issues`);}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;}).finally(async()=>{await getDb().$disconnect();});
