# Claude Code guidance for this repo

Read `AGENTS.md` first — repo layout, build commands, and conventions live
there and apply to you.

## Developing / running the app

- Always run under a dev profile: `make run PROFILE=<name>` (never the
  default-port shortcuts when other worktrees may be running). One profile per
  worktree; profile name = feature name; never reuse `main`.
- **Before touching code, read the relevant spec** under `specs/` — it is
  authoritative. Agent-domain map: `structures/anyharness/src/agents.md`.
- Full recipe for booting a feature worktree — profile isolation, which boot
  command (Rust-touching branches must build their own runtime), and the three
  auth layers (dev bypass / password + `/setup` claim / seeded GitHub auth):
  **`specs/developing/local/feature-worktree-auth.md`**. Follow it exactly; it
  encodes hard-won gotchas (e.g. `SINGLE_ORG_MODE=true` is required for the
  `/setup` signup page in local dev, and "There is nothing to set up here"
  means the claim already succeeded).
- Shared frontend packages (`packages/*`, e.g. `@proliferate/product-ui`) are
  consumed as built dist: rebuild after editing
  (`pnpm --filter "@proliferate/<pkg>" build` or `make shared-build`), HMR
  alone won't pick it up.
- Branches that change DB schema (server alembic or anyharness SQLite
  migrations) own their profile for the branch's lifetime — migrations are
  forward-only; don't boot other branches on that profile.

## Verifying

- Server: `cd server && uv run pytest -q`
- Catalog changes are gated by BOTH the JS validator and Rust `cargo test`
  (Rust tests hardcode catalog values); `catalog.json` is `include_str!`'d so
  the runtime needs a rebuild.
- Prefer exercising the change in the running app over tests alone.

## Logging & errors

- Ambient/expected errors: `logger.exception(...)` (already JSON + correlated +
  stack-traced). Page-worthy failures: `report_critical(exc, tags=...)` — do not
  also log; it captures to Sentry at level=fatal and logs the `CRITICAL_FAILURE`
  marker. Adding a `report_critical` site adds a pager duty — be deliberate.
- Any new background loop/Celery task must bind correlation context (org/user) at
  the unit-of-work boundary, or its logs are anonymous. New spawned processes pass
  the `PROLIFERATE_ORG_ID/USER_ID/SANDBOX_ID/RUNTIME_ENV` env vars. Never hardcode a
  release/version string.
- Full rules + how to grep prod logs by tenant during an investigation:
  `specs/developing/analytics/exceptions-observability-implementation.md` §8–8.5.
