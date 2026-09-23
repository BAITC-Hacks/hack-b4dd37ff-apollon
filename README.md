# Apollon — планирование закупок

**Current IEK and Systeme Electric import:** [lossless source import into Railway production PostgreSQL](docs/source-import.md). This preserves every source row/cell and original workbook bytes without interpretation. Docker contains no workbooks and performs no data seeding; development also connects to Railway production.

Explainable supplier replenishment for ТОО «Электрокомплект»: import IEK and Systeme Electric workbooks, review demand corrections and stock risk, calculate a purchase plan, approve a frozen revision, and download supplier drafts. The calculation is deterministic; an optional OpenAI assistant explains and invokes the same application services.

**Status: single-page UI and lossless source import implemented.** `npm run typecheck`, `npm run lint`, `npm test` (85/85) and `npm run build` all pass. The manager UI is now **one page at `/`** (`components/order-workspace.tsx`) covering the full journey — choose data, validate, calculate, review, adjust, approve, export — with a checks/backtest/trends dialog and a history panel, replacing the earlier multi-page app. The old routes `/import`, `/plan`, `/data`, `/checks`, `/backtest`, `/trends` and `/plan/[runId]/sku/[code]` were removed and now 404; their logic lives in API routes (`/api/import`, `/api/runs`, `/api/checks`, `/api/backtest`, `/api/trends`, `/api/history`) called from the single page. A Railway deployment exists at **https://apollon-production-59ea.up.railway.app**; releases are manually uploaded and verified by exact deployment ID. See [Known limitations](#limitations-and-safety) for the full list, and [the runbook](docs/runbook.md) for current deployment/data status.

## Run from a clean checkout

Use Node 24 LTS. PostgreSQL runs only in the existing Railway production service. Authenticate the Railway CLI, link this repository to its existing project, and register an SSH key for private access.

```sh
npm ci
npm run db:generate
npx tsx scripts/with-production-db.ts npm run dev
```

Open http://localhost:3000. The wrapper uses an authenticated temporary SSH relay to Railway PostgreSQL; it does not start a local database. Database-free checks are `npm test`, `npm run typecheck` and `npm run build`. `OPENAI_API_KEY` and `OPENAI_MODEL` configure the optional assistant only.

Migrations and source imports are explicit operations documented in [source import](docs/source-import.md). Startup never seeds data. Docker packages application code only; the previous local database/Compose setup has been removed.

## Manager walkthrough

Everything below happens on the single page at `/` (`components/order-workspace.tsx`). There is no sidebar and no page navigation — the workspace expands, collapses and opens dialogs in place. See [`UI_UX_REDESIGN_PROMPT.md`](UI_UX_REDESIGN_PROMPT.md) for the full interaction spec.

1. **Header:** the Электрокомплект logo and name, **«Новый расчёт»** (returns to data selection, offering to save unsaved quantity edits first) and **«История расчётов»** (opens a panel backed by `GET /api/history`, listing every saved run with date, dataset, scope and per-supplier order status; opening an entry loads that exact saved run, it never recalculates).
2. **Choose data:** two equal cards — **«Загрузить свои отчёты»** (drag-and-drop or file picker, same `lib/ingest` adapters as before) and **«Использовать данные кейса»** (lists datasets from `GET /api/datasets`, labelling synthetic datasets **«Демо-данные»** and real imports **«Данные кейса»**). Both paths produce the same `Dataset` record and feed the same calculation.
3. **Validate:** a "Проверка данных перед расчётом" summary shows file/product/transaction counts and import issues (errors vs. warnings/info), with **«Просмотреть данные»** opening a paginated data explorer dialog (`/api/data/*`) covering every imported row for both suppliers.
4. **Parameters:** supplier/category scope sits next to **«Рассчитать заказ» / «Пересчитать»**; lead time, review period, service level, growth override, safety days, stockout compensation, outlier filtering and per-category overrides live in a collapsed **«Расширенные настройки»** section. Changing scope or parameters shows a "требуется пересчёт" banner instead of recalculating automatically.
5. **Calculate:** `POST /api/runs` — the same real upload/import/calculate pipeline as before, no fake progress, and a failed calculation preserves the chosen scope/policy for retry.
6. **Review results:** a supplier-grouped table shows **«Рекомендовано»** vs. an editable **«Количество к заказу»**, urgency, confidence and an explanation link. Unknown stock renders as "нет данных" (never `0`); a supplier total in ₸ is shown only when every priced line has a cost, otherwise a partial total ("≥ … (без цены: N поз.)"). Clicking a row opens the SKU detail (raw/cleaned/adjusted demand, seasonal forecast, dated stock projection, excluded invoices, availability sensitivity band) in a right-hand drawer, without losing table scroll position or filters — this is the same data previously reached only via `GET /api/runs/[id]`.
7. **Scenario:** change growth, lead time, review period or category policy and recalculate to compare against the prior run.
8. **Approve and export:** a sticky bottom bar shows selection count and order status with **«Утвердить»** / **«Сохранить изменения»** / download actions. Approval uses optimistic revision checking (an intervening edit causes a conflict); editing a quantity after approval invalidates it and requires re-approval before export.
9. **«Проверка расчёта» dialog:** a tabbed dialog (Проверки кейса / Бэктест / Тренды) hosts the checks, backtest and trends views in place — call `GET /api/checks` for the five live must-have proofs, `GET /api/backtest?datasetId=...` for the chronological backtest, and `GET /api/trends?datasetId=...` for ABC/XYZ and category demand directly if you prefer the raw API.
10. **Copilot:** an optional floating panel calling `/api/agent`. An `OPENAI_API_KEY` enables it; without one it reports itself unavailable. It cannot approve or send orders — the full workflow above works without it.

## Data in PostgreSQL

All twelve original workbooks are preserved in Railway production PostgreSQL in `SourceWorkbook`, `SourceSheet` and `SourceRow`, including headers, totals, hidden/empty rows and repeated entries:

| Supplier | Workbooks | Sheets | Physical rows | Cells |
| --- | ---: | ---: | ---: | ---: |
| IEK | 6 | 6 | 181,547 | 1,585,736 |
| Systeme Electric | 6 | 8 | 79,720 | 699,779 |
| Total | 12 | 14 | 261,267 | 2,285,515 |

Every file's original bytes and every projected row/cell passed database read-back verification. Independent Python OOXML inventories matched the TypeScript parser for all twelve workbooks.

These are **raw source records**, not interpreted planning inputs. No source rows were filtered, merged, corrected or inferred. Existing calculation datasets remain separate until their mappings are explicitly reviewed. Systeme Electric uses the same preservation pipeline and independent workbook verification.

```sh
npm run import -- --supplier IEK --file "case and data/IEK/MOQ  ИЭК.xlsx" --write
```

This command is idempotent and verifies an existing identical archive rather than inserting it twice. See [the preservation contract and SQL examples](docs/source-import.md). Partner workbooks and private audit artifacts are excluded from Git, Docker and Railway directory uploads; originals are retained as private database bytes for fidelity, alongside queryable rows.

Committed `sample-data/` files are deterministic synthetic **test fixtures only**. The Docker copy, demo-seed script, startup seeding and demo-load HTTP action have been removed. The UI lists saved calculation datasets from PostgreSQL and can refresh that list; it never loads bundled workbooks.

## Calculation and architecture

One Next.js App Router application, TypeScript, Node 24, Prisma/PostgreSQL, ExcelJS, Tailwind, TanStack Table and Recharts. Tested dependencies are pinned in `package-lock.json`; the application uses the stable Prisma 7 line and its PostgreSQL adapter. No worker, queue or separate Python service is required.

`Excel → audited normalized dataset → pure TypeScript engine → persisted run → revisioned approval → frozen export`

- Monthly reports are the demand source; transactions provide invoice evidence and are never added again. Signed returns and source provenance are retained.
- One-off filtering requires sufficient prior invoice evidence and reconciliation with the monthly report. Deseasonalized monthly checks and persistence guards protect seasonality and sustained growth.
- Interior blank stock observations can mean inferred zero within a product's observed stock span; outside it, stock remains unknown. Stockout compensation distinguishes estimated and confirmed intervals and exposes uncertainty.
- Forecasts use seasonal profiles, robust growth, category-dependent service/safety policies, dated demand and inbound, then MOQ/pack conversion and rounding. Metres and pieces are not summed for ABC ranking; Systeme value ranking uses its cost field.
- Backtests refit at historical cutoffs and compare against seasonal-naive and mean baselines. Current partial September is not a completed training or test month.
- PostgreSQL stores source hashes/audit, product facts, policy, results, order revisions and immutable approval snapshots. Job rows record awaited operations; they are not a durable background queue.

See [methodology](docs/methodology.md), the [single build plan](BUILD_PLAN.md), and the [operational runbook](docs/runbook.md) for formulas, assumptions, release checks and recovery.

## Verification and deployment

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

All four commands pass (Prisma client generation, Next.js/Turbopack build, ESLint 9, `vitest run` — 8 files / 85 tests). GitHub Actions is configured to run the same checks on pushes and pull requests.

**Deployment:** a live instance runs at **https://apollon-production-59ea.up.railway.app** (health check at `/api/health`). Railway's `railway.json` Config-as-Code is deprecated and not applied by the platform; the service's Dockerfile path, pre-deploy command, healthcheck path and restart policy were instead set directly in the Railway service settings (mirroring the values in `railway.json` for reference). The pre-deploy command is migration-only (`npm run db:migrate`); automatic data seeding has been removed. See [the runbook](docs/runbook.md) for full current deployment status. Judges should primarily verify by running the project locally (below); the live link is a bonus, not a substitute.

## Limitations and safety

- **UI is one page; verification tools live in dialogs, not separate screens.** The manager workspace is entirely on `/`; checks/backtest/trends are reached through the in-page **«Проверка расчёта»** dialog or directly via `GET /api/checks`, `GET /api/backtest`, `GET /api/trends`. SKU-level provenance is reached through the row drawer or directly via `GET /api/runs/[id]` (which carries each recommendation's full history/projection/anomalies).
- **Raw IEK and Systeme Electric source data is stored, but calculation mappings are separate.** The new source archive is not automatically presented as a calculation-ready dataset. The running application version is tracked in the runbook.
- This is a shared, unauthenticated demonstration. An approver's typed name is attribution, not verified identity. **Do not upload confidential partner data to the public instance.** Dataset IDs are not access controls.
- Real files have no customer IDs. Invoice numbers identify orders, not people or customers. Customer-concentration detection is demonstrated only with labelled synthetic customer IDs.
- Real stockouts and IEK current balances are estimates. Overdue ETAs are not receipts; unknown stock requires review. Lost-sales values are estimates, not measured recovery or revenue.
- Warehouse scope is incomplete; category meanings, measured lead times and some unit conversions need partner confirmation. Defaults and overrides must remain visible.
- Monthly and transaction reports do not always reconcile. Monetary seasonality is comparison-only. The supplied Systeme “12 months” formula spans 13 months and is not trusted as a forecast input.
- Supplier exports are review drafts; the actual 1C import contract is unverified. Spreadsheet text is sanitized against formula injection.
- Partner workbooks, credentials and generated files are git-ignored. AI tracing excludes sensitive inputs/outputs; API keys remain server-side. An assistant cannot approve or dispatch orders.
- In-flight work is not resumed automatically after a restart. Frozen completed data survives in PostgreSQL. Do not claim forecast superiority, purchasing savings or real lost-sales recovery without appropriate ground truth.
