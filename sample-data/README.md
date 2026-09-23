# Synthetic partner-layout data

These 12 XLSX files are generated, fictional data, not copied partner records. Each supplier has 24 fictional products and January 2024–September 2026 monthly history. The cutoff is 22 September 2026; September is partial. Product names and codes explicitly identify synthetic records.

Run `npx tsx scripts/make-demo-data.ts` to regenerate byte-identical archives. These are test fixtures only: they are excluded from Docker and Railway uploads, and are not seeded at startup. Tests exercise `readDirectory` / `parseWorkbooks` from `lib/ingest`; no precomputed recommendations are present. Real IEK files are preserved in Railway PostgreSQL through the separate [source importer](../docs/source-import.md).

The six layouts per supplier reproduce the original worksheet names, Russian headers, header offsets, total rows, numeric/formula cell styles and zero-as-blank monthly display. Differences that supply otherwise unavailable evidence are labelled: transactions have an optional `anonymized_customer_id` column; each MOQ workbook has `Supplements (SYNTHETIC)` with confirmed stockout intervals and an explicit reel/metre conversion. IEK shipment dates include an overdue and a long-dated shipment to exercise timeline handling. The generator uses seeded noise, varied line sizes, sparse sales, seasonal profiles, positive and negative adjustments and blank stock patterns; it does not reproduce real partner volumes.

| Code suffix (both suppliers) | Scenario |
|---|---|
| `001_` | Strong summer seasonality |
| `002_` | Sustained demand growth; SE additionally supplies +30% business growth |
| `003_` | Reduced April–May 2026 sales with interior blank stock; estimated lost sales |
| `004_` | Same shortage pattern with a labelled confirmed interval |
| `005_` | A 50× one-off invoice in February 2026 |
| `006_` | Ten invoices for a single synthetic project customer in March 2026 |
| `007_` | Metres in demand/stock, reels in purchasing; explicit 305 metres/reel |
| `008_` | Small demand, MOQ/pack rounding |
| `009_` | High stock and early inbound |
| `010_` | Low stock and IEK inbound after the planning horizon |
| `011_` | Signed returns |
| `012_`, `015_`, `018_`, `021_`, `024_` | Intermittent/new-item history |
| `013_` | IEK overdue ETA, without any receipt confirmation |
| `021_` | Missing MOQ row |
| `022_` | Deliberately malformed historical numeric cell |
| `023_` | Missing MOQ (`#N/A`) and one negative stock observation |
| `024_` | Product first appears in February 2026; earlier stock is unknown |

Duplicates, an unfulfilled customer order and a malformed invoice are deliberately included to make the import audit verifiable. Original eight transaction columns retain their meaning: invoice IDs are orders, never customer identities.
