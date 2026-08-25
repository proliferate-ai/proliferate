# Delivery specification: cull sweep — delete dark cloud (Track A-b)

Status: frozen delivery specification.
Approved design: cull-sweep architecture alignment (founder-approved,
2026-08-25); evidence base: live-reachability verification — cloud
sandbox/web surfaces are gated off in production; client references to the
delete set are all inside CloudGuard-gated flows or zero.
Base revision: `698055ff801f22c8c7d81e6de13fa31fae8dde96`.
Stacked on: delivery-spec-extract-live-systems (Track A-a).

## Intent

Delete the dark remainder of `server/proliferate/server/cloud/` (~13.4K
lines) — no live consumer exists.

## Scope

- Delete: `materialization/` (~3.9K), `workspaces/` (~3.1K), `secrets/`
  (~1.2K), `runtime/` (~1.0K), `agent_run_config/` (~0.9K), `gateway/`
  (~0.7K), `repos/` + `repositories/` (~1.2K), `webhooks/` (~0.5K),
  `cloud_sandboxes/` (~0.5K), `harness_launch_options/` (~0.3K),
  `worktree_policy/` (~0.2K), integration action approvals,
  `observability.py`, `cloud/worker/` (orphan-sandbox reaper, per the A-a
  freeze deviation), their db models/stores, their tests, and the cloud
  router shell.
- One alembic migration drops the dark tables (shape per the drop-migration
  amendment below).
- SDK modules for deleted routes removed + regenerated.
- Client: CloudGuard-gated flows referencing deleted endpoints severed or
  left gated with a `TODO(cull-trail)` marker — judgment per file, bias to
  sever.
- Live `/v1/cloud/...` wire paths for the systems Track A-a extracted keep
  serving verbatim.

## Salvage (explicit)

- Copy the `webhooks/` HMAC verification shape into
  `delivery/cull-sweep/notes-webhook-hmac.md` before deletion (starting
  material for the environments rebuild).
- The E2B adapter (`server/proliferate/integrations/sandbox/`) is untouched —
  it lives outside `cloud/`.

## Keeps (do not touch)

Everything Track A-a moved; `ai_magic`; billing tables/segments and money
data (cutover, never table drop); the `integrations/sandbox` E2B adapter.

## Known live-code consumers of the delete set (recorded at freeze)

Two server-side consumers of the delete set exist outside `cloud/` and are
handled explicitly rather than discovered mid-flight:

1. The gen-1 managed workflow worker (`workflows/worker/coordination.py`,
   `delivery.py`, `target_plan.py` + three Celery tasks) imports
   `materialization`, `cloud_sandboxes`, and `workspaces`. This is Track B's
   delete scope; the cross-track ordering is escalated and this slice lands
   its materialization/cloud_sandboxes/workspaces deletions only when that
   dependency is resolved (Track B first, or an approved subsumption).
2. `billing/reconciler.py` (cloud-sandbox usage reconciliation; runs only
   when `cloud_billing_mode ∈ {observe, enforce}` — dark by configuration)
   is deleted with its `main.py` wiring and cloud-billing config validation.
   Billing tables and segment data are untouched.

## Amendment (2026-08-25, coordinator ruling): two-part split

Ruling: merge order becomes E/G anytime · A-a → B → **A-b-part-2** → C → F
→ D. This spec executes in two parts.

**Part-1 — ships with PR-Aa (stacked on the A-a moves).** The delete-set
members with zero surviving importers, verified by import graph:

- `agent_run_config/` and `worktree_policy/` (each referenced only by the
  cloud router shell), with their stores, models, and tests.
- `harness_launch_options/` was drafted into this slice but defers to
  part-2 (amendment recorded at implementation): its SDK types and
  `useCloudHarnessLaunchOptions` hook are compiled into live dual-lane
  surfaces — the agent-auth settings pane, the home-target hook, the cloud
  composer domain, and the gen-2 workflow builder — all gated at runtime
  but requiring the same golden-path client surgery as the workspaces
  sweep, so it lands there instead of being touched twice.
- `repositories/` package (api/service wrapper; referenced only by the
  router shell). Its store and models stay — live consumers exist
  (`ai_magic`, `github/repos`). The Track A-a amendment moves `repos/` to
  `server/github/repos/`; its deletion here is cancelled.
- `webhooks/` (E2B sandbox lifecycle webhooks; leaf consumer of the
  sandbox stack) — after copying the HMAC verification shape into
  `delivery/cull-sweep/notes-webhook-hmac.md`.
- `cloud/worker/` (orphan-sandbox reaper) together with its only caller,
  the `background/tasks/cloud_sandboxes.py` Celery task and its beat
  schedule entry. Verified: `cloud/worker/` serves no HTTP routes and has
  no client/SDK references.
- `observability.py` (zero importers anywhere).
- One alembic migration dropping only these systems' tables. The "one
  migration" line above becomes one migration per part — models and their
  tables must leave in the same PR or the schema-assertion suite fails.
- SDK modules for the routes deleted here removed + regenerated;
  CloudGuard-gated client references to those routes severed.

**Part-2 — its own PR (PR-Ab), rebased after Track B merges.** Everything
else: `materialization/`, `workspaces/`, `cloud_sandboxes/`, `secrets/`,
`runtime/`, `gateway/`, `harness_launch_options/` (per the amendment
above), `repositories/` disposition, integration `action_approvals/` (imported by live
`integration_gateway` service — severing surgery there is part of this
slice), `provisioning_observability.py`, the cloud router shell, the
second drop migration, `billing/reconciler.py` + wiring (with
`delivery/cull-sweep/notes-billing-reconciler.md` salvage note per
ruling), and the recorded live-reference severings: `billing/authorization.py`
and `db/store/billing.py` references to sandbox rows,
`db/store/notifications.py` and `product_engagement` references to
workspace rows, and the sandbox-bootstrap lane inside `seam/workers`.

## Amendment (2026-08-25, coordinator ruling): drop-migration shape

Both drop migrations (part-1 and part-2) follow the cull-migration
precedent `f8b9c0d1e2f4_drop_parked_cloud_domain_tables`:
`DROP TABLE IF EXISTS ... CASCADE` with a downgrade that raises
`NotImplementedError` — not a recreate-downgrade. Rationale: Track F's
`automation` tables carry RESTRICT foreign keys onto
`cloud_agent_run_config` and repo-environment rows and may still stand
when these drops land (merge order), so CASCADE is required for the
upgrade to apply; and cross-track recreate-downgrades would reference
each other's dropped tables, so they cannot genuinely round-trip. The
acceptance line "migration up/down round-trips on a dev database"
becomes "migration upgrade applies cleanly on a dev database". Per founder
ruling (existing user data is not a concern), there is no
prod-snapshot-before-deploy step: the drops are irreversible and the
docstrings say so, per the precedent.

## Acceptance

- Server boots; full test suite green after test deletions.
- `grep -r "server.cloud" server/` returns nothing.
- Migration up/down round-trips on a dev database.
- Docs: `specs/FEATURE_DOCS/SANDBOX/*` get supersession banners pointing at
  the environments spec-to-come; `python3 scripts/check_docs.py` green.
