# Delivery spec · Track F · `delete-small-fry` (+ CI diet)

**Status:** frozen delivery specification (approved by Pablo, 2026-08-25)
**Evidence:** cull-sweep investigation (Cull Plan); per-claim re-verification recorded in the PR.
**Shared rules (all cull tracks):** own worktree + branch, moves never mix with behavior
changes, narrowest proof that establishes the delta, docs updated in the same PR, commit
trailers per repo convention. Merge order: E and G anytime · A → B → C → F → D, mechanical
rebase after each (SDK regen, alembic head bump).

## Intent

Verified-dead removals + the stranded automations client stack + CI demotions.

## Scope

- `integrations/linear.py` (224, zero importers)
- CustomerIO vertical (`product_engagement/`, `customerio.py`, beat task, the one
  `accounts/desktop` import, vendor secret from env catalog)
- dev scripts (`latency-benchmark.mjs`, `measure-login-runtime-budget.mjs`,
  `inspect-{cursor,opencode}-models.mjs` — verify no doc refs first)
- stranded automations: client `hooks/access/cloud/automations/`, `hooks/automations/`,
  `lib/workflows/automations/`, `lib/domain/automations/`, the
  `AuthenticatedBackgroundLifecycles` mount, SDK `client/automations.ts` + types,
  `db/models/automations.py` + `main.py:19` import, `automation_environment_references`
  store + its `repositories/service.py` reference; migration drops `automation` table
  (**record its column vocabulary — schedule/next_run_at, owner_scope, target_mode — in
  the migration docstring as trigger-system starting material**).
- **Keep** the `"automation"` prompt-provenance enum values.
- CI: self-host smoke → nightly non-blocking (keep T4-SH-2 gate); Windows lanes →
  approved in review of this spec: demote to nightly non-blocking alongside.

## Acceptance

Client typechecks/builds; no poller mounts; server boots; migration round-trips;
CI config valid.
