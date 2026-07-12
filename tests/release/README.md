# release-e2e — tier-3 live runner

The tier-3 "live end-to-end" runner (see `specs/developing/testing/README.md`
and `specs/developing/testing/scenarios.md`). It drives real flows against a
real target: provision/connect, chat per cataloged agent, config apply, secrets
materialization, billing, repo settings. It is designed for release/nightly
qualification, never per-PR, because it spends real money/time. The current
workflow is scheduled and on demand but is not yet consumed by production
promotion; see the enforcement exception in
`specs/developing/testing/core-release-validation.md`.

## Running it

```
# One-time profile setup, then launch it in qualification posture.
make setup PROFILE=<name>
make run PROFILE=<name> RELEASE_E2E=1
# Add CLOUD_WORKER_TUNNEL=ngrok when a selected cell uses a real E2B sandbox.

make release-e2e PROFILE=<name> LANE=local DESKTOP=web AGENTS=all SCENARIOS=all [POLICY=signal|release] [DRY_RUN=1]
make release-e2e LANE=staging DESKTOP=web AGENTS=all SCENARIOS=all [POLICY=signal|release] [DRY_RUN=1]
# or, from tests/release/:
pnpm exec tsx src/cli/run.ts --lane local --dry-run
```

Every credential is declared in `src/config/env-manifest.ts` with where to get
it. On a laptop, the runner automatically parses
`~/.proliferate-local/dev/release-e2e.env` (or the explicit
`RELEASE_E2E_ENV_FILE`) without shelling/sourcing it. The file must be a regular
file owned by the current user with mode `600`; ambient variables override file
values, and values are never logged. Only secrets needed by the selected
scenarios are materialized into the runner process; unrelated file credentials
remain unselected and cannot leak into child probes. GitHub Actions does not
read the implicit home file. Costly/mutating authorization switches
(`RELEASE_E2E_SELFHOST_PROVISION`, `RELEASE_E2E_STAGING_ECS_PIN_BUMP`, and
`RELEASE_E2E_DESKTOP_T4`) are rejected from the persistent file and must be set
for one invocation in the ambient environment.

For the local lane, `PROFILE=<name>` resolves the profile's API, AnyHarness,
Desktop web, and database endpoints from
`~/.proliferate-local/dev/profiles/<name>/instance.json`. Profiles are
worktree-bound. A profile whose worktree was deleted fails preflight with a
command for preparing a fresh profile name instead of silently using stale
ports. A profile bound to another existing checkout also fails unless the
operator explicitly sets `RELEASE_E2E_ALLOW_PROFILE_WORKTREE_MISMATCH=1` for
that invocation. The profile also records its candidate Git HEAD and a source
fingerprint (tracked diff plus untracked content); changing the checkout after
launch invalidates the profile until it is restarted. `RELEASE_E2E_PROFILE` is
rejected outright with `LANE=staging`, so local endpoints cannot silently
retarget a staging run.

Before any identity claim or gateway-auth write, the runner probes only the
selected scenarios' dependencies: API and AnyHarness must return their real
versioned health payload, Desktop must serve the Proliferate application shell,
and the profile database transport must be reachable. Explicit endpoint
variables still win. Profiles launched with an external `DATABASE_URL` require
an explicit `RELEASE_E2E_LOCAL_DATABASE_URL`; the runner never guesses or
persists that credential-bearing URL. Non-default managed Postgres connection
identity is recorded without its password and likewise requires an explicit
test-side URL rather than silently falling back to a same-named default DB.

`RELEASE_E2E=1` is a Make launch posture: it records `singleOrgMode=true` so a
fresh profile exposes the one-time `/setup` claim used by the local durable
identity fixture. It is not a release-runner authorization switch. Profiles
started in ordinary multi-org posture fail a needed auto-seed with the exact
relaunch command. Real local sandbox cells additionally require a persisted,
non-loopback Cloud worker callback; launch with `CLOUD_WORKER_TUNNEL=ngrok` (or
provide an explicit public callback) so E2B can reach the candidate API.

The runner records a missing credential only against the scenarios/lanes
that need it as **blocked** (`src/config/env-resolution.ts`,
`missingRequiredForLane`), so independent work still executes. Outcomes are
**green** (asserted for real), **blocked** (known out-of-band gate/credential
gap), **expected-fail** (attempted and diagnosed), and **failed** (a product or
test assertion failed).

Policy determines the aggregate result:

- `signal` is the CLI/local default. Blocked and expected-fail rows remain
  visible without making the process nonzero; a genuine failed scenario still
  fails the run.
- `release` is the manual GitHub Actions default. Every row in the provisional
  required manifest must be present exactly once and green, and every
  additional emitted registered result must be unique and green. Missing
  credentials, blocked or expected-fail results, duplicate results, and missing
  required rows therefore fail strict qualification.

Neither policy proves the complete product contract yet: the provisional
manifest and registered scenarios remain smaller than
`specs/developing/testing/core-release-validation.md`.

`--dry-run` is planning only. It prints every selected scenario cell, its
missing environment names, and its ordered steps, then states `validated 0`.
It never emits green qualification evidence or calls a provider, model,
billing system, browser, provisioner, or updater.

The legacy `T3-BILL-2` shared-account grant drain is intentionally disabled.
It could poison later tests and violated the authoritative disposable-fixture
contract. Until the correlation-owned Stripe/Bifrost/E2B billing world lands,
the row reports non-green before mutating any grant; strict release policy
therefore remains red rather than manufacturing billing confidence.

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
- **Broken-session outcome.** A broken session chain
  (revoked/expired/never-persisted token) raises
  `StagingSessionUnavailableError`, which durable-user scenarios convert to a
  `ScenarioBlockedError`. That is non-fatal diagnostic signal under `signal`
  and a failed qualification under `release`. Re-bootstrap and reseed
  `RELEASE_E2E_STAGING_SESSION_REFRESH_TOKEN`.
- **First-pass non-green inventory.** The `local` RUNTIME lane has no staging
  pairing → blocked. Sandbox scenarios that mutate/charge the SHARED durable
  user (PROV-1 mint-user, PROV-2 wake, SEC-MAT-1 secret write, INT-1 integration
  connect) are DEFERRED (blocked) until a dedicated non-shared staging fixture
  org exists. BILL-1/2 block on the local-only `RELEASE_E2E_LOCAL_DATABASE_URL`
  (staging DB is VPC-only). CHAT/WT/UPDATE/REPO sandbox halves are expected-fail
  (bodies unimplemented / GitHub-App seed unavailable). **PROV-2 is the real
  end-to-end proof:** it authenticates the durable user through the rotating
  session and reads `GET /cloud-sandbox`. Signal policy inventories these
  outcomes; release policy correctly rejects them as non-green.

### CI

`.github/workflows/release-e2e.yml` has two jobs. The local job runs on the
nightly schedule and on non-staging dispatch. The staging job is dispatch-only
with `lane=staging` (kept off the schedule so shared staging state is not
exercised unattended):

For diagnostic inventory, dispatch signal policy explicitly:

```
gh workflow run release-e2e.yml -f lane=staging -f policy=signal
```

Omitting `policy` uses the strict `release` default and is expected to stay red
until every emitted result is green and every provisional required row is
present.
