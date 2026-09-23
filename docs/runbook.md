# Apollon operational runbook

The authoritative scope is [BUILD_PLAN.md](../BUILD_PLAN.md). Working rules are in [AGENTS.md](../AGENTS.md). Codex integrates parallel subagent work, with no time-based feature cuts. Commit and push each verified stage to `main`.

## Current status — 2026-09-23

**Done:**

- Single-page manager workspace (`components/order-workspace.tsx`, mounted by `app/page.tsx`) covering choose data → validate → calculate → review → adjust → approve → export in one page, with a history panel (`GET /api/history`) and a «Проверка расчёта» dialog hosting checks/backtest/trends. The old `/import`, `/plan`, `/data`, `/checks`, `/backtest`, `/trends` and `/plan/[runId]/sku/[code]` pages were removed and now 404; their API routes are unchanged and are what the single page calls.
- `npm run typecheck`, `npm run lint`, `npm test` (6 files / **81 of 81 tests pass**) and `npm run build` all pass clean.
- Security hardening: streaming body size caps, security headers, CSRF protection, rate limits and CSV/formula-injection guarding on exports.
- Engine gaps closed: per-horizon/per-unit backtest metrics, anomaly-share confidence, category fallback demand, service-layer validation on `editOrder`/`approveOrder` (rejecting invalid quantities and inherited-key payloads), and the real Agents SDK handoff tool name.
- A live Railway deployment exists (see [Railway](#railway) below) and responds on `/api/health`.

**Pending:**

- **Data:** the production Railway Postgres database was wiped on 2026-09-23 (schema kept) and is now the only database the deployed app uses — local Postgres is not used for the deployed app. A dedicated xlsx→Postgres conversion/seed script (loading case data directly into Postgres) is being built separately and has not landed yet; until it does, the deployed instance has no case data loaded. Treat this as **pending — Codex seed**, not yet runnable.
- **Pre-deploy seed fix:** the Railway pre-deploy command is configured as `npm run db:migrate && npm run seed:demo`, but only the migration half is actually executing on the deployed service; the demo-seed half is not running. This needs a fix before the deployed instance can self-seed.
- **Deploying the single-page UI:** the live Railway app is still running an older commit (`3a229ab`, multi-page UI). The single-page UI is committed to `main` but has not been redeployed.
- **Live browser verification on Railway:** once the above land, re-run the [verification flow](#verification-flow) against the live URL, not just locally.
- Future option: migrate `railway.json` Config-as-Code to Railway Infrastructure as Code (`.railway/railway.ts`) — see the [Railway](#railway) section for why this matters now.

No tests were removed or disabled to make this status look better than it is.

## Data and secrets

- Commit `sample-data/`: deterministic, fictional Excel workbooks in partner layouts, produced by `npm run demo:generate`.
- Never commit partner workbooks under `case and data/`, legacy `IEK/` or `Systeme electric/`, `.env`, credentials, generated Prisma output, or build artifacts. The case brief remains tracked.
- Both uploads and demo loads call `lib/ingest`; there is no direct synthetic database bypass. Interactive imports create separate dataset records. Automatic startup seeds reuse an identical demo to avoid duplicating it on every deployment.
- Public demo results are synthetic. Results claimed for partner data must come from separately verified local imports. There is no authentication: never upload confidential data to the public shared instance.
- `OPENAI_API_KEY` is optional and server-only. It **is configured** as a server-only Railway variable on the deployed service (never printed here, in Git, or in a `NEXT_PUBLIC_` variable). Without it, deterministic planning works and the assistant reports unavailable.
- The deployed Railway Postgres database was wiped on 2026-09-23 (schema kept); it is the only database the deployed app reads from. Local Postgres (via Compose) is only used for local development and is never the source for the deployed app. Case data for the deployed instance will arrive through a dedicated xlsx→Postgres conversion/seed script that is being built separately (pending — Codex seed); do not invent commands for it here until it lands.

## Clean local setup

Prerequisite: Docker with Compose. Run `docker compose up --build`. The application runs on http://localhost:3000, PostgreSQL is mapped to localhost:55432. Startup applies migrations and imports the committed demo workbooks through the normal parser.

For native development, use Node 24, copy `.env.example` to `.env`, then:

```sh
docker compose up db -d
npm ci
npm run db:generate
npm run db:migrate
npm run seed:demo
npm run dev
```

Local partner-data import (never part of Railway startup):

```sh
npm run import -- --dir "case and data"
```

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
- **Live URL:** https://apollon-production-59ea.up.railway.app. Health check: `/api/health`. The deployed commit is `3a229ab` (multi-page UI, before the single-page workspace and `/api/history` landed) — redeploy to bring it current.
- **`railway.json` is NOT applied by Railway.** Config-as-Code is deprecated/rejected by the platform for this service. The values it describes (Dockerfile build, pre-deploy command, healthcheck path, restart policy) were instead set **directly on the service** in the Railway dashboard/CLI, not read from the file. Treat `railway.json` in the repo as documentation of intent, not as the actual live configuration — verify the service's real settings with `mcp__railway__get_service_config` or the dashboard before trusting it.
- Configured pre-deploy command: `npm run db:migrate && npm run seed:demo`. **Known issue:** only the `db:migrate` half is actually executing on deploy; `seed:demo` is not running, so the deployed database is not currently seeded with demo data. A fix to the pre-deploy command (or an explicit follow-up step) is pending.
- Restart policy: `ON_FAILURE`, max 3 retries.
- Future option: migrate off `railway.json` to Railway's Infrastructure as Code format (`.railway/railway.ts`), which Railway does apply, instead of hand-configuring the service.

Manual deployment:

```sh
railway up --project 5458bd50-da4b-44d4-9670-38d2e6849f7e --environment 428afbae-1686-4dbb-a3e5-200a2a2cd0d2 --service 02be117b-61a2-4e26-a0cc-6b475d2d321c --detach -m "Verified release"
railway deployment list --service 02be117b-61a2-4e26-a0cc-6b475d2d321c --environment 428afbae-1686-4dbb-a3e5-200a2a2cd0d2 --json
```

Inspect the exact deployment returned by upload. Do not treat queued/building as success. Require Railway `SUCCESS`, then HTTP 200 from `/api/health`, a visible dataset, and a successful calculation. Manual directory deployment does not require Railway GitHub App access and does not enable autodeploy.

## Verification flow

Local (clean clone, demo data):

1. Open `/`; use "Использовать данные кейса" to load the demo dataset and confirm its «Демо-данные» badge and import audit, including deliberate malformed rows, via "Просмотреть данные".
2. Calculate both suppliers. Inspect seasonal/growing products, stockout estimates and uncertainty, one-off invoices/customer fixture, inbound dates, category differences, MOQ/pack rounding, and reel/metre conversion in the results table and SKU drawer.
3. Change policy or scope, recalculate, and compare quantity differences and SKU provenance against the prior run.
4. Edit a proposed quantity; approve using a name and acknowledgement where required. Export XLSX, CSV and an email draft. Edits must invalidate approval; stale revisions must fail.
5. Open «Проверка расчёта» and confirm the checks/backtest/trends tabs render live data from `/api/checks`, `/api/backtest`, `/api/trends`. Test the Copilot panel only with a configured API key; never substitute canned responses.
6. Open «История расчётов» and confirm a saved run reopens without recalculating.

Live (Railway, once the single-page UI is redeployed and seeded): repeat steps 1–6 against https://apollon-production-59ea.up.railway.app and confirm `/api/health` returns `status: "ok"` first.

## Recovery and troubleshooting

- Failed build: inspect build logs for the exact deployment; reproduce `npm ci`, generation and build on Node 24.
- Failed pre-deploy: inspect migration/seed logs. Do not reset or drop the database. Fix forward with a reviewed migration or parser change.
- Health 503: verify app database reference, PostgreSQL status and private networking. Do not print credentials into logs.
- Interrupted calculation/import: consult `/api/jobs`; retry explicitly. The app uses awaited operations, not a background queue.
- Approval conflict 409: reload the latest order and review it again; never bypass revision checks.
- Rollback: redeploy a known-good app revision through Railway after checking its compatibility with the current schema. App rollback does not undo migrations or erase imported datasets.
- Local shutdown: `docker compose down` preserves data. Do not add `-v` unless explicitly intending to delete the local database.
