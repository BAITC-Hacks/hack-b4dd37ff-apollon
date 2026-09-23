# Apollon operational runbook

The authoritative scope is [BUILD_PLAN.md](../BUILD_PLAN.md). Working rules are in [AGENTS.md](../AGENTS.md). Codex integrates parallel subagent work, with no time-based feature cuts. Commit and push each verified stage to `main`. GitHub autodeploy was abandoned at the user's request on 2026-09-23; pushing does not deploy the app.

## Paused checkpoint — 2026-09-23

The user requested a stop, cleanup and commit. All three subagents were interrupted and the local dev server was stopped. Do not resume implementation or deploy until the user asks. This is a work-in-progress checkpoint, not a release; retain unfinished scope in `BUILD_PLAN.md`.

- Plan consolidation is complete: `BUILD_PLAN.md` is the only implementation plan; `AGENTS.md` was adapted from `CLAUDE.md`. Superseded `HACKATHON_PLAN.md`, `PLAN_REVIEW.md` and `.omc/plans/apollon-winning-plan.md` were removed after merging their content. Original ignored `CLAUDE.md` remains a reference.
- Present: Next.js scaffold, Prisma schema/migration, dataset/import/run/order/export APIs, pure engine, importer, deterministic synthetic Excel generator, partial manager UI, initial Agents SDK integration, tests, Docker/Railway config and CI.
- Demo parse and database seed succeeded: 48 fictional SKUs from 12 committed workbooks. A local API calculation returned 48 recommendations; `/api/health` reported a connected database. Real workbook parsing was independently checked locally; no partner workbooks enter Git.
- Latest checkpoint verification: **typecheck passes; 60 of 62 tests pass; lint has one error**. The earlier production build passed before the final interrupted UI/agent additions; the complete current checkpoint has not been release-validated.
- Failing test: `tests/agent/agent.test.ts` specialist handoff uses `transfer_to_anomalyreviewer`, which the SDK does not find. Verify the actual SDK handoff name and behavior.
- Failing test: `tests/repo/repo.test.ts` service-boundary validation. `editOrder` must reject invalid quantities and inherited keys (`toString`, `constructor`; use own-key membership), and `approveOrder` needs direct approver-name validation. Route validation alone is insufficient. Do not deploy this checkpoint before resolving this.
- Lint: `components/workspace.tsx:66`, synchronous state updates through `refresh()` inside an effect.
- Remaining work includes unfinished SKU/checks/backtest/trends pages, full browser workflow, dimensionally valid backtest metrics grouped by supplier/unit/horizon, review against every acceptance gate, Docker clean-start validation and deployment. Initial AI code is not live-key verified; no OpenAI API key is configured.
- Railway PostgreSQL was provisioned successfully (template PostgreSQL 18; local Compose uses PostgreSQL 16). The app has **no deployment and no public domain**. No GitHub source was connected: Railway returned “User does not have access to the repo.” The user cannot grant access and cancelled autodeploy; do not ask again or retry it.
- The local Compose database was stopped, preserving its volume. Railway resources are preserved; Railway PostgreSQL may continue incurring charges because pausing coding does not remove cloud services.
- Disposable `.next` build cache, `tsconfig.tsbuildinfo` and three `.DS_Store` files were moved to `/tmp/apollon-cleanup-YAXibi` for recoverability (the operating system may eventually clear `/tmp`). Dependencies, generated Prisma client, ignored agent history, source data and credentials were preserved locally. Ignore rules keep caches, temporary files and secrets out of Git; all 12 synthetic workbooks remain tracked.

When resumed, fix the documented failing checks first, finish the retained scope, run all gates and only then deploy manually if requested. No tests were removed or disabled to make this checkpoint appear green.

## Data and secrets

- Commit `sample-data/`: deterministic, fictional Excel workbooks in partner layouts, produced by `npm run demo:generate`.
- Never commit partner workbooks under `case and data/`, legacy `IEK/` or `Systeme electric/`, `.env`, credentials, generated Prisma output, or build artifacts. The case brief remains tracked.
- Both uploads and demo loads call `lib/ingest`; there is no direct synthetic database bypass. Interactive imports create separate dataset records. Automatic startup seeds reuse an identical demo to avoid duplicating it on every deployment.
- Public demo results are synthetic. Results claimed for partner data must come from separately verified local imports. There is no authentication: never upload confidential data to the public shared instance.
- `OPENAI_API_KEY` is optional and server-only. Set it in Railway variables, never in Git or a `NEXT_PUBLIC_` variable. Without it, deterministic planning works and the assistant reports unavailable.

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
- Git repository: `BAITC-Hacks/hack-b4dd37ff-apollon`, branch `main`; **not connected as a Railway source**.
- `DATABASE_URL` references `${{Postgres.DATABASE_URL}}` on the private network.
- `railway.json` selects the Node 24 Dockerfile. Pre-deploy runs migrations and idempotent demo import; startup runs the Next.js standalone server. Health endpoint: `/api/health`.

Future manual deployment, only after the user resumes and release checks pass:

```sh
railway up --project 5458bd50-da4b-44d4-9670-38d2e6849f7e --environment 428afbae-1686-4dbb-a3e5-200a2a2cd0d2 --service 02be117b-61a2-4e26-a0cc-6b475d2d321c --detach -m "Verified release"
railway deployment list --service 02be117b-61a2-4e26-a0cc-6b475d2d321c --environment 428afbae-1686-4dbb-a3e5-200a2a2cd0d2 --json
```

Inspect the exact deployment returned by upload. Do not treat queued/building as success. Require Railway `SUCCESS`, then HTTP 200 from `/api/health`, a visible demo dataset, and a successful calculation. Manual directory deployment does not require Railway GitHub App access and does not enable autodeploy. `railway.json` currently remains supported but the CLI reports its retirement on 2026-12-01; revisit Railway's current IaC guidance before deploying beyond that date.

## Verification flow

1. Open Import; load demo and confirm its synthetic badge and import audit, including deliberate malformed rows.
2. Calculate both suppliers. Inspect seasonal/growing products, stockout estimates and uncertainty, one-off invoices/customer fixture, inbound dates, category differences, MOQ/pack rounding, and reel/metre conversion.
3. Change policy, run a scenario, inspect quantity differences and SKU provenance.
4. Edit a proposed quantity; approve using a name and acknowledgement where required. Export XLSX, CSV and an email draft. Edits must invalidate approval; stale revisions must fail.
5. Run live checks and cutoff-safe backtest. Test the assistant only with a configured API key; never substitute canned responses.

## Recovery and troubleshooting

- Failed build: inspect build logs for the exact deployment; reproduce `npm ci`, generation and build on Node 24.
- Failed pre-deploy: inspect migration/seed logs. Do not reset or drop the database. Fix forward with a reviewed migration or parser change.
- Health 503: verify app database reference, PostgreSQL status and private networking. Do not print credentials into logs.
- Interrupted calculation/import: consult `/api/jobs`; retry explicitly. The app uses awaited operations, not a background queue.
- Approval conflict 409: reload the latest order and review it again; never bypass revision checks.
- Rollback: redeploy a known-good app revision through Railway after checking its compatibility with the current schema. App rollback does not undo migrations or erase imported datasets.
- Local shutdown: `docker compose down` preserves data. Do not add `-v` unless explicitly intending to delete the local database.
