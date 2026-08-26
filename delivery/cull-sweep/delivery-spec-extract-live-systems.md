# Delivery specification: cull sweep — extract live systems (Track A-a)

Status: frozen delivery specification.
Approved design: cull-sweep architecture alignment (founder-approved,
2026-08-25); evidence base: live-reachability verification separating the
desktop-live subset of `server/proliferate/server/cloud/` from the dark
remainder.
Base revision: `698055ff801f22c8c7d81e6de13fa31fae8dde96`.

## Intent

Found the new system map by extracting the four desktop-live systems out of
`server/proliferate/server/cloud/` into peer domains. Moves only — zero
behavior change.

## Scope

- `cloud/agent_gateway/` → `server/agent_auth/` (~4.3K lines: selections,
  vault, agent-models, org policy, gateway enrollment/capabilities).
- `cloud/integrations/` + `cloud/integration_gateway/` →
  `server/integration_gateway/` (~7.4K lines; internal split: `connections/`
  for the former `integrations` package, `gateway/` for the former
  `integration_gateway` package).
- `cloud/runtime_workers/` → `server/seam/workers/` (~1.0K lines: desktop
  worker enrollment, heartbeat, identity).
- `cloud/github_app/` → `server/github/` (~1.5K lines).
- `main.py` and `cloud/api.py` import re-pointing: the aggregate cloud router
  keeps its include order and prefix — **wire paths unchanged**,
  `/v1/cloud/...` routes keep serving verbatim so no client/SDK change in
  this PR.
- Owned `db/models/cloud/*` files for these systems move alongside
  (`db/store/*` files for these systems already live outside `cloud/` under
  system-named paths and do not move). Tests update import paths with their
  systems.

## Non-goals

No deletions, no route renames, no SDK regen, no behavior change of any kind.

## Deviations from draft (recorded at freeze)

`cloud/worker/` was drafted as moving to `server/seam/workers/` alongside
`runtime_workers/`. Verification shows it is the orphan-sandbox reaper
(imports `db/store/cloud_sandbox_recovery` and the E2B sandbox provider) —
dark sandbox machinery, not seam material. It stays in place in this slice
and is deleted by Track A-b. `server/seam/workers/` receives
`runtime_workers/` only.

## Amendment (2026-08-25, coordinator ruling)

Recorded before implementation; evidence: import-graph verification over the
whole server tree.

- **Merge reorder.** The gen-1 managed workflow worker (Track B's delete
  scope) is a live-code consumer of Track A-b's delete set, so the sweep
  merge order becomes E/G anytime · **A-a → B → A-b-part-2 → C → F → D**.
  This PR (PR-Aa) carries the freeze, the A-a moves, and A-b-part-1 (the
  zero-consumer dark deletions); A-b-part-2 lands as its own PR after
  Track B merges.
- **`cloud/repos/` moves instead of dying.** `github_app` (live) imports
  `repos` at both api and service level (repo catalog/branch listing under
  GitHub credentials). It is github-system code: it moves to
  `server/github/repos/` in this slice, and its planned Track A-b deletion
  is cancelled. Its store (`db/store/repositories.py`) and models stay —
  live consumers include `ai_magic/service.py`.
- **Shared `cloud/errors.py` and `cloud/event_logging.py` move to neutral
  homes** (`server/api_errors.py`, `server/event_logging.py`). Every
  extracted system imports them; moving them now (pure move + mechanical
  import rewrite, class/function names unchanged) is what lets A-b-part-2
  delete `cloud/` without touching moved systems again.
- **`runtime_workers` is a mixed system.** Its service imports
  `cloud.runtime.bootstrap` (sandbox-provisioning lane) alongside the
  desktop enrollment lane. It moves whole in this slice; the sandbox lane
  is severed in A-b-part-2 when `cloud/runtime/` dies.
- **Model files move with their systems.** `db/models/cloud/{agent_gateway,
  github_app, integrations, integration_authorization, integration_revocation,
  runtime_workers, repositories}.py` relocate to `db/models/<name>.py` with
  explicit registration imports in `main.py` replacing their entries in the
  `db/models/cloud` package registration.

## Acceptance

- Git rename detection shows moves.
- Full server test suite green.
- Route table identical before/after: OpenAPI schema dump byte-identical
  across the move commit.
- Boundary checker exceptions updated mechanically (fingerprints carried
  forward on move; no net-new exceptions).
