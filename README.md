# Apollon — планирование закупок

Explainable supplier replenishment for ТОО «Электрокомплект»: import IEK and Systeme Electric workbooks, review demand corrections and stock risk, calculate a purchase plan, approve a frozen revision, and download supplier drafts. The calculation is deterministic; an optional OpenAI assistant explains and invokes the same application services.

**Status: single-page UI complete and committed; not yet deployed.** `npm run typecheck`, `npm run lint`, `npm test` (81/81) and `npm run build` all pass. The manager UI is now **one page at `/`** (`components/order-workspace.tsx`) covering the full journey — choose data, validate, calculate, review, adjust, approve, export — with a checks/backtest/trends dialog and a history panel, replacing the earlier multi-page app. The old routes `/import`, `/plan`, `/data`, `/checks`, `/backtest`, `/trends` and `/plan/[runId]/sku/[code]` were removed and now 404; their logic lives in API routes (`/api/import`, `/api/runs`, `/api/checks`, `/api/backtest`, `/api/trends`, `/api/history`) called from the single page. A Railway deployment exists at **https://apollon-production-59ea.up.railway.app** but currently runs an older commit with the multi-page UI — the single-page UI in this repo has not been redeployed yet. See [Known limitations](#limitations-and-safety) for the full list, and [the runbook](docs/runbook.md) for current deployment/data status.

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

## Data and synthetic demonstration

For a clean local clone, the demo runs on **made-up data**. Any real-data results reported here come from local runs on the partner workbooks, which are not redistributed or deployed.

`scripts/make-demo-data.ts` generates byte-reproducible partner-layout XLSX files in committed `sample-data/`. The demo button, Docker initialization and (once the pre-deploy fix lands, see [runbook](docs/runbook.md)) Railway pre-deploy all call the same `lib/ingest` adapters used by uploaded workbooks. No demo recommendations or database rows are hardcoded. Deploy-time seeding is idempotent; interactive demo loads remain separate datasets.

**Deployed instance data (pending):** the production Railway Postgres database was wiped on 2026-09-23 (schema kept) and is the only database the deployed app uses — local Postgres is not used for the deployed app. Real case data will be loaded into it by a dedicated xlsx→Postgres conversion/seed script that is being built separately; until that lands, the deployed instance has no case data loaded. Partner workbooks used as test data may live in Railway Postgres, but are never committed to Git or baked into the Docker image (`.gitignore`/`.dockerignore`/`.railwayignore` all exclude them).

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

All four commands pass (Prisma client generation, Next.js/Turbopack build, ESLint 9, `vitest run` — 6 files / 81 tests). GitHub Actions is configured to run the same checks on pushes and pull requests.

**Deployment:** a live instance runs at **https://apollon-production-59ea.up.railway.app** (health check at `/api/health`). It is currently running an older commit with the multi-page UI — the single-page UI described in this README is committed to `main` but has not been redeployed yet. Railway's `railway.json` Config-as-Code is deprecated and not applied by the platform; the service's Dockerfile path, pre-deploy command, healthcheck path and restart policy were instead set directly in the Railway service settings (mirroring the values in `railway.json` for reference). The pre-deploy command currently only runs `npm run db:migrate`; the `&& npm run seed:demo` half is not executing on the deployed service, so the deployed instance is not seeded with the demo dataset — this is a known, pending fix. See [the runbook](docs/runbook.md) for full current deployment status. Judges should primarily verify by running the project locally (below); the live link is a bonus, not a substitute.

## Limitations and safety

- **UI is one page; verification tools live in dialogs, not separate screens.** The manager workspace is entirely on `/`; checks/backtest/trends are reached through the in-page **«Проверка расчёта»** dialog or directly via `GET /api/checks`, `GET /api/backtest`, `GET /api/trends`. SKU-level provenance is reached through the row drawer or directly via `GET /api/runs/[id]` (which carries each recommendation's full history/projection/anomalies).
- **The deployed Railway instance is not yet running the current code or seeded with case data.** Use the local clean-clone setup above to evaluate the current single-page UI and calculation engine.
- This is a shared, unauthenticated demonstration. An approver's typed name is attribution, not verified identity. **Do not upload confidential partner data to the public instance.** Dataset IDs are not access controls.
- Real files have no customer IDs. Invoice numbers identify orders, not people or customers. Customer-concentration detection is demonstrated only with labelled synthetic customer IDs.
- Real stockouts and IEK current balances are estimates. Overdue ETAs are not receipts; unknown stock requires review. Lost-sales values are estimates, not measured recovery or revenue.
- Warehouse scope is incomplete; category meanings, measured lead times and some unit conversions need partner confirmation. Defaults and overrides must remain visible.
- Monthly and transaction reports do not always reconcile. Monetary seasonality is comparison-only. The supplied Systeme “12 months” formula spans 13 months and is not trusted as a forecast input.
- Supplier exports are review drafts; the actual 1C import contract is unverified. Spreadsheet text is sanitized against formula injection.
- Partner workbooks, credentials and generated files are git-ignored. AI tracing excludes sensitive inputs/outputs; API keys remain server-side. An assistant cannot approve or dispatch orders.
- In-flight work is not resumed automatically after a restart. Frozen completed data survives in PostgreSQL. Do not claim forecast superiority, purchasing savings or real lost-sales recovery without appropriate ground truth.
