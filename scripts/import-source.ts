import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { parseRawWorkbook, rawWorkbookSummary } from "../lib/ingest/raw-workbook";
import { PRODUCTION, productionDatabaseConnection } from "./railway-production";

async function main() {
  const { values } = parseArgs({ options: { file: { type: "string" }, supplier: { type: "string" }, write: { type: "boolean", default: false } }, strict: true });
  if (!values.file || !values.supplier || !["IEK", "SE"].includes(values.supplier)) throw new Error("Usage: tsx scripts/import-source.ts --supplier IEK|SE --file <one.xlsx> [--write]");
  const book = await parseRawWorkbook(await readFile(values.file));
  if (!values.write) { console.log(JSON.stringify({ mode: "parse-only", ...rawWorkbookSummary(book) }, null, 2)); return; }
  const connection = await productionDatabaseConnection();
  try {
    process.env.DATABASE_URL = connection.url;
    process.env.APOLLON_PRODUCTION_RELAY = "1";
    const [{ getDb }, { saveRawWorkbook }] = await Promise.all([import("../lib/db"), import("../lib/repo/raw-workbook")]);
    const db = getDb();
    try {
      console.log(JSON.stringify({ target: PRODUCTION, filename: basename(values.file), phase: "import-and-verify" }));
      console.log(JSON.stringify(await saveRawWorkbook(db, book, basename(values.file), values.supplier), null, 2));
    } finally { await db.$disconnect(); }
  } finally { await connection.close(); }
}
main().catch(() => { console.error("Source import failed. No success is claimed. Inspect source structure, Railway access and migration status; raw values and credentials are intentionally omitted."); process.exitCode = 1; });
