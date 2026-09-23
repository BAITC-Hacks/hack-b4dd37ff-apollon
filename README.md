# Apollon — планирование закупок

Explainable supplier replenishment for ТОО «Электрокомплект»: import IEK and Systeme Electric workbooks, review demand corrections and stock risk, calculate a purchase plan, approve a frozen revision, and download supplier drafts. The calculation is deterministic; an optional OpenAI assistant explains and invokes the same application services.

**Status: unfinished implementation checkpoint, not a release.** `npm run typecheck`, `npm run lint`, `npm test` (62/62) and `npm run build` all pass as of this checkpoint. The two failures recorded in the [runbook checkpoint](docs/runbook.md#paused-checkpoint--2026-09-23) (the Agents SDK handoff tool name and the `editOrder`/`approveOrder` service-boundary validation) are fixed in `lib/agent/index.ts` and `lib/repo/index.ts`. What is **not** yet built: the app only has three pages — `/import` and `/plan` (plus `/`). The sidebar links to **`/trends`, `/backtest` and `/checks`**, and the SKU row links to **`/plan/[runId]/sku/[code]`**, all point to routes that do not exist yet (404 in the running app) even though their engine logic and API routes (`/api/trends`, `/api/backtest`, `/api/checks`) work and are covered by tests. Do not click those links expecting a working screen; use the API routes directly or `npm test` to see that functionality. Railway GitHub autodeploy was cancelled; the app has not been deployed. See [Known limitations](#limitations-and-safety) for the full list.

## Run from a clean checkout

With Docker and Compose installed:

```sh
docker compose up --build
```

Open http://localhost:3000. Startup applies PostgreSQL migrations and imports the committed **synthetic Excel workbooks through the real importer**. No API key or login is required for the core workflow.

For native development, use Node 24 LTS and PostgreSQL:

```sh
cp .env.example .env
docker compose up db -d
npm ci
npm run db:generate
npm run db:migrate
npm run seed:demo
npm run dev
```

Local PostgreSQL is exposed on port **55432**. `DATABASE_URL` is mandatory. `OPENAI_API_KEY` and `OPENAI_MODEL` configure only the assistant; the app must report it unavailable when no key is set, not simulate responses.

## Manager walkthrough

1. **Import** (`/import`): choose Upload workbooks or Load demo dataset. Inspect the active dataset name, synthetic label, source files and row-level audit. Each interactive import creates a separate dataset.
2. **Plan** (`/plan`): choose supplier/category and planning assumptions. Calculate proposals with urgency, confidence, ABC/XYZ, editable quantities and explanations.
3. **SKU detail (API only — no page yet):** the plan table links to `/plan/[runId]/sku/[code]`, which is **not implemented** and 404s. The same provenance (raw/cleaned/adjusted demand, seasonal forecast, dated stock projection, excluded invoices, availability sensitivity band) is available today from `GET /api/runs/[id]` — each recommendation carries its full `history`, `projection` and `anomalies`.
4. **Scenario:** on `/plan`, change growth, lead time, review period or category policy and compare results with the original run ("Сравнить сценарий").
5. **Approval:** enter an approver name and acknowledge estimated inputs. Approval uses optimistic revision checking; an intervening edit causes a conflict. Edits invalidate active approval.
6. **Export:** download XLSX, configurable-column CSV, or an email draft from the frozen approved revision. Nothing sends orders to suppliers.
7. **Evidence (API only — no page yet):** the sidebar links to `/checks`, `/backtest` and `/trends` **404** — those UI pages are unbuilt. The underlying logic is real and tested: call `GET /api/checks` for the five live must-have proofs, `GET /api/backtest?datasetId=...` for the chronological backtest, and `GET /api/trends?datasetId=...` for ABC/XYZ and category demand. An `OPENAI_API_KEY` enables the advisory assistant (`/api/agent`, wired into the `/plan` Copilot panel), not approval authority.

## Data and synthetic demonstration

The public demo runs on **made-up data**. Any real-data results reported here come from local runs on the partner workbooks, which are not redistributed or deployed.

`scripts/make-demo-data.ts` generates byte-reproducible partner-layout XLSX files in committed `sample-data/`. The demo button, Docker initialization and Railway pre-deploy all call the same `lib/ingest` adapters used by uploaded workbooks. No demo recommendations or database rows are hardcoded. Deploy-time seeding is idempotent; interactive demo loads remain separate datasets.

```sh
npm run demo:generate
npm run seed:demo
npm run import -- --dir "case and data"
```

The last command is for local partner files only. There are 48 fictional demo products across both suppliers, 33 months of history and deliberate cases for seasonality, sustained growth, estimated and confirmed stockouts, a large one-off invoice, a synthetic customer project split across invoices, early/late/overdue inbound, MOQ and packs, categories, reel/metre conversion, returns, sparse histories and malformed cells. See [sample-data/README.md](sample-data/README.md) for exact scenario codes.

Local parser verification on the supplied 12 workbooks found **248,875 valid outgoing invoice rows** (171,579 IEK and 77,296 Systeme). This excludes nine non-outgoing documents from the earlier 248,884-row usable-document audit. The union of codes across all input sources is 3,909 products, not the smaller monthly-sales-only population. Parsing success is not evidence of forecast accuracy or recovered sales.

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

All four commands pass at this checkpoint (Prisma 7.10.0 client generation, Next 16.3.6/Turbopack build, ESLint 9, `vitest run` — 5 files / 62 tests). GitHub Actions is configured to run the same checks on pushes and pull requests. Railway configuration uses the Dockerfile, a PostgreSQL service, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, migrations plus demo import during pre-deploy, and `/api/health`. Only synthetic files enter the image. GitHub autodeploy is not connected and was cancelled by the user; future deployments can use the CLI manually. See the runbook for exact deployment verification; configured infrastructure is not itself proof of a healthy release, and the app has not actually been deployed to Railway yet.

## Limitations and safety

- **UI coverage is incomplete.** Only `/`, `/import` and `/plan` exist. `/checks`, `/backtest`, `/trends` and the SKU drill-down page `/plan/[runId]/sku/[code]` are linked from the sidebar and the plan table but not implemented — following them 404s. Their logic is real and tested and is reachable directly through `GET /api/checks`, `GET /api/backtest`, `GET /api/trends` and `GET /api/runs/[id]` (which carries each recommendation's full history/projection/anomalies).
- This is a shared, unauthenticated demonstration. An approver's typed name is attribution, not verified identity. **Do not upload confidential partner data to the public instance.** Dataset IDs are not access controls.
- Real files have no customer IDs. Invoice numbers identify orders, not people or customers. Customer-concentration detection is demonstrated only with labelled synthetic customer IDs.
- Real stockouts and IEK current balances are estimates. Overdue ETAs are not receipts; unknown stock requires review. Lost-sales values are estimates, not measured recovery or revenue.
- Warehouse scope is incomplete; category meanings, measured lead times and some unit conversions need partner confirmation. Defaults and overrides must remain visible.
- Monthly and transaction reports do not always reconcile. Monetary seasonality is comparison-only. The supplied Systeme “12 months” formula spans 13 months and is not trusted as a forecast input.
- Supplier exports are review drafts; the actual 1C import contract is unverified. Spreadsheet text is sanitized against formula injection.
- Partner workbooks, credentials and generated files are git-ignored. AI tracing excludes sensitive inputs/outputs; API keys remain server-side. An assistant cannot approve or dispatch orders.
- In-flight work is not resumed automatically after a restart. Frozen completed data survives in PostgreSQL. Do not claim forecast superiority, purchasing savings or real lost-sales recovery without appropriate ground truth.
