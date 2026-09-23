# Apollon — repository working instructions

Adapted from the original `CLAUDE.md` and the user's latest decisions. `BUILD_PLAN.md` is the single authoritative implementation plan. The case is automatic supplier replenishment for ТОО «Электрокомплект», with IEK and Systeme Electric data.

## Assessment criteria

| Criterion | Evaluation | Points |
| --- | --- | --- |
| Case fit and functionality | All mandatory requirements and the input-to-result manager scenario actually work | 20 |
| Technical implementation | Real connected code and understandable structure; no hardcoded answers or canned responses replacing functionality | 25 |
| README and technical documentation | Explains product, methodology, stack/data, installation, verification and limitations; serves as presentation | 20 |
| Reproducibility and deployment | Judges can run a clean checkout with documented dependencies/config/data; deployment supplements local reproducibility | 20 |
| Baseline reliability and security | Valid inputs work; malformed inputs fail clearly and safely | 15 |
| Total | | 100 |

## Execution and scope

- Latest data instruction (2026-09-23): use only the existing Railway production PostgreSQL; never start/use local PostgreSQL. Import IEK and Systeme Electric source workbooks losslessly, preserving every row/cell, original types, formula/cache/error distinctions and duplicates. Source ingestion performs no business filtering, deduplication, blank-to-zero inference or correction. Any later interpretation is separate from immutable source facts. See `docs/source-import.md`.

- Codex is the main executor and uses subagents for independent bounded parallel tasks. Claude is not an execution dependency. Assign exclusive path ownership, communicate contract changes and preserve user/agent changes.
- No time limits, time-based feature cuts or arbitrary feature freezes. Complete the retained scope using `BUILD_PLAN.md` acceptance gates.
- Use one Next.js App Router app, latest stable compatible Next.js/React, TypeScript, Node.js 24 LTS, Prisma/PostgreSQL and Railway. No monorepo, separate worker/queue, login/workspaces/roles, bucket or separate staging environment. Use PostgreSQL job status, named approvers and frozen approved revisions.
- One owner manages dependency installation, lockfile, schema and shared contracts at a time. The engine is pure TypeScript; UI and agents call the same implemented services.
- Partner files remain git-ignored. Committed deterministic synthetic workbooks use real adapters and explicit labels. Never place real customer identities or partner payloads in traces, fixtures or public demo artifacts.

## Documentation policy

- Fetch current official documentation before coding against third-party SDKs/libraries, particularly Next.js, Prisma, Railway and OpenAI APIs. Verify package compatibility and pin tested versions; prior plan version claims do not replace verification.
- Use OpenAI Agents SDK for TypeScript for ProcurementCopilot, actual tools, advisory AnomalyReviewer handoff, guardrails and sanitized tracing. Start at https://developers.openai.com/api/docs/guides/agents and linked SDK documentation.
- The deterministic app works without an OpenAI key; show the assistant unavailable when unconfigured, never simulate responses.

## Working rules

- The user explicitly authorized commits and pushes on 2026-09-23. Commit and push each verified implementation stage to the existing GitHub repository; never include partner workbooks, credentials, or generated build output. Preserve unrelated changes.
- Optimize for working implementation, complete case behavior, documentation, reproducibility and reliability. Every claimed feature must be connected and verifiable.
- Preserve signed raw facts, exact codes, provenance, missing-versus-zero distinction, scope and cutoff. Invoice IDs identify orders, never customers; overdue ETA never confirms receipt. Keep assumptions visible.
- Enforce approval in application/database transactions with expected revision, named approver and required acknowledgements. Edits/recalculations invalidate active approval; exports use immutable approved revisions. AI cannot approve or send orders. Downloadable supplier/email drafts remain in scope.
- Keep secrets server-side, validate boundaries, sanitize spreadsheet text and exclude sales/customer payloads from SDK traces/logs.
- Write README/methodology as components land: purpose, algorithms/anomaly handling, data/assumptions, stack, install/run/env, clean-clone demo, main-scenario verification, tests, Railway and limitations.
- Verify in proportion to risk with meaningful behavioral/domain checks, integration checks and browser flow. Report actual evidence; do not claim accuracy, savings or deployment success without it.
- Preserve original `CLAUDE.md` as a reference. Maintain only `BUILD_PLAN.md` as the implementation plan.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
