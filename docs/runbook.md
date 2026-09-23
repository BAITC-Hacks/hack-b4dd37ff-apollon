# Apollon operational runbook

The authoritative scope is [BUILD_PLAN.md](../BUILD_PLAN.md). Working rules are in [AGENTS.md](../AGENTS.md). Codex integrates parallel subagent work, with no time-based feature cuts. Commit and push each verified stage to `main`; Railway deploys the connected GitHub branch once its GitHub App integration is authorized.

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
- GitHub source: `BAITC-Hacks/hack-b4dd37ff-apollon`, branch `main`.
- `DATABASE_URL` references `${{Postgres.DATABASE_URL}}` on the private network.
- `railway.json` selects the Node 24 Dockerfile. Pre-deploy runs migrations and idempotent demo import; startup runs the Next.js standalone server. Health endpoint: `/api/health`.

After every push, inspect the deployment for that exact Git commit. Do not treat queued/building as success. Require Railway `SUCCESS`, then HTTP 200 from `/api/health`, a visible demo dataset, and a successful calculation. A missing GitHub-triggered deployment is an integration problem, not a reason to claim automatic deployment works.

If Railway cannot see the organization repository, a GitHub organization administrator must grant the Railway GitHub App access to this repository. A CLI directory deployment does not establish GitHub autodeploy.

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
