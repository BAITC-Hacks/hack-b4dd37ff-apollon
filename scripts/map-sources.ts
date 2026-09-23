import { parseArgs } from "node:util";
import { productionDatabaseConnection } from "./railway-production";
import { mapSourceWorkbooks, SOURCE_MAPPING_VERSION } from "../lib/ingest/source-mapping";
import { planningSources } from "../lib/repo/source-planning";
import { getDb } from "../lib/db";
import { saveDataset } from "../lib/repo";

const { values } = parseArgs({ options: { workbook: { type: "string", multiple: true }, name: { type: "string", default: "IEK и Systeme Electric — данные кейса" }, write: { type: "boolean", default: false } }, strict: true });
if (!values.workbook?.length) throw new Error("Supply --workbook <archive-id> for every selected source revision; --write saves the derived dataset");
const connection = await productionDatabaseConnection();
try {
  process.env.DATABASE_URL = connection.url;
  process.env.APOLLON_PRODUCTION_RELAY = "1";
  const db = getDb();
  try {
    const input = await mapSourceWorkbooks(planningSources(db, values.workbook), { name: values.name, synthetic: false, cutoffDate: "2026-09-22" });
    const summary = { mappingVersion: SOURCE_MAPPING_VERSION, files: input.files.length, suppliers: input.suppliers.map(s => ({ supplier: s.supplier, products: s.products.length, transactions: s.transactions.length, issues: s.issues.length, categoriesMissing: s.products.filter(p => p.category === "unknown").length })) };
    if (values.write) {
      const saved = await saveDataset(input, SOURCE_MAPPING_VERSION, { reuseExisting: true });
      console.log(JSON.stringify({ ...summary, datasetId: saved.id, storedProducts: saved.productCount }, null, 2));
    } else console.log(JSON.stringify(summary, null, 2));
  } finally { await db.$disconnect(); }
} finally { await connection.close(); }
