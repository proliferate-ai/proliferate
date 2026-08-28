# Delivery specification — testing-cicd: the lane census + nightly-checks (frozen)

Chain position: fifth slice of the 2026-08-26 testing/linting/ci-cd alignment (staging pipeline → e2e observable → gate & hooks → lint wiring → **lane census** → format). Evidence of record: the ruled census law of 2026-08-26 — *"every check belongs to exactly one pipeline, and every pipeline has an honest trigger — a dispatch-only lane doesn't exist"* — and the same-day findings that dispatch-only demotions (intent, heavy lanes, `anyharness/tests`) had silently become lanes that never ran, while `continue-on-error` masked a fully-red staging e2e lane as green. The ci-cd system spec landing tonight carries the prose: this slice implements target sections `specs/engineering/ci-cd/README.md` § "The lane census" and `specs/engineering/ci-cd/pipelines.md` § "Pipeline — nightly". Builders implement from this document without re-deriving the architecture.

## Intent

The census law becomes a checker, and the slow-but-real suites get an honest nightly home. Every CI job carries a declared pipeline and cadence; quarantine (`continue-on-error`, flaky tests) is a named, owned, expiring row — never an unmarked shield.

## Acceptance gate (the merge bar — performed by Pablo, against the live repo)

Open a PR that adds a workflow job with no census row, or marks a lane dispatch-only with no sunset date, or adds `continue-on-error` with no quarantine row: **"Repo shape checks" goes red naming the rule id (PROD-LANE-00x)**. Falsifier: such a PR merges green. Secondary check: the morning after merge, the Actions page shows a *scheduled* `nightly-checks` run, and a red suite produced exactly one canonical report (the pinned issue updated, or one Slack line) — no green noise, no per-failure spam.

## Scope

Rulings of record: the census law + quarantine mechanism + "slow-but-real set" nightly contents (2026-08-26); the agent-runtime-compat absorption.

- **`lints/product/lanes.toml`** — three `[[rule]]` records (PROD-LANE-001 census completeness both directions · PROD-LANE-002 honest cadence: `dispatch-with-sunset` requires a date · PROD-LANE-003 `continue-on-error` only under an unexpired `[[quarantine]]` row), plus the census itself: one `[[lane]]` row per CI job (workflow, job id, pipeline, cadence, `gate_mirrored`) and `[[quarantine]]` rows (site, owner, expiry). Pipeline vocabulary: `pr · main · nightly · release · prod · dispatch-with-sunset · reusable` — `reusable` covers `workflow_call`-only files (`_`-prefixed), whose jobs run in their callers' pipelines; a matrix job is one row (the census records job definitions, not expansions).
- **`scripts/check_lanes.py`** + `scripts/test_check_lanes.py` — stdlib-only engine (minimal workflow parser: jobs, triggers, `continue-on-error`; fails loudly on shapes it cannot parse — ruby's full YAML parse in CI/CD-config remains the syntax gate). Red on: a job with no row · a row naming a dead job · dispatch-only with no sunset · unquarantined or expired `continue-on-error`. Wired into ci.yml "Repo shape checks" beside its siblings, unit tests first.
- **`.github/workflows/nightly-checks.yml`** — cron 09:00 UTC (~02:00 PT), the slow-but-real set: scroll-physics qualification (Blink + WebKit, step definitions recovered from the deleted `ci-heavy-lanes.yml`), workflow-canvas qualification, `anyharness/tests` (absorbed from `agent-runtime-compat.yml`), and the release-harness self-check (`tests/release` typecheck + unit suite). Red-only reporting: one canonical pinned issue updated per red night (Slack instead iff a webhook is already provisioned — discovered, not created, in this slice).
- **`.github/workflows/agent-runtime-compat.yml`** — deleted; absorbed into nightly-checks (census note in the PR body). Its Playwright/browser census entries and any `scripts/ci-cd` tests naming it or `nightly-checks.yml` are updated in the same PR.
- **Grandfathering** — census rows are written against main **at merge time** (this slice merges last in tonight's train; the census is re-measured at the merge turn). Existing violations not fixable in-slice (e.g. a held lane pending a Pablo ruling) get an exact `dispatch-with-sunset` or `[[quarantine]]` row with a real date — never a silent pass.

## Non-goals (deliberately out)

`release-e2e.yml` and the staging battery, its cron, its `continue-on-error` strip — the e2e-observable slice owns them (if unmerged at census time, the lane gets an honest dated row rather than an edit) · re-gating any demoted suite into the PR path (a nightly home is not a merge gate) · fixing quarantined flakes (rows expire; fixes are their owners') · the `[[lane]]`→loop-1 `gate_mirrored` enforcement wiring (the gate slice consumes the field; this slice only records it) · prod-lane semantics beyond a census row (`release.yml` stays byte-untouched).

## Proof

- `test_check_lanes.py` — parser extraction on fixture workflows (incl. `_`-prefixed reusable, matrix, step-level `continue-on-error`), both-direction drift, sunset and expiry failure modes, diagnostic rendering from the records.
- `python3 scripts/check_lanes.py` green on the merge commit — the census equals reality the moment it lands.
- Workflow YAML parses (ruby); full `node --test scripts/ci-cd/*.test.mjs` green (Playwright census updated for nightly-checks).
- `python3 scripts/lint_records.py` green — the three records load, ids unique, `enforced_by` exists.
- Live proof, recorded on the PR after the first cron: the scheduled `nightly-checks` run exists; any red produced exactly one canonical report.

## Discharges

The census law (2026-08-26) from slogan to red X; audit-class gap "no nightly home for demoted lanes" (`anyharness/tests` runs nowhere → runs nightly); the `agent-runtime-compat.yml` disposition.
