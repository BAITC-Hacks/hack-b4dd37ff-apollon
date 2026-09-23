import { readdir, readFile } from "node:fs/promises";
import "dotenv/config";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { guessSupplier } from "../lib/ingest";
import { parseRawWorkbook } from "../lib/ingest/raw-workbook";

const DATASET_NAME = "Синтетические данные sample-data — IEK и Systeme Electric";
const SUPPLIER_DIRS: { dir: string; supplier: "IEK" | "SE" }[] = [
  { dir: "IEK", supplier: "IEK" },
  { dir: "Systeme electric", supplier: "SE" },
];

async function main() {
  const { values } = parseArgs({ options: { dir: { type: "string" } }, strict: true });
  const root = resolve(values.dir ?? process.env.APOLLON_SAMPLE_DATA_DIR ?? "sample-data");

  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set. This seed script requires a local judge/dev database (see .env.example).");
  const host = new URL(process.env.DATABASE_URL).hostname;
  if (host.endsWith(".railway.internal") || host.endsWith(".proxy.rlwy.net")) {
    throw new Error("Refusing to seed synthetic sample data into a Railway database. This script is for local judge/dev databases only.");
  }
  if (process.env.APOLLON_LOCAL_DB !== "1") process.env.APOLLON_LOCAL_DB = "1";

  const { getDb } = await import("../lib/db");
  const { saveRawWorkbook } = await import("../lib/repo/raw-workbook");
  const { materializeSourceDataset } = await import("../lib/repo/source-planning");

  const db = getDb();
  try {
    const ids: string[] = [];
    for (const { dir, supplier } of SUPPLIER_DIRS) {
      const folder = join(root, dir);
      const files = (await readdir(folder)).filter((name) => name.toLowerCase().endsWith(".xlsx") && !name.startsWith("~$"));
      if (!files.length) throw new Error(`No .xlsx workbooks found in ${folder}`);
      for (const filename of files) {
        const resolvedSupplier = guessSupplier(filename) ?? supplier;
        const buffer = await readFile(join(folder, filename));
        const book = await parseRawWorkbook(buffer);
        const saved = await saveRawWorkbook(db, book, filename, resolvedSupplier);
        console.log(JSON.stringify({ filename, supplier: resolvedSupplier, reused: saved.reused, id: saved.id }));
        ids.push(saved.id);
      }
    }
    const dataset = await materializeSourceDataset(db, [...new Set(ids)], DATASET_NAME);
    console.log(JSON.stringify({ dataset: { id: dataset.id, name: dataset.name, productCount: dataset.productCount, issueCount: dataset.issueCount } }, null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("Sample data seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
