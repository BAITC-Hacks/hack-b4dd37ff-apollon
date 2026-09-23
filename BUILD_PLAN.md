# Apollon: authoritative build plan

Updated 2026-09-23. This is the single implementation plan, incorporating the original workbook audit, both earlier plans and the review. The case brief is `case and data/Hackathon_task.md`. Codex is the main executor, supported by subagents with exclusive file ownership. There is no time limit, time-based feature cut or feature freeze: completion is determined by acceptance gates. The original `CLAUDE.md` remains a reference; `AGENTS.md` contains updated working instructions.

## 0. Stack and settled architecture

Verify current primary documentation and actual package compatibility at installation, then pin tested versions with a lockfile. Version observations below come from prior planning and require verification before installation. Use latest stable Next.js with its compatible React peer versions. One root dependency owner performs installs.

| Piece | Version | Notes |
|---|---|---|
| Node | 24 LTS in development/Docker/Railway/CI | Pin the tested major consistently; do not use an open-ended `>=22` range |
| next / react | 16.3.x / 19.3.x | App Router, Server Components, Server Actions, Route Handlers, `output: "standalone"`. **Read the Next 16 docs before coding** (async `params`/`searchParams`, `proxy.ts` replaced middleware, Turbopack default). |
| prisma / @prisma/client / @prisma/adapter-pg | **7.10.0 exactly** | npm `latest` for `prisma` CLI is an **8.0 RC**, so never `npm i prisma@latest`. Prisma 7 needs `prisma.config.ts` plus the `prisma-client` generator with an explicit `output`, and uses the pg driver adapter. Check the Prisma 7 docs first. |
| @openai/agents | 0.18.x (+ zod 4) | JS Agents SDK: tools, handoffs, input/output guardrails, tracing, streaming. Fetch docs first. |
| exceljs | 4.4.x | Do **not** use `xlsx` from npm (stale 0.18.5, known CVEs). |
| UI | Tailwind 4 + shadcn/ui, @tanstack/react-table, recharts | |
| Tests | vitest (engine/ingest), Playwright smoke (1 e2e) | |
| DB | Postgres 16 (Railway plugin in prod, `docker compose` locally) | Use the same provider everywhere; don't switch to SQLite. |

## 1. Data interpretation and required corrections

**Preserved audit rules:**
- Import audit with source file/sheet/row and quality flags.
- Exact-code keys; missing values kept separate from zero.
- Signed quantities (returns).
- Filter document types: count only `Расходная накладная`.
- The SE `Сумма последние 12 мес` spans **13 months** / 12 (their bug; surface it in the README).
- SE growth and seasonality fields are **ratio − 1**.
- MOQ file takes precedence over the embedded `Кратность` (it has zeros).
- **MOQ and pack multiple are separate concepts.**
- Reel vs metre cables need unit conversion.
- Don't double-subtract reservations (`Свободный остаток` already nets them).
- Duplicate codes in MOQ/transit.
- Transaction ↔ monthly reconciliation mismatch: show it, never add the two sources.
- Supplied growth *replaces* estimated trend by default.
- Customer-level detection only on labelled synthetic fixtures.
- Backtest refits at each cutoff, with no future coefficients.
- Approval gets invalidated by any edit or recalculation.
- No supplier dispatch.

**Implemented interpretation:**
1. **Stockout estimation.** Build an **availability estimator** from the available evidence:
   - opening stock at m and m+1. **Blank = zero only inside the SKU's active span** (first to last non-blank cell). Evidence: there are 0 explicit zero cells among about 107k stock cells in both files, so 1C prints 0 as blank. Blanks before first appearance or after the last appearance are `unknown`. The 5 negative IEK cells are flagged;
   - day of the last sale in month m from transactions;
   - sales running below the seasonal expectation.

   Output availability ∈ [0,1] with confidence (high/med/low) **and a sensitivity band** (lost demand at availability ±0.25, clipped to [0,1]), shown on the SKU page. Lost demand = expected × (1 − availability). The estimator is available by default, labelled "estimated", with a toggle and per-SKU override; positive automatic uplift requires adequate stock evidence and coverage. Low sales/early last sale alone do not prove stockout. Confirmed intervals from optional CSV take precedence; unknown stock cannot manufacture confirmed intervals.
2. **IEK current stock.** Estimated on-hand = September opening balance − net September 1–22 sales + only evidenced receipts/adjustments. **Past ETA never confirms receipt.** Label `snapshot_kind = estimated`, snapshot age, the no-unobserved-movements assumption and sensitivity. Provisional recommendations remain available; approval requires acknowledging the stock assumption or supplying dated current stock. Unknown opening stock remains a visible needs-input/provisional row rather than an unlabelled zero. Overdue unreceived shipments remain uncertain and need ETA review.
3. **Lead times.** Derive provisional promised intervals from IEK transit headers (order date → "поступление до"): RF ≈ 35–40 days, local ≈ 12–24 days. These are not observed delivery performance. Store editable route defaults in `PlanningPolicy`. SE uses an editable default of 45 days, labelled as an assumption.
4. **Categories must change the result (must-have #1).** Use a per-category policy table (service level → z, safety days, fallback demand). Default values are labelled assumptions and editable in the UI. Categories get no invented business meaning (from audit). IEK has no category. Derive ABC **within each unit group** (шт, м separately), because metres and pieces aren't comparable. SE ABC uses value (qty × `СС реал`). Add XYZ (coefficient of variation). ABC/XYZ are analytical fields separate from the business category policy.
5. **Agents.** Use ProcurementCopilot plus an advisory AnomalyReviewer handoff, input/output guardrails and sanitized real tracing. Both call implemented application services.
6. **Stack.** Python/Streamlit is replaced by Next.js/Prisma/Postgres/Railway, as the user decided.
7. **Data availability.** Partner workbooks stay **git-ignored**. The app offers two sources: **upload your workbooks** or **load the demo dataset** (synthetic, committed, seeded into Postgres). See §7.

## 2. Architecture

```
case and data/*.xlsx ──► lib/ingest (exceljs adapters: IEK, SE) ──► ImportIssue audit
                                   │ normalized rows
                                   ▼
                     Postgres via Prisma (Product, MonthlySale, Txn, StockSnapshot,
                       Delivery, StockoutInterval, PlanningPolicy, CategoryPolicy)
                                   │ loadPlanningInput(scope)
                                   ▼
            lib/engine (PURE TS, no DB/IO): clean → stockout → season/trend → forecast
                     → safety stock → net req → MOQ/multiple → urgency → explanation
                                   │ Recommendation[] (+ provenance JSON)
                                   ▼
             Run / Recommendation / AnomalyFlag / ApprovalEvent (Prisma)
                 ▲                 │
   Server Actions (edit/approve)   ├─► Next.js UI (dashboard, SKU drill-down, checks, backtest)
   lib/agent (@openai/agents) ─────┘   Route Handlers: /api/export (xlsx|csv), /api/agent (stream)
```

Rule: `lib/engine` imports nothing from Prisma, Next or fs. It takes plain objects and returns plain objects, so it is 100% unit-testable and both the UI and the agent call the same functions.

## 3. Repo layout and parallel ownership

Codex assigns independent bounded tasks to subagents and integrates their results. A path has one active owner at a time. The main executor owns shared contracts, database schema and dependencies unless explicitly delegated. Agree contract semantics before dependent work; notify consumers before changing them. Preserve existing user and agent changes.

| Path | Owner |
|---|---|
| `lib/contracts/engine.ts`, `lib/contracts/api.ts` (zod-validated) | Main executor; reviewed by implementing consumers before integration |
| `lib/ingest/**`, `lib/engine/**`, `lib/agent/**`, `tests/engine/**`, `tests/ingest/**`, `tests/fixtures/**` | Delegated domain owners, with disjoint scopes |
| `README.md`, `docs/methodology.md` | Assigned documentation owner, written as components land |
| Scaffold, `package.json`, `next.config.ts`, `prisma/schema.prisma`, `prisma.config.ts`, migrations, `lib/db.ts`, `lib/repo/**` (Prisma ↔ contracts mappers) | **Codex** |
| `app/**` (pages, Server Actions, Route Handlers), `components/**`, `lib/export/**` | **Codex** |
| `Dockerfile`, `docker-compose.yml`, `railway.json`, `.env.example`, `scripts/**` (incl. `make-demo-data.ts`), `sample-data/**`, GitHub Actions CI, `e2e/**` | Main executor or explicitly assigned owners; ingestion owner checks demo layouts |

## 4. Engine specification

All thresholds live in `Policy` and are recorded in the provenance of every recommendation.

1. **Scope and cutoff.** The cutoff is 2026-09-22. Train on complete months through August. September counts as month-to-date: scale it by elapsed days only for the display, never for training.
2. **Returns and document types.** Keep only `Расходная`. Sum signed quantities per SKU-day-invoice. Negative net months are clamped to 0 **only for training**; the raw value is kept.
3. **One-off detection.**
   - Invoice level (2025–26 transactions): flag when qty > max(median + k·MAD·1.4826, Q3 + 3·IQR, minRatio × median monthly demand) **and** the invoice is ≥ 30% of its SKU-month. Handle zero MAD by falling back to the ratio test.
   - **Persistence guard:** if ≥ 3 of the following 6 months are also elevated and already observed at the calculation cutoff, the jump is growth, so don't flag it. Never read holdout/future months. Near the right edge, use prior recurrence evidence and mark ambiguous decisions provisional.
   - Monthly Hampel filter for 2024 (transactions are sparse): only when there is no transaction coverage, applied to the **deseasonalized** series. It is skipped for intermittent SKUs (more than 40% zero months), so seasonality and lumpy demand aren't flattened.
   - Aggregate lines per SKU×invoice first. Require at least 6 prior invoices for automatic exclusion; with fewer, expose a review candidate and conservative monthly handling instead of automatically subtracting unsupported invoice demand.
   - Invoice correction to the monthly series only for SKU-months whose transaction total reconciles with the monthly report within 5%. Otherwise use the monthly Hampel fallback and set confidence to low. The two sources are never summed.
   - Output: `AnomalyFlag{invoice, date, qty, threshold, reason}`. The flagged qty is subtracted from the training month, and the manager can restore it.
   - Customer branch: if `anonymized_customer_id` exists, apply a 60-day rolling customer×SKU sum with the same test (synthetic fixture only).
4. **Stockout / availability** (§1.1). Expected = deseasonalized in-stock median × seasonal index. Adjusted month = observed + lost demand, capped at 2× expected without ever reducing observed demand. Confirmed intervals take precedence. All-period stockouts/new SKUs require an explicit category prior or manual forecast, not division by zero. Record observed and imputed values separately.
5. **Seasonality.**
   - SKU index from ratio-to-12-month-mean over the complete months, normalized so the indices average 1.
   - Shrink: w = n_full_years / (n_full_years + 1) toward a pooled profile of normalized, dimensionless per-SKU indices or comparable unit/category groups, with documented weights. Never sum metres, pieces and sets into one supplier unit-demand total.
   - The supplied monetary coefficients are shown for comparison only (from audit).
6. **Trend.** Theil–Sen on the last 12 deseasonalized adjusted months, capped at configurable ±50% per year. Convert slopes and supplied ratio-minus-one growth into documented factors per forecast period before exponentiation. The supplied growth (SE `Кэф. Роста`), or a user override, replaces estimated trend by default. Mode `additive` is an explicit uplift option. Store the reference period and growth source.
7. **Forecast.** Monthly: level × season(m) × trend^t over horizon H = LT + review. Split it daily for partial months.
8. **Safety stock.** z(service level of the category) × σ_month × √(H / 30). σ_month is the std of 1-month-ahead forecast errors on complete months, in units/month; H/30 converts the horizon to months; errors are assumed independent (stated in the methodology). With 12 or more error points, use the empirical 1-month error quantile scaled the same way. A minimum number of safety days comes from the category policy.
9. **Projection and net need.**
   - Walk the days to H: stock − daily demand + deliveries on their ETA.
   - Record `firstShortageDate`, `coverDays` and `shortageBeforeInbound`.
   - net = max(0, forecast_H + SS − available − inbound with ETA ≤ H).
10. **Rounding.** If net > 0: q = max(net, MOQ), rounded up to the pack multiple. Apply the unit conversion (reel → metre) where known; otherwise set `needsReview`.
11. **Urgency.** CRITICAL if a shortage happens before the next possible arrival (today + LT). HIGH if cover < LT + review. NORMAL otherwise. Also compute a risk score for sorting.
12. **Confidence.** High, medium or low, based on history length, the stock snapshot kind, anomaly share and unresolved units.
13. **Explanation** (Russian, deterministic, no API key needed): a fixed template filled from the provenance. Example: *«Базовый спрос 120 шт/мес (исключён разовый заказ №20000084410, 4300 шт, 28.07.26; +35 шт/мес упущенный спрос: дефицит мар–апр, оценка). Сезонность окт ×1.24, рост +8% (из отчёта). Потребность на 75 дн = 310 + страх. запас 60 − остаток 150 − в пути 100 (ETA 10.10) = 120 → кратность 50 → 150. Срочность: ВЫСОКАЯ, запаса на 21 дн при сроке поставки 40 дн.»*

## 5. Agent: `lib/agent/**`, served by `app/api/agent/route.ts`

- **ProcurementCopilot** tools (zod schemas). Each one calls the engine or repo:
  - `inspect_data_quality`
  - `calculate_replenishment(supplier, category?, overrides?)`
  - `explain_sku(code)`
  - `compare_scenario(code|category, overrides)`, which returns the delta table
  - `list_anomalies(supplier)`
  - `draft_supplier_order(runId, supplier)`, which creates a **pending** draft and never sends
- **Handoff → AnomalyReviewer.** It reviews borderline flags against the persistence guard and returns a keep/exclude suggestion. Only the manager applies it.
- **Input guardrail:** block attempts to re-identify customers or request raw customer data.
- **Output/tool guardrail:** block any claim of sending or approving. Approval exists only as a UI Server Action.
- Tracing is on with **sensitive payloads excluded** (SDK tracing config: no tool inputs/outputs in traces, only run IDs, timings and tool names). Only aggregates are sent to the model (from audit). With no `OPENAI_API_KEY`, the panel shows "unavailable" and nothing is simulated.

## 6. UI (Codex): Next.js App Router pages

1. `/import`: two buttons, **Upload workbooks** (the partner's `.xlsx` files, per supplier) or **Load demo dataset**. Both go through the same `lib/ingest` adapters and create a `Dataset`. The active dataset is shown in the header, with a **DEMO (synthetic)** badge when relevant. Upload validation: `.xlsx` only, size limit, the sheet/header is recognized by pattern, and missing files per supplier are allowed and reported. Show the audit table (coverage, duplicates, mismatches, reconciliation). Malformed files produce a friendly error, not a 500.
2. `/plan`: pick supplier, category and policy (LT, review, service level per category, growth override, stockout toggle). Calculate to create a Run. Show a table grouped by supplier (sortable, filterable, urgency chips, confidence). Quantities are edited inline, and **editing invalidates approval**. Approval is enforced in the service layer, never by the agent: `approveOrder(orderId, expectedRevision)` runs in a Prisma transaction with an optimistic revision check. Exports read the immutable approved revision. The approver's name is recorded; there is no login (see §11). There are Approve buttons per supplier or line.
3. `/plan/[runId]/sku/[code]`: chart of raw vs cleaned vs adjusted vs forecast. OOS months are shaded, one-off markers are shown (click to restore), plus the delivery timeline, projected stock line and full provenance.
4. `/checks`: runs the 5 must-have checks **live** through the engine on labelled synthetic fixtures **and** on real-data examples, with pass/fail and numbers.
5. `/backtest`: chronological origins May, June and July 2026, horizons 1–3 months; score only fully observed target months through August and show sample counts per horizon. Refit cleaning, stockout estimation, seasonality and trend at each origin without future inputs. MAE, WAPE and bias versus seasonal naive and 12-month mean, with zero-demand handling and compatible units.
6. `/trends`: demand trend by category with dimensionally valid aggregation and ABC/XYZ views. This is retained scope.
7. Copilot side panel on `/plan` (streaming).
8. Export (`/api/export`): approved lines only.
   - XLSX in the manager's worksheet layout (fills `Заказ` and adds Обоснование/Срочность, one sheet per supplier).
   - 1C CSV: `Код 1с;Артикул поставщика;Наименование;Количество;Ед.;Поставщик`, UTF-8 BOM, `;` separator. The column mapping is configurable, and text cells are escaped against formula injection (leading `= + - @`). The README calls 1C compatibility unverified (from audit).
   - Supplier/email drafts: downloadable text generated from actual order lines, explicitly marked pending or approved. No supplier dispatch tool exists. Defend spreadsheet text against dangerous prefixes after leading whitespace/control characters while preserving legitimate numeric cells.

## 7. Reproducibility and Railway

- `docker compose up` starts postgres and the app, with one designated local initialization step for migrations and idempotent demo seeding, then serves on :3000. Do not repeat Railway's pre-deploy migration from the production web entrypoint. `npm run import -- --dir "case and data"` imports real files locally.
- Without Docker for the app: `npm ci`, start the Compose database, run migrations and `npm run seed:demo`, then `npm run dev`; partner import is an additional optional command. Document exact final commands in README.
- `npm test` runs the vitest engine tests (the must-haves) and needs neither a DB nor a key.
- **Data (user decision, 2026-09-23):** real partner workbooks stay in the git-ignored `case and data/`. They're used locally by the team and can be uploaded by judges who have them. A clean clone runs on the **demo dataset**:
  - `scripts/make-demo-data.ts` (seeded RNG, deterministic) writes synthetic workbooks in the **exact partner layouts** (same sheets, header rows, Russian column names, `Итого` rows, blanks-as-zero) to `sample-data/`, which is committed.
  - "Load demo dataset" and the deploy seed parse those files **through `lib/ingest`**, the same code path as a real upload. Never insert demo rows into Postgres directly, or the upload path goes untested and the demo looks canned (criterion 2).
  - Idempotent: a dataset is keyed by file content hash + parser version, so re-seeding is a no-op.
  - Realism: distributions are calibrated to the real data (line-size median/MAD, intermittency share, dimensionless seasonal profiles, MOQ/multiple mix, stock blank patterns). No real codes, names or exact volumes are copied. The case explicitly allows synthetic data with realistic distributions.
  - **Planted scenarios**, listed in the README, so every must-have is visible in the demo: a strongly seasonal SKU; a sustained-growth SKU; SKUs with 1–2 stockout months; a 50× one-off invoice and a split one; SKUs with inbound before and after the horizon; MOQ/multiple rounding; several categories; a reel↔metre SKU; and a few malformed rows so the import audit has content.
  - Several datasets can coexist. Runs reference a `datasetId`.
- Railway setup:
  - one project with 2 services: the app from the repo `Dockerfile`, plus the Postgres plugin. The pre-deploy step seeds the demo dataset, and real data arrives only by upload;
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`;
  - pre-deploy `npx prisma migrate deploy && npm run seed:demo`;
  - `OPENAI_API_KEY` as a secret;
  - healthcheck `/api/health`.
- CI: GitHub Action runs typecheck, lint, vitest and `next build`.

## 8. Must-have proofs (vitest + `/checks`)

| # | Test |
|---|---|
| 1 | Fixture SKU, not saturated. Vary sales, stock, inbound (ETA inside vs outside H), category policy and growth **one at a time**. Assert the direction of change on raw need **and** on the final qty. |
| 2 | Seasonal fixture: the forecast peak month exceeds the trough by more than 30% and the correlation with the true pattern is > 0.8. A step-up growth fixture raises the baseline; the persistence guard keeps it from being flagged. |
| 3 | Stockout fixture: `lostDemand > 0` and need(compensated) > need(raw). Real-data example on `/checks`. |
| 4 | Inject a 50× invoice: regular forecast change < 5%. Split-customer fixture caught. Persistent increase **not** removed. |
| 5 | Every row has a supplier, a non-empty explanation and numeric provenance. Grouped export totals equal the approved run. |
| Ops | zero need, pack rounding, MOQ > need, zero MAD, returns, missing stock, late inbound, unit conversion, malformed cells, empty/garbage upload |
| Approval | an unapproved run can't export as approved; an edit invalidates approval; there is no send path anywhere (grep test). |

## 9. Acceptance gates: full scope, no time limits

1. Contracts/foundation: verify stable package compatibility, agree runtime-validated contracts, schema, provenance, scripts and exclusive task ownership.
2. Real vertical slice: import both suppliers with audit; calculate, persist and display a real SKU with full explanation; deploy the runnable slice to Railway.
3. Complete engine: anomaly review, confirmed/estimated stockouts, seasonality, trend/growth, category/ABC/XYZ, dated inbound, safety, units, confidence and explicit sparse/new/inactive-product fallbacks.
4. Complete manager workflow: grouped filters/table, drill-down charts, scenarios, edits, review acknowledgements, revisioned approval, approval history, XLSX/CSV exports and supplier/email drafts.
5. Agent integration: actual streamed tools, AnomalyReviewer handoff, guardrails, sanitized traces and explicit no-key fallback.
6. Evidence: live case checks, documented synthetic proofs, applicable real-data examples and chronological backtests. Refit every preprocessing step at each origin; score only fully observed target months through August. Report MAE, WAPE, bias and sample count per horizon against seasonal naive and 12-month mean, with zero-demand handling and dimensionally valid aggregation.
7. Release: typecheck/build/relevant tests pass; malformed uploads, concurrent approvals, idempotent retries and restart persistence verified; actual Railway deployment healthy; clean-clone demo and main workflow independently reproducible.

Write README and methodology as components land: purpose, algorithms, source mappings, assumptions, install/run/env, demo, verification, limitations and deployment. Do not claim real lost-sales recovery, purchasing savings or forecast superiority without ground truth. Completion requires every retained feature and gate; no deadline removes unfinished scope. This plan describes required behavior, not a claim that implementation is already complete.

## 10. Known limitations (README)

- Observed scope: transactions say Алматы only. The SE report has several stock columns (Витрина, Остаток ТЗ, РЦ, Розничный склад, Остаток); we plan on `Свободный остаток` as the aggregate and don't treat it as per-warehouse.
- No customer IDs. The invoice is used as **order identity only, not as a customer**. Customer-concentration logic exists but is proven only on labelled synthetic fixtures.
- Stockouts are estimated from monthly opening stock + transactions, not measured.
- IEK current stock is estimated.
- Lead times are derived or assumed, and category meanings are unknown.
- The public demo runs on synthetic data. The real-data results in the README come from the team's local runs on the partner files, which aren't redistributed.
- 1C import format is unverified.
- Monetary seasonality sheets are used only for comparison.
- Transaction ↔ monthly mismatch is unresolved.

## 11. Settled operational decisions

One Next.js application, one PostgreSQL service and one Railway environment. No monorepo, separate worker/queue, login/workspaces/roles, bucket or separate staging setup. Approver name is attribution, not verified identity; the public application is a shared synthetic demonstration and dataset IDs are not access-control boundaries.

Imports, calculations and backtests run in awaited request handlers with durable `Job` status/progress/errors. Do not return and leave unawaited promises running. Mark interrupted/stale jobs, offer idempotent retry, and prevent failed partial imports becoming active. A status table does not automatically resume work after restart. Measure actual latency rather than assuming imports or calculations finish within a specific duration.

Normalized values, source metadata/hashes and frozen results live in PostgreSQL; uploads are transient and original-file download is not promised. Real source workbooks remain local/git-ignored, synthetic samples committed. Regenerate exports from approved database revisions; do not rely on container disk. Use one designated migration/init path per environment: local initialization or Railway pre-deploy, not repeated migrations from every replica. Pre-deploy may seed PostgreSQL, but runtime artifacts and generated Prisma client must already be in the image. Bind to Railway PORT/all interfaces, configure health checks, verify deployment success and document backup/recovery.

Use server-only repositories, scoped DTOs, bounded/paginated queries, runtime validation, loading/error states and explicit cache invalidation. Prisma uses one client/pool per process, batched inserts, compound uniqueness/indexes and short transactions outside forecasts/model calls. Persist exact money/quantities with suitable decimals and explicit units; serialize dates/decimals safely. Approval checks expected revision, named approver and required acknowledgements transactionally. Frozen approved history survives edits; active approval is invalidated. Secrets and raw partner payloads stay out of browser bundles and traces.

## 12. Preserved measured workbook audit

All 12 workbooks were inspected on 2026-09-23. Counts below are distinct nonempty exact product codes; usable transaction rows have date, quantity and code before filtering non-sale document types.

| Source | IEK | Systeme Electric |
| --- | --- | --- |
| Monthly sales Jan 2024–Sep 2026 | 2,463 SKUs | 554 SKUs |
| Monthly opening stock | 2,853 SKUs | 701 SKUs |
| Transactions | 171,585 usable rows; 2,150 SKUs | 77,299 usable rows; 565 SKUs |
| MOQ/order constraints | 1,937 SKUs | 554 SKUs |
| Transit/consolidated | 2,616 distinct SKUs | 497 SKUs |
| Seasonality | Supplier totals/coefficients | Supplier totals/coefficients |

Total usable transactions: 248,884, through 22 September 2026. All usable transaction rows name Алматы; other reports do not establish identical warehouse scope. Sparse 2023/2024 rows exist but do not establish complete transaction history. Preserve 115 negative IEK and 302 negative Systeme rows as returns/corrections pending interpretation. IEK contains three incoming invoices and three customer orders; Systeme three customer orders. Filter completed demand by outgoing invoice type.

Systeme's consolidated `TDSheet` contains stock, reservations/free stock, categories, `СС реал`, growth, seasonality and a blank `Заказ` for all 497 products. Of 554 monthly-sales SKUs, 469 match it, 85 lack that current-stock source and 28 consolidated codes lie outside monthly sales. Seven rows have positive `СЭ в пути 24.09`; infer year from the report date and record the assumption. Categories observed are 1, 2, 3, 5 and 7 with mixed text/numeric cells; meanings are unknown. Separate MOQ covers all 554 sales SKUs and overrides invalid zero embedded multiples. `Сумма последние 12 мес` uses `SUM(AC:AO)`, 13 months Sep 2025–Sep 2026 divided by 12; recompute correct windows. Do not add overlapping stock columns or double-subtract reservations.

IEK's six shipment columns have ETAs 30 September–15 October 2026; expand each populated cell into a delivery. Among 2,463 sales SKUs, 702 lack MOQ, seven lack stock history, 324 lack transactions, and 379 lack transit matches. Missing transit records do not prove zero inbound. MOQ has 15 `#N/A` cells and repeated code `270400035_` with matching article/quantity but different names; transit has seven repeated codes. Resolve duplicate meaning before aggregation. Some cables buy in reels while stock is metres. Only 786 IEK SKUs had at least 24 selling months in earlier profiling. Extreme quantities such as 210,000 LOOP hinges and 7,488 ВА47-29 units require evidence, not automatic exclusion based on size alone.

There are no customer IDs or transaction prices, no exact stockout intervals, no supplier lead-time master and no verified 1C import template. Approximately 107k stock cells contain no explicit numeric zeros; five IEK negatives are flagged and IEK has 27,678 blank month cells. Preserve raw blanks plus inferred-zero provenance inside the active span; outside it remains unknown.

Outgoing signed transaction totals exactly match monthly sales in 13,848/21,445 IEK and 2,514/6,844 Systeme overlapping SKU-months Jan 2025–Aug 2026. This is a scope/reconciliation diagnostic, not proof either source is wrong. Monetary-looking supplier seasonal totals have unspecified units, partial 2026 data and future estimates; no future-derived coefficients may enter backtests.

Use supplier plus exact internal code as identity, retaining leading zeros/underscores/punctuation. Every normalized row retains source file/sheet/row, scope, as-of date, parser version and quality flags. Discover Cyrillic/double-space filenames by patterns/content and ignore lock files, report totals and duplicate non-product sheets. Optional CSV supplements support dated current stock, confirmed stockout intervals, lead times, category definitions, unit conversion and anonymized customer IDs. Preserve raw/cleaned/imputed series and run input hashes, versions, policy and decisions for reproducible explanations.

Open partner questions stay visible: category meanings, measured lead times, IEK current stock/receipts, daily availability, anonymized customers, report scope, stock-column overlap, conversion factors and actual 1C mapping. They limit real-world claims but do not block the complete product with explicit assumptions and synthetic behavioral proofs.
