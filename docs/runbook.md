# Apollon operational runbook

The authoritative scope is [BUILD_PLAN.md](../BUILD_PLAN.md). Working rules are in [AGENTS.md](../AGENTS.md). Codex integrates parallel subagent work, with no time-based feature cuts. Commit and push each verified stage to `main`.

## Current status — 2026-09-23

**Done:**

- Single-page manager workspace (`components/order-workspace.tsx`, mounted by `app/page.tsx`) covering choose data → validate → calculate → review → adjust → approve → export in one page, with a history panel (`GET /api/history`) and a «Проверка расчёта» dialog hosting checks/backtest/trends. The old `/import`, `/plan`, `/data`, `/checks`, `/backtest`, `/trends` and `/plan/[runId]/sku/[code]` pages were removed and now 404; their API routes are unchanged and are what the single page calls.
- `npm run typecheck`, `npm run lint`, `npm test` (**105 checks implemented**, including 9 PostgreSQL integration tests through the production relay) and `npm run build` all pass clean.
- Security hardening: streaming body size caps, security headers, CSRF protection, rate limits and CSV/formula-injection guarding on exports.
- Engine gaps closed: per-horizon/per-unit backtest metrics, anomaly-share confidence, category fallback demand, service-layer validation on `editOrder`/`approveOrder` (rejecting invalid quantities and inherited-key payloads), and the real Agents SDK handoff tool name.
- A live Railway deployment exists (see [Railway](#railway) below) and responds on `/api/health`.

**Pending:**

- **Calculation mapping:** all twelve IEK and Systeme Electric workbooks are preserved and verified in production source tables (261,267 rows / 2,285,515 cells). The case dataset is produced from these PostgreSQL rows by the versioned mapping; source IDs/hashes remain in the manifest.
- **Data lifecycle:** Docker workbook copies, automatic seeding and demo-load HTTP action are removed. The live service pre-deploy configuration is migration-only (`npm run db:migrate`).
- **Release verification:** deploy a committed checkout, require `SUCCESS` for its exact deployment ID, and check health and the disabled seed action. Calculation browser verification additionally requires a reviewed planning dataset.
- **Live browser verification on Railway:** once the above land, re-run the [verification flow](#verification-flow) against the live URL, not just locally.
- Future option: migrate `railway.json` Config-as-Code to Railway Infrastructure as Code (`.railway/railway.ts`) — see the [Railway](#railway) section for why this matters now.

No tests were removed or disabled to make this status look better than it is.

## Data and secrets

- Commit `sample-data/`: deterministic, fictional Excel workbooks in partner layouts, produced by `npm run demo:generate`.
- Never commit partner workbooks under `case and data/`, legacy `IEK/` or `Systeme electric/`, `.env`, credentials, generated Prisma output, or build artifacts. The case brief remains tracked.
- Source imports use `scripts/import-source.ts`; byte archives and exact row/cell projections are stored in PostgreSQL. Synthetic workbooks are test fixtures only and never seed at startup.
- Public demo results are synthetic. Results claimed for partner data must come from separately verified local imports. There is no authentication: never upload confidential data to the public shared instance.
- `OPENAI_API_KEY` is optional and server-only. It **is configured** as a server-only Railway variable on the deployed service (never printed here, in Git, or in a `NEXT_PUBLIC_` variable). Without it, deterministic planning works and the assistant reports unavailable.
- Use Railway production PostgreSQL for all database operations, including development. No local PostgreSQL or Compose database exists in the supported setup. Raw archives remain separate from the selected derived planning datasets.

## Native app with Railway production database

Use Node 24 and authenticated Railway CLI/SSH access. No local database or automatic seed:

```sh
npm ci
npm run db:generate
npm run dev
```

One-file source import and full read-back verification:

```sh
npm run import -- --supplier IEK --file "case and data/IEK/MOQ  ИЭК.xlsx" --write
```

See [source-import.md](source-import.md) for fidelity, idempotency, production targeting and SQL access.

## Release stage

```sh
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
git status --short
```

Review staged file names and content before each commit. Check `git ls-files 'case and data/*' '*.xlsx' '.env*'`: only the brief, synthetic workbooks, and `.env.example` should appear. Stage explicit paths, commit a meaningful stage, then `git push origin main`. Never force-push.

## Railway

- Project: `5458bd50-da4b-44d4-9670-38d2e6849f7e` (`hack-b4dd37ff-apollon`).
- Environment: `production`, `428afbae-1686-4dbb-a3e5-200a2a2cd0d2`.
- App: `apollon`, `02be117b-61a2-4e26-a0cc-6b475d2d321c`.
- PostgreSQL: `d996992f-11a9-46c3-86da-8cc7b526fa5b`.
- Git repository: `BAITC-Hacks/hack-b4dd37ff-apollon`, branch `main`; **not connected as a Railway source** (deploys are manual CLI directory uploads, not autodeploy).
- `DATABASE_URL` references `${{Postgres.DATABASE_URL}}` on the private network.
- **Live URL:** https://apollon-production-59ea.up.railway.app. Health check: `/api/health`. Release status is verified against the exact deployment ID returned by manual upload.
- **`railway.json` is NOT applied by Railway.** Config-as-Code is deprecated/rejected by the platform for this service. The values it describes (Dockerfile build, pre-deploy command, healthcheck path, restart policy) were instead set **directly on the service** in the Railway dashboard/CLI, not read from the file. Treat `railway.json` in the repo as documentation of intent, not as the actual live configuration — verify the service's real settings with `mcp__railway__get_service_config` or the dashboard before trusting it.
- Configured pre-deploy command: `npm run db:migrate` only. Data stays in PostgreSQL across builds/restarts; no workbook or seed script is included in the runtime image.
- Restart policy: `ON_FAILURE`, max 3 retries.
- Future option: migrate off `railway.json` to Railway's Infrastructure as Code format (`.railway/railway.ts`), which Railway does apply, instead of hand-configuring the service.

Manual deployment:

```sh
railway up --project 5458bd50-da4b-44d4-9670-38d2e6849f7e --environment 428afbae-1686-4dbb-a3e5-200a2a2cd0d2 --service 02be117b-61a2-4e26-a0cc-6b475d2d321c --detach -m "Verified release"
railway deployment list --service 02be117b-61a2-4e26-a0cc-6b475d2d321c --environment 428afbae-1686-4dbb-a3e5-200a2a2cd0d2 --json
```

Inspect the exact deployment returned by upload. Do not treat queued/building as success. Require Railway `SUCCESS`, then HTTP 200 from `/api/health` and HTTP 410 for the removed demo-seed action. Verify a visible dataset and successful calculation separately after reviewed mappings exist. Manual directory deployment does not require Railway GitHub App access and does not enable autodeploy.

## Verification flow

Calculation workflow (requires a separately mapped calculation dataset):

1. Open `/`; select an existing PostgreSQL calculation dataset using "Использовать данные кейса". Refresh reads the database; it does not seed files. The case list contains versioned source-backed datasets; old synthetic/legacy datasets are excluded.
2. Calculate both suppliers. Inspect seasonal/growing products, stockout estimates and uncertainty, one-off invoices/customer fixture, inbound dates, category differences, MOQ/pack rounding, and reel/metre conversion in the results table and SKU drawer.
3. Change policy or scope, recalculate, and compare quantity differences and SKU provenance against the prior run.
4. Edit a proposed quantity; approve using a name and acknowledgement where required. Export XLSX, CSV and an email draft. Edits must invalidate approval; stale revisions must fail.
5. Open «Проверка расчёта» and confirm the checks/backtest/trends tabs render live data from `/api/checks`, `/api/backtest`, `/api/trends`. Test the Copilot panel only with a configured API key; never substitute canned responses.
6. Open «История расчётов» and confirm a saved run reopens without recalculating.

Live (Railway, using the mapped case dataset): repeat steps 1–6 against https://apollon-production-59ea.up.railway.app and confirm `/api/health` returns `status: "ok"` first.

## Recovery and troubleshooting

- Failed build: inspect build logs for the exact deployment; reproduce `npm ci`, generation and build on Node 24.
- Failed pre-deploy: inspect migration logs. Do not reset or drop the database. Fix forward with a reviewed migration or parser change.
- Health 503: verify app database reference, PostgreSQL status and private networking. Do not print credentials into logs.
- Interrupted calculation/import: consult `/api/jobs`; retry explicitly. The app uses awaited operations, not a background queue.
- Approval conflict 409: reload the latest order and review it again; never bypass revision checks.
- Rollback: redeploy a known-good app revision through Railway after checking its compatibility with the current schema. App rollback does not undo migrations or erase imported datasets.
- Stop the native app/relay when finished. PostgreSQL remains on Railway; never reset or drop it to repeat an import.
