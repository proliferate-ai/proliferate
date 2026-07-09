# release-e2e — tier-3 live runner

The tier-3 "live end-to-end" runner (see `specs/developing/testing/README.md`
and `specs/developing/testing/scenarios.md`). It drives real flows against a
real target: provision/connect, chat per cataloged agent, config apply, secrets
materialization, billing, repo settings. Cadence is the release train, never
per-PR — it spends real money/time.

## Running it

```
make release-e2e LANE=local|staging DESKTOP=web AGENTS=all SCENARIOS=all [DRY_RUN=1]
# or, from tests/release/:
pnpm exec tsx src/cli/run.ts --lane local --dry-run
```

Every credential is declared in `src/config/env-manifest.ts` with where to get
it. A missing credential does **not** fail the run: the runner reports just the
scenarios/lanes that need it as **blocked** (`src/config/env-resolution.ts`,
`missingRequiredForLane`), so a partially-credentialed environment still
produces signal. Outcomes: **green** (asserted for real), **blocked** (known
out-of-band gate/credential gap), **expected-fail** (attempted, diagnosed,
tracked). A **red** is a genuine regression and the only thing that fails the
gate.

## Lanes

- `--lane` = TARGET lane (where the API server lives): `local` or `staging`.
- Each scenario also declares RUNTIME lanes (`local` = local AnyHarness runtime;
  `sandbox` = real E2B). The two are distinct (`src/config/types.ts`).

## Staging-lane runbook

The staging lane targets the real deployment
(`https://staging-app.proliferate.com/api`). First honest run: 2026-07-09.

- **Server URL.** Staging runs `API_PATH_PREFIX=/api`, so `RELEASE_E2E_SERVER_URL`
  MUST be the `/api`-prefixed base — the runner posts the raw HTTP contract
  (e.g. `/auth/mobile/session/refresh`) under it. (`/api/health` = 200,
  `/health` = 404.)
- **Identity.** The durable user (`proliferate-e2e-bot`) is GitHub-OAuth-only
  and has NO password, so on `--lane staging` scenarios authenticate via the
  rotating PRODUCT session (`src/fixtures/staging-session.ts`,
  `loginDurableUserOnStaging`), not `RELEASE_E2E_DURABLE_USER_EMAIL/PASSWORD`.
  `requiredEnvForTargetLane` drops those two on staging and checks
  `stagingSessionAvailable()` instead. Scenario code takes the lane-aware path
  via `loginDurableUserForTargetLane({ targetLane, serverUrl })`.
- **Rotation.** Staging refresh tokens rotate on EVERY use. Bootstrap once with
  `scripts/staging_session_seed.py mint proliferate-e2e-bot` (in-VPC one-off ECS
  task on cluster `proliferate-staging`; the staging DB is VPC-only). After that
  the live token lives in the rotating state file
  (`~/.proliferate-local/dev/release-e2e-staging-session.json` locally;
  `RELEASE_E2E_STAGING_SESSION_STATE` overrides). In CI the state file is
  persisted across runs via `actions/cache` (per-run-id save key + prefix
  restore-key; the workflow-level concurrency group serialises runs so no two
  rotations race).
- **Failure mode is blocked, never red.** A broken session chain
  (revoked/expired/never-persisted token) raises
  `StagingSessionUnavailableError`, which durable-user scenarios convert to a
  `ScenarioBlockedError`. Re-bootstrap and reseed
  `RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN`.
- **First-pass scope (all non-red).** The `local` RUNTIME lane has no staging
  pairing → blocked. Sandbox scenarios that mutate/charge the SHARED durable
  user (PROV-1 mint-user, PROV-2 wake, SEC-MAT-1 secret write, INT-1 integration
  connect) are DEFERRED (blocked) until a dedicated non-shared staging fixture
  org exists. BILL-1/2 block on the local-only `RELEASE_E2E_LOCAL_DATABASE_URL`
  (staging DB is VPC-only). CHAT/WT/UPDATE/REPO sandbox halves are expected-fail
  (bodies unimplemented / GitHub-App seed unavailable). **PROV-2 is the real
  end-to-end proof:** it authenticates the durable user through the rotating
  session and reads `GET /cloud-sandbox`.

### CI

`.github/workflows/release-e2e.yml` has two jobs. The local job runs on the
nightly schedule and on non-staging dispatch. The staging job is dispatch-only
with `lane=staging` (kept off the schedule so shared staging state is not
exercised unattended):

```
gh workflow run release-e2e.yml -f lane=staging
```
