# Delivery specification — testing-cicd: e2e observable (frozen)

Chain position: second implementation slice of the 2026-08-26 testing/linting/ci-cd alignment (staging pipeline → **e2e observable** → gate & hooks → lint wiring → lane census → nightly). Evidence of record: the ruled e2e shape of 2026-08-26 (one journey through real surfaces, outcomes never transcripts; API-driven body; observe mode first — red blocks nothing and produces the known-broken list; nightly + morning digest; fix-adds-its-journey) and the same-day staging audit (the staging lane exists but is broken: rotted July-9 bootstrap refresh token with no rotation persistence, ~9 provisioned-but-unmapped env vars, `continue-on-error` masking every verdict, no cadence since the 2026-08-25 cull). The system spec landing tonight carries the prose: this slice implements target sections `specs/engineering/testing/release.md` § "What an e2e scenario is" and `specs/engineering/ci-cd/pipelines.md` § "Pipeline — nightly". Builders implement from this document without re-deriving the architecture.

## Intent

The battery against staging becomes **truthful and nightly**: every journey's verdict is real (nothing masked), the credential rotates durably between CI runs, and each morning one digest names exactly what is green, red, expected-fail, and blocked. Observe mode: a red journey blocks nothing — it is the triage queue.

## Acceptance gate (the merge bar — performed by Pablo, against the live product)

Tomorrow morning, **one digest message** (Slack, or the pinned "Staging battery — morning digest" issue if no webhook is provisioned) names every battery journey with its verdict — green / red / expected-fail / blocked — and a one-line cause for each non-green. Falsifier: no digest arrives · a red journey is reported green · the staging lane's run-level verdict is masked by `continue-on-error` · the digest names a journey the registry does not contain.

## Scope

Rulings of record: e2e axes A–D + observe mode (2026-08-26); audit gaps 2 (no cadence), 3 (rotted credential, no write-back), 4 (masked failures), 7 (unmapped env vars).

- **Credential bootstrap (operational, tonight):** re-mint the durable staging session via the in-VPC one-off (`staging_session_seed.py mint proliferate-e2e-bot` piped into a `proliferate-staging` ECS task per its docstring); the fresh refresh token goes **directly** into the `staging` environment secret `RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN` — never into logs, files, or PR text.
- **Rotation write-back (the mechanism July never built):** the runner already self-rotates into a state file (`staging-session.ts`); CI persists that file between runs via **GitHub Actions cache** — restore by prefix `staging-session-state-`, save under `staging-session-state-${{ github.run_id }}`, state path pointed into the workspace via `RELEASE_E2E_STAGING_SESSION_STATE`. The existing `release-e2e-staging` concurrency group (`cancel-in-progress: false`) serializes runs, so rotation never races. Recovery is one command: new `tests/release/scripts/staging-session-remint.sh` wraps the ECS one-off + `gh secret set` (operator-run; needs AWS + gh). Stated risks, accepted: cache eviction (≥7 idle days) falls back to the bootstrap secret; a consumed bootstrap secret makes the lane report **blocked** (visible in the digest, never masked) until the remint script runs; the cache holds a staging-only credential inside the private repo's Actions cache — staging blast radius only.
- **Identity conflict resolved for the code's truth:** the durable staging user is `proliferate-e2e-bot` / `support@proliferate.com` (what the seed script and fixtures implement). The staging env var `RELEASE_E2E_DURABLE_USER_EMAIL=release-e2e@proliferate.dev` describes an identity that does not exist on staging; it is NOT mapped into the staging job, and its correction/deletion is left to Pablo (noted in the PR).
- **Env mapping (audit gap 7):** the staging job's run step gains every provisioned-but-unmapped var the manifest names, exact list resolved against `gh variable/secret list --env staging` at build time (expected: `RELEASE_E2E_GITHUB_TEST_REPO`, `RELEASE_E2E_INTEGRATION_API_KEY`, the `AGENT_GATEWAY_LITELLM_*` admin pair, `WEB_URL` → new manifest entry `RELEASE_E2E_WEB_URL`).
- **Observe mode (audit gap 4):** `continue-on-error: true` removed from the staging job. The workflow sits in no rollup and no branch protection, so red is visible and blocks nothing — by construction, not by masking. The job's pinned `if:` expression and its census test (`qualification-execution-workflow.test.ts`) are updated together.
- **Nightly cadence (audit gap 2):** `schedule: cron "0 8 * * *"` (~1am PT) restored on `release-e2e.yml`; the staging job fires on schedule + dispatch. The currently-dead schedule-only **local** job's `if:` is corrected to dispatch-only so the nightly cron burns no sandbox/LLM money outside the staging battery.
- **The digest:** an `always()` post-run step calls new `scripts/ci-cd/battery-digest.mjs` — parses the runner report, emits one line per journey plus the header "staging battery N/M green"; delivers to Slack via `SLACK_BATTERY_WEBHOOK_URL` when provisioned, else creates-or-updates the pinned digest issue. The digest step never fails the job. Unit-tested.
- **Battery v1 — seven journeys as registered scenarios**, ids `T3-BATT-*`, `lanes: ["sandbox"]` (admitted by the existing staging planner gate; `plan.ts` untouched): `T3-BATT-AUTH-1` durable login + whoami + org membership · `T3-BATT-WEB-1` web shell + login page load (`RELEASE_E2E_WEB_URL`) · `T3-BATT-GH-1` github surface on the durable grant · `T3-BATT-BILL-1` billing overview/meters readable · `T3-BATT-WORKER-1` worker-enroll seam (**expected_fail** today: no staging background plane) · `T3-BATT-INT-1` integration connect flow (**expected_fail** today) · `T3-BATT-RUN-1` session → prompt → bounded run on the cheapest gateway model with a hard per-run budget (bounded polls, single turn) → artifact (**expected_fail** today). Expected-fails are attempted for real and thrown as `ScenarioExpectedFailError` (the runner's native status) — implemented, never skipped. All assertions are outcomes, never transcripts. Registry/manifest parity obligations the suite demands are satisfied in the same PR.
- **Tonight's live run:** the battery dispatched once against current staging from this branch; honest journey-by-journey results written to the vault (`50 Overnight Battery Report.md`).

## Non-goals (deliberately out)

The desktop spine journey (own slice, mechanism verification pending) · candidate-artifact handoff (audit gap 6) · promotion gating of any kind (observe mode: red blocks nothing; the flip to "battery green = prod door" is a later deliberate ruling) · fixing the broken systems the battery reports (worker enrollment, integrations, the cloud session path stay expected_fail until their owning systems' fixes add green — the battery only tells the truth) · staging deploy wiring (previous slice) · prod paths byte-untouched.

## Proof

- `battery-digest.test.mjs` — verdict grouping, expected-fail labeling, never-fails contract, webhook-vs-issue routing.
- `staging-session` unit tests stay green; new state-path/cache-shape test if the path handling changes.
- Scenario dry-run plans (`--dry-run`) for all seven journeys; full `pnpm -C tests/release test` + `typecheck` green.
- Workflow YAML parses (ruby); full `node --test scripts/ci-cd/*.test.mjs` green including the updated census pins.
- Live proof, recorded on the PR: tonight's dispatched battery run id + the vault report with per-journey verdicts.

## Discharges

Audit gaps 2, 3, 4, 7 fully. Gap 3's re-mint is operational tonight plus a scripted one-command recovery forever after.
