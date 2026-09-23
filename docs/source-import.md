# Lossless supplier workbook import

Read **one workbook per invocation** and seed existing Railway **production PostgreSQL**. No local PostgreSQL is started or used. Source preservation and planning interpretation are separate stages. The explicitly selected case archives now feed the application through a versioned PostgreSQL-to-planning mapping.

## Preservation contract

- `SourceWorkbook`: supplier, original filename, SHA-256, parser version, original XLSX bytes, workbook XML metadata, relationships and shared-string structures.
- `SourceSheet`: original order, name, XML part path, declared dimension, sheet attributes and worksheet metadata, including column definitions and merge declarations.
- `SourceRow`: every physically present row, including header, total, hidden, empty and repeated rows. Identity is `(sheetId, ordinal)`, never product code. Original row attributes and an ordered JSONB cell array remain queryable in PostgreSQL.
- Every cell retains attributes (address/type/style/etc.), exact lexical `<v>` content, formula tree and attributes, resolved untrimmed text, and additional XML children. Numbers stay strings, avoiding rounding/coercion. No value element is `null`; an empty value element is `""`; numeric zero is `"0"`. An error-typed cell without a value differs from a stored error such as `#N/A`.
- Array/shared formulas and cached results remain separate. External references are preserved and never fetched or recalculated. Date serials and date text are not converted.

The **original byte archive is authoritative** for full-file fidelity, including ZIP layout, XML lexical syntax, comments, formatting, external links and features not projected individually. The queryable projection is not a regenerated Excel file. Missing row/cell XML nodes are not invented from declared dimensions, which are unusual in several supplied files. No duplicates, document types or report totals are filtered out. No missing quantity is replaced with zero. Display text retains OOXML escape sequences; raw structures and original bytes remain available.

## Commands

Use Node 24, `npm ci`, `npm run db:generate`, an authenticated Railway CLI linked to this project, and a registered Railway SSH key for private-network access. Parser-only operation needs no database:

```sh
npx tsx scripts/import-source.ts --supplier IEK --file "case and data/IEK/MOQ  ИЭК.xlsx"
```

Apply committed additive migrations to the verified production target:

```sh
npx tsx scripts/with-production-db.ts node_modules/.bin/prisma migrate deploy
```

Import and read back every row:

```sh
npx tsx scripts/import-source.ts --supplier IEK --file "case and data/IEK/MOQ  ИЭК.xlsx" --write
```

Use `--supplier SE` for Systeme Electric. Each invocation accepts one reviewed file; separate workbook imports can run concurrently. The script accepts no directory import. `--write` resolves credentials from Railway, not `.env`, and verifies the project/environment/PostgreSQL service IDs in `scripts/railway-production.ts`. If PostgreSQL has no public URL, a temporary loopback **SSH relay to production** runs through the existing application container. This listener is not a local database. No network setting or deployment changes; the relay closes afterwards. Credentials stay in memory and are not printed. The application container needs Node for this transport.

Each workbook imports atomically. Identical supplier + file bytes + parser version reuses and verifies the existing archive; duplicate source rows remain preserved. Changed files/versions create separate archives. Failed transactions roll back all new rows. No `Dataset`, `Product`, order or approval is rewritten. There is no reset command.

Verification compares original bytes/hash, all sheet and workbook metadata, and every row/cell read back from PostgreSQL. Output contains only identifiers, hashes and counts. Counts include headers, totals and empty physical rows. Summary `errors` counts XML type `e`, including cells without stored values; it does not mean every such cell contains a named Excel error.

## Query PostgreSQL directly

Bind archive ID, sheet ordinal and row range as parameters. Do not send partner results to logs or public routes.

```sql
SELECT r.ordinal, c.cell->'attributes'->>'r' AS address,
       c.cell->'attributes'->>'t' AS source_type,
       c.cell->'value' AS raw_value,
       c.cell->'text' AS source_text,
       c.cell->'formula' AS formula
FROM "SourceSheet" s
JOIN "SourceRow" r ON r."sheetId" = s.id
CROSS JOIN LATERAL jsonb_array_elements(r.cells) WITH ORDINALITY AS c(cell, position)
WHERE s."workbookId" = $1 AND s.ordinal = $2
  AND r.ordinal BETWEEN $3 AND $4
ORDER BY r.ordinal, c.position;
```

Partner files and detailed audit artifacts remain git-ignored and Docker-excluded. Raw tables have no public HTTP route. The application reads derived planning tables whose file manifest records each immutable workbook ID and hash. Original bytes and raw rows remain unchanged.

## Checks and references

```sh
npx vitest run tests/ingest/raw-workbook.test.ts
npm run typecheck
```

Synthetic tests cover repeated, hidden and empty rows; misleading dimensions; rich/inline text; large numeric strings; zero/absent/empty/error values; shared formulas; and malformed ZIP/XML rejection. Private Python `zipfile`/`ElementTree` inventories independently compare all partner rows/cells against the TypeScript parser; these artifacts are not committed.

Implementation references: [Prisma 7 transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions), [Saxes](https://github.com/lddubeau/saxes), [JSZip reads](https://stuk.github.io/jszip/documentation/api_zipobject/async.html), [Railway PostgreSQL](https://docs.railway.com/databases/postgresql).

## PostgreSQL-to-planning mapping

`lib/repo/source-planning.ts` reads selected archive IDs, sheet order and rows in bounded pages from PostgreSQL. `lib/ingest/source-mapping.ts` interprets these stored cells without reading local files or reparsing XLSX bytes. The mapping version is separate from the lossless parser version. Select one revision per supplier/filename; ambiguous selections fail. Original source facts remain unchanged, while business rules explicitly select planning facts, resolve repeated codes and preserve warnings/provenance.

```sh
# Repeat --workbook for every selected SourceWorkbook ID; omit --write for a read-only mapping check.
npx tsx scripts/map-sources.ts --workbook <archive-id> --workbook <another-id> --write
```

The derived dataset is atomic and idempotent for the selected archive IDs, hashes, mapping version and cutoff. Changed mappings or selected revisions create a new dataset. Existing orders and approval snapshots are not rewritten. The case selector and history exclude synthetic/legacy datasets; they are retained in the database for preservation. New uploads also archive originals first and use this same PostgreSQL mapping.

Categories are literal source codes: the supplied IEK files have no category column. Systeme Electric supplies `Категория 2026` at `TDSheet!E2` in its transit workbook for 497 of 724 distinct products; 227 are absent from that report. Missing categories display as “Не указана в источнике”; they receive no invented business classification. ABC/XYZ remain separate calculated classifications.

Named Excel errors such as `#N/A` retain their exact cell provenance and produce one field warning. Cells typed as errors without a stored error value are identified separately from ordinary blank cells; both remain unavailable numeric inputs. Import issues and calculation assumptions are shown separately. Dataset checks use the selected real inputs; synthetic demonstration checks are available only to domain tests, not the case route.
