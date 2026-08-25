# Delivery spec — PR-E3: CI Diet (lite: cull only)

Program: engineering-cull. Frozen from the founder-approved draft
("PR-E3 CI Diet", 2026-08-25). Rescoped per founder principle: **the cull
builds nothing** — everything constructive (change detection, nightly
infrastructure) is deferred to the step-3 CI/CD spec. The Deferred section
below is recorded so it isn't lost, not so it's done now.

Touches only `.github/workflows/**` plus same-commit doc truth updates;
revertible as a unit. **Founder actions:** branch-protection edit + C5 answer.

## Intent

Stop paying for machinery that gates nothing or protects parked systems: kill
the daily provider-spend crons, take non-gating lanes off the PR path, and
demote narrow heavyweight lanes to dispatch. Zero new machinery; every change
is deleting a trigger, a schedule, or a job's place on the PR path.

Expected effect: runner-minutes saved per PR and the daily E2B/AWS
qualification spend stops. **Deliberately NOT achieved this week:** the
≤12-min docs-PR gate — that needs the change-detection build, which is a
step-3 design item.

## Scope — changed (all deletions of triggers/schedules, no construction)

### 1. Crons on the parked corridor
- `release-e2e.yml`: delete the daily 11:00 `schedule:` → `workflow_dispatch`
  only.
- `release-e2e-selfhost.yml`: delete the daily 11:30 `schedule:` →
  dispatch-only; also delete its dead `workflow_call:` interface (zero
  callers).
- `release-e2e-hard-cancel-cleanup.yml`: **keep** (cost backstop for
  dispatched runs).
- `catalog-probe.yml` cron and `release.yml` nightly: **keep** (live signal;
  production lane).

### 2. Non-gating lanes off the PR path
- `intent-tests.yml`: remove the `pull_request` trigger → dispatch-only. Both
  lanes are "(provisional)" and gate nothing today; running them per-PR is
  cost without protection. Their future home (nightly? promoted to required?)
  is the step-3 testing/CI spec's call.

### 3. Narrow heavyweight lanes off the PR path
Remove from the per-PR path (dispatch-only until step 3 redesigns the gate
structure):
- `candidate-build-handoff` (protects the parked qualification corridor)
- `login-budget` (its script + lane + dependabot posthog pin die together in
  the product cull's PR-5 — this just stops the per-PR cost until then)
- `workflow-definition-lifecycle` (tests the surface mid gen-2 rebuild; while
  in ci.yml it also blocked the Deploy Staging workflow_run spine —
  accepted-lost while demoted)
- `scroll-physics` (two browsers; its structural half stays enforced by
  `check_transcript_scroll_writer.py` in repo-shape). *Note: the testing-fork
  draft preferred keeping this merge-gating; founder cull-only principle
  overrides for now — re-gate deliberately in step 3.*
- `terraform-validate` → keep per-PR **only if** it is cheap (<2 min); else
  dispatch-only.

Mechanically: whichever is smaller per job — remove the job from `ci.yml`
into a dispatch-only workflow, or condition it out — chosen at implementation
for the *smallest diff*, with the `ci-ok` rollup updated so it neither waits
on nor fails for the removed lanes.

### 4. Self-host smoke
Per-PR prod-compose smoke off the PR path. **Founder action:** remove
`Production compose smoke` and `Detect smoke-relevant changes` from main's
required checks in branch protection. T4-SH-2 incident gate kept;
`server/deploy/**` untouched.

### 5. Windows lanes (C5)
If ruled non-blocking: confirm they're outside the required set and exclude
from any rollup they feed. If blocking: no change. **Blocked on C5 — not
implemented in this PR.**

## Deferred to the step-3 CI/CD spec (recorded, not done)

- `ci.yml` change detection (the 14-job gating table from this spec's v1
  draft — preserved in the vault file's history) — designs together with the
  lane model, since they are the same mechanism.
- `nightly-checks.yml` + automatic issue-filing on failure — the proper home
  for everything demoted above plus the anyharness suite
  (`agent-runtime-compat.yml`).
- The ≤12-min edge-gate budget as an enforced rule.
- Re-gating decisions for scroll-physics / intent / candidate-handoff /
  workflow-definition-lifecycle / self-host smoke, and the tier-3 cadence
  (the schedule-only local lane in `release-e2e.yml` is unreachable until
  then).

## Non-goals

Deleting workflows (PR-E4 owns the zombies) · any new workflow, detector, or
filter machinery beyond the verbatim job moves · CodeQL · `server-ci.yml` ·
release/deploy lanes.

## Implementation notes (recorded at freeze)

- Terraform-validate measured well under 2 minutes on the latest CI run →
  **kept per-PR** per the spec's own conditional.
- The four demoted lanes moved verbatim into dispatch-only
  `ci-heavy-lanes.yml` (smallest diff that satisfies ci-ok's drift guard,
  which requires every job in ci.yml to appear in its needs list).
- Same-commit doc truth updated per repo law: the required-checks comment in
  `ci.yml`, `specs/codebase/systems/engineering/delivery/README.md`,
  `specs/TESTING.md`, `specs/TESTING/{self-hosting,flows,scenarios,core-release-validation}.md`.

## Acceptance

- Grep: no `schedule:` in `release-e2e.yml` / `release-e2e-selfhost.yml`; no
  `workflow_call:` in the selfhost file; no `pull_request` trigger in
  `intent-tests.yml` or `self-host-smoke.yml`.
- A test PR shows the demoted lanes absent from its check list, and `ci-ok`
  still resolves green.
- `ci-ok` still fails on a genuinely failing covered lane (one deliberate red
  on a scratch branch).
- Branch-protection change confirmed by founder in the PR description.

## Revert

Single revert restores all triggers/schedules; branch protection reverts by
hand (noted in PR description).
