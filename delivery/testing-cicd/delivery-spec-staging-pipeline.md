# Delivery specification — testing-cicd: the staging pipeline (frozen)

Chain position: first implementation slice of the 2026-08-26 testing/linting/ci-cd alignment (staging pipeline → e2e observable → gate & hooks → lint wiring → lane census → nightly). Evidence of record: the ruled CD line of 2026-08-26 ("merge is the only test gate · deploy is not a gate · staging is the standing e2e world · e2e green is the door to prod", one artifact base, prod cron transitional) and the same-day read-only staging audit (staging live at 0.4.23, frozen since #2140 removed its trigger on 2026-08-20 and two doctrine tests enforce the removal). The ci-cd system spec landing tonight carries the prose: this slice implements target sections `specs/engineering/ci-cd/pipelines.md` § "Pipeline — main → staging" and § "Pipeline — prod" (transitional paragraph). Builders implement from this document without re-deriving the architecture.

## Intent

A green main deploys staging automatically, so staging is **continuously current** — the standing e2e world the nightly battery runs against. This supersedes #2140's "manual-only staging / main-to-prod" doctrine, deliberately: the doctrine tests are rewritten to pin the new law, not deleted.

## Acceptance gate (the merge bar — performed by Pablo, against the live product)

Merge any PR to main; once `CI` and `Server CI` complete green on that commit, **within ~25 minutes `https://staging-app.proliferate.com/api/health` reports the new version — with nobody dispatching anything**. Falsifier: the version is unchanged after green CI · a staging deploy fires from a red or unfinished main · any production surface (cluster `proliferate-prod`, `release.yml`, its 9am cron) is touched by the staging path. Secondary check: after a long-idle period (no prior deploy-summary artifact resolvable), the next auto-deploy still deploys the **full surface set** rather than head^-diffing to a no-op.

## Scope

Rulings of record: the CD line + latest-wins staggering (2026-08-26); audit gaps 1 (trigger test-enforced absent) and 5 (silent staleness).

- **`.github/workflows/deploy-staging.yml`** — add `workflow_run` (workflows `["CI"]`, `types: [completed]`, `branches: [main]`) alongside the kept `workflow_dispatch`; a guard condition deploys only when `github.event.workflow_run.conclusion == 'success'`; the deployed head for auto runs is `github.event.workflow_run.head_sha` (the exact commit CI proved), dispatch behavior unchanged. The existing plan-job Server CI wait stays (it green-gates the second rollup). Concurrency group unchanged with `cancel-in-progress: false` — GitHub's one-running-plus-one-pending semantics give latest-wins without ever cancelling a mid-roll deploy. The lines-1–3 doctrine comment is rewritten to the new law.
- **`scripts/ci-cd/deploy-staging-trigger.test.mjs`** — rewrite to pin the new doctrine: (1) "staging deploys from green main and from an operator" (asserts the `workflow_run` trigger shape, the success guard, retained dispatch, `cancel-in-progress: false`); (2) "deploy-staging is the only workflow that auto-deploys from main, and only to staging" (the workflow-scan test inverted: the automatic set must equal exactly `["deploy-staging.yml"]`, and that file must never reference the production environment — the existing `staging never targets the production environment` and `release.yml is the only entrypoint into a production deploy lane` tests stay verbatim).
- **`scripts/ci-cd/resolve-deploy-base.mjs`** — emit a second output `base_mode=<resolved|fallback>`; behavior of base selection unchanged. **`deploy-staging.yml` plan job** — when `base_mode == 'fallback'` and no operator surface override is present, surface detection runs with force-all, so a staleness fallback deploys everything instead of silently diffing against head^. New unit test `scripts/ci-cd/resolve-deploy-base.test.mjs` pins the output contract.

## Non-goals (deliberately out)

Prod paths — `release.yml`, its cron, every `environment: production` reference — byte-untouched (the cron's retirement is a later PR after the battery stands, per the transitional ruling) · the nightly e2e battery and its credential mechanism (next slice) · candidate-artifact handoff between staging and prod (audit gap 6; own slice) · the desktop staging channel (`dry_run: true` stays) · doctrine prose in `specs/**` (the ci-cd spec PR carries it; this slice touches docs only where `check_docs` forces).

## Proof

- The rewritten `deploy-staging-trigger.test.mjs` suite green — the new doctrine is pinned by the same tests that enforced the old one.
- `resolve-deploy-base.test.mjs` — `base_mode` contract: resolved when a candidate with a live artifact exists, fallback when none.
- Workflow YAML parses (ruby); full `node --test scripts/ci-cd/*.test.mjs` green.
- Live proof, recorded on the PR after merge: the first auto-fired run (next green main) deploys and `/api/health` reports that commit's version.

## Discharges

Audit gap 1 (staging trigger test-enforced absent) fully; gap 5 (silent staleness under-deploy) for the deploy path. The staging unfreeze itself (0.4.23 → current) is operational, not code: dispatched at slice start via the existing manual path.
