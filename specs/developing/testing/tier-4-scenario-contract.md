# Tier 4 Scenario Contract

Status: target contract for the core Tier 4 upgrade guarantee. This
document defines the retained production inputs, candidate artifacts, world
setup, actions, observables, and current gaps for the Desktop and managed-cloud
N-1 to N journeys.

[`core-release-validation.md`](core-release-validation.md) owns the complete
change-triggered compatibility inventory.
[`release-worlds-and-fixtures.md`](release-worlds-and-fixtures.md) owns shared
artifact preparation and infrastructure lifetimes. This document owns the two
standing composed upgrade journeys beneath `T4-DESKTOP-1`, `T4-RUNTIME-1`, and
their embedded `T4-CATALOG-1` assertions.

## Core Guarantee

Tier 4 does not rerun Tier 3 on an old installation. It proves one narrower and
more dangerous transition:

```text
real retained production N-1 state
  -> real shipped update mechanism
  -> exact already-built candidate N artifacts
  -> preserved state
  -> installed agent artifacts converge to N pins
  -> one real post-update turn
```

The two standing worlds are:

1. a production N-1 Desktop updated through Tauri to Desktop N; and
2. a production N-1 E2B sandbox whose target-scoped desired AnyHarness version
   changes from N-1 to N.

The broader Tier 4 manifest contains legitimate change-triggered migration and
compatibility guarantees. It is not an instruction to create 27 always-on live
upgrade worlds. Those rows reuse retained data or one of these worlds only when
their owning surface changed.

Self-host `update.sh` qualification is change-triggered when the self-host
bundle, Compose topology, migrations, or update script changes. It is important
release coverage but does not create a third standing core world. Public
artifact-chain integrity remains an every-release gate without booting another
upgrade world.

## Artifact Identity

### N-1 means the last qualified production release

N-1 is resolved from the retained manifest for the last production release
qualified before N. It is never:

- inferred by subtracting one patch version;
- rebuilt from candidate source with an older version string;
- selected from a rolling `stable` tag without digest proof; or
- replaced by whichever old artifact happens to remain on staging.

The retained N-1 manifest identifies at least:

```text
production source SHA
production Desktop app and updater artifact digests
Desktop updater trust identity
bundled Desktop AnyHarness, Worker, seed, catalog, and registry identities
immutable production E2B template ID and input hash
Worker, Supervisor, and AnyHarness versions and digests in that template
installed seed/catalog agent pins
```

### N is built once

Candidate preparation already builds and records N. Tier 4 consumes those
artifacts; a scenario does not rebuild them:

```text
candidate source SHA and manifest hash
signed Desktop N updater artifact
bundled Desktop AnyHarness, Worker, seed, catalog, and registry identities
Linux AnyHarness N binary, digest, size, and checksum
candidate Worker/Supervisor artifacts when their triggered rows apply
immutable E2B template N for Tier 3 new-sandbox qualification
```

The Desktop and cloud scenarios compare every activated artifact to this one
candidate manifest.

Each standing journey emits explicit results for the application/runtime
transition, preserved state, every already-installed managed native CLI, every
already-installed ACP agent process, and the post-update turn. A healthy parent
process cannot hide a skipped or failed reconciliation child cell.

## Two Controllers, One Transition

The old target remains connected to one controller throughout its scenario.
The controller changes the desired version; the test does not replace files in
the target itself.

| Target | N-1 source | Controller | Upgrade signal | N source |
| --- | --- | --- | --- | --- |
| Desktop | Retained production N-1 application | Isolated updater feed trusted by the N-1 application | Feed changes from no update to signed N available | Signed candidate Desktop updater artifact |
| E2B sandbox | Retained immutable production N-1 template | Candidate qualification API written into Worker config at provisioning | This target's desired AnyHarness version changes N-1 to N | Run-scoped immutable AnyHarness artifact route |

The Desktop product API URL does not change during the update. The E2B Worker
API URL also does not change after provisioning. Only the updater manifest or
target desired version changes.

## Natural N-1 State

Each standing journey creates only the ordinary state needed to prove that an
upgrade preserves a working product:

- an authenticated actor;
- a real repository and workspace;
- a real session with one completed cheap-model turn;
- the naturally installed N-1 catalog-managed native agent CLI and ACP
  agent-process artifacts; and
- recorded version, digest, catalog, agent, runtime-home, session, and event
  identities.

The live world does not manufacture missing, corrupt, user-modified, or
user-owned artifact permutations. `T2-UPDATER-1` owns signature, checksum,
unsafe-input, partial-download, atomic-swap, retry, last-good, and rollback
decision matrices for both updater mechanisms. The two standing Tier 4
journeys prove the natural N-1 to valid-N success transition and do not claim a
live corrupt-candidate rollback drill. When an updater mechanism itself
changes, its triggered Tier 4 row adds the smallest real failure injection
needed to prove activation remains fail-closed.

MCP servers are not ACP agent processes. Product and third-party MCP runtime
configuration upgrades belong to `T4-RUNTIMECFG-1`, not the catalog
reconciliation assertion in these two journeys.

## Desktop N-1 To N

### World preparation

The Desktop input is the actual retained production N-1 artifact whenever the
shipped app can be directed safely to an isolated qualification feed. It must
contain its real production AnyHarness/Worker sidecars and real agent seed.
Placeholder sidecars are never qualification evidence.

The production Desktop currently bakes its updater endpoint and trusted public
key into the app. Pre-promotion testing therefore needs a safe isolated-feed
mechanism that preserves signature verification. An external native
qualification driver may supply only the alternate endpoint to the real Tauri
updater engine while targeting a disposable byte-identical copy of the retained
N-1 application and retaining the production public key. It must compare
against the application's actual N-1 version and consume the exact
production-key-signed candidate archive. The composed scenario then launches
the swapped N application and proves the product integration; the external
transaction alone is only updater-engine evidence.

A previously shipped endpoint-only qualification hook or isolated DNS/TLS
interception on a disposable macOS runner are also acceptable. None may
override the trusted public key, patch the retained N-1 payload, or move the
public production stable feed.

If the exact production artifact cannot be driven safely, a retained
qualification twin built from the exact N-1 production source is a bootstrap
exception only. It must contain the exact production sidecar, seed, catalog,
and registry payload hashes; its only permitted divergence is the updater
endpoint, and it retains the production public key. A twin using a throwaway
key is only updater-mechanism signal. Rebuilding current candidate source with
an N-1 version is not permitted.

The isolated feed initially reports no version newer than N-1. After the
baseline turn, it exposes the already-built candidate N updater artifact and
signature under the N-1 production trust chain. A throwaway trust chain may
exercise the mechanism during development but cannot qualify production
artifacts.

The world runs on a supported disposable macOS runner with an isolated HOME,
app data, keychain scope, runtime home, installation directory, updater feed,
and cleanup ledger.

### `T4-DESKTOP-1` — real application update

#### Baseline

1. Install and launch the retained N-1 application.
2. Authenticate through the product and create a local workspace/session.
3. Wait for N-1 AnyHarness readiness, seed hydration, and installed-agent
   reconciliation.
4. Complete one bounded turn on the cheapest eligible real model.
5. Record Desktop, AnyHarness, Worker, seed, catalog, registry, native CLI, ACP
   agent-process, runtime-home, workspace, session, transcript, event cursor,
   and auth identities.

#### Upgrade

1. Make candidate N available through the isolated signed updater feed.
2. Trigger the same Tauri check, download, signature verification, installation,
   and relaunch path used by the product.
3. Assert the installed application is the exact candidate N artifact.
4. Launch the N application, which starts its bundled AnyHarness N against the
   existing N-1 runtime home.
5. Wait for N seed hydration and installed-only catalog reconciliation.

#### Required assertions

- Desktop reports version N and its installed bundle digest matches the
  candidate manifest.
- The bundled AnyHarness and Worker are real candidate artifacts, not test
  placeholders.
- AnyHarness reports N, uses the same runtime home, and reads the previous
  workspace/session/transcript.
- Seed hydration reaches a non-failed terminal state with the expected N seed
  version, target, and seeded agents.
- Agent reconciliation reaches terminal completion with zero failed per-agent
  outcomes; top-level HTTP health alone is insufficient.
- The active bundled catalog and trusted registry identities match N.
- Every already-installed catalog-managed native CLI and ACP agent-process
  artifact matches its N pin and verified source. A naturally unchanged pin is
  an evidenced no-op; a naturally changed pin performs the real update.
- Authentication and app/runtime state survive the real relaunch.
- The existing session remains readable and completes one additional bounded
  turn without duplicated transcript events.
- A second reconciliation is idempotent.

### Desktop evidence

Evidence includes:

- retained N-1 and candidate N manifest hashes and Desktop artifact digests;
- updater endpoint identity, feed manifest hash, signature verification result,
  and installed application version;
- bundled sidecar/seed/catalog/registry digests;
- `runtime-info.json`, `/health`, runtime home, seed and reconcile snapshots;
- `/v1/catalogs/agents/version`, per-agent native and ACP artifact status,
  versions, paths, and install-manifest hashes;
- pre/post workspace, session, transcript, event cursor, and auth continuity;
  and
- the post-update turn correlation id.

## Managed-Cloud Sandbox N-1 To N

### World preparation

The candidate N qualification API is deployed first. Running candidate server
code while holding an old target at N-1 is intentional: it matches the real
rollout order and proves the supported N server to N-1 Worker protocol.

The qualification API is configured to provision the exact immutable
production N-1 E2B template. After E2B creation, the server writes a fresh
enrollment token and its own public Worker base URL into the sandbox Worker
configuration. The API URL is a runtime provisioning input, not a value baked
permanently into the E2B template.

Before launching the Worker, the world creates a run/target-scoped desired
version record set to N-1. The same API exposes exact candidate N artifacts
through immutable manifest-bound routes, but it does not advertise N to that
target until the baseline is complete.

Required preparation:

```text
candidate N qualification API
  + immutable production N-1 E2B template ID
  + target-scoped desired AnyHarness version initially N-1
  + exact candidate N AnyHarness artifact route and checksum
  + disposable actor, qualification GitHub authority/repository, enrollment,
    and target
```

The disposable actor uses the same qualification GitHub App authorization,
installation coverage, and prepared-repository fixture as ordinary managed
cloud provisioning. If the production path eagerly creates the personal
sandbox when user authorization completes, the baseline drives that real path
with the run scoped to the N-1 template. Tier 4 does not repeat the complete
OAuth negative matrix; it proves that an ordinarily authorized user receives a
working N-1 target that can later update in place.

Desktop or hosted Web may drive the cloud product actions, but the product
client is not upgraded in `T4-RUNTIME-1`. Desktop N-1 to N is exclusively
`T4-DESKTOP-1`; combining the two transitions would make a failure impossible
to attribute and would retest unrelated state.

The world must not mutate the API deployment's global version environment,
roll a shared staging service, use a durable shared user, or fall back to a
rolling artifact.

### `T4-RUNTIME-1` — heartbeat-driven runtime update

#### Baseline

1. Authenticate a disposable actor and provision its sandbox through the
   product using the immutable N-1 template.
2. Assert N-1 Supervisor, Worker, AnyHarness, bundled catalog/registry, and
   installed native/ACP agent identities.
3. Create a cloud workspace/session and complete one bounded turn.
4. Record Worker identity/store state, applied revisions, event cursor, pending
   command results, runtime home, session, transcript, and target status.

#### Upgrade

1. Change only this target's desired AnyHarness version from N-1 to exact N.
2. The N-1 Worker receives N on its ordinary heartbeat and atomically writes a
   durable update request. It does not download, replace, restart, or roll back
   the runtime itself.
3. The N-1 Supervisor consumes the request, resolves the candidate manifest,
   downloads and verifies the N artifact, privately stages it, quiesces the
   dependency pair, atomically activates it, and restarts in dependency order.
4. Supervisor health-gates AnyHarness N and restores the last-good runtime if
   activation cannot become healthy.
5. Worker reconnects with its durable identity and reports convergence.
6. AnyHarness N opens the existing runtime home and performs installed-only
   reconciliation from its N bundled catalog and trusted registry.

#### Required assertions

- The heartbeat response for this target changes N-1 to N while unrelated
  targets remain unchanged.
- Exactly one durable request is produced for the divergence; replayed
  heartbeats do not duplicate activation.
- Worker performs no direct binary swap or process kill.
- Supervisor's staged artifact version, size, checksum, and digest match the
  candidate manifest; no `stable` fallback is accepted.
- AnyHarness N becomes healthy and reports the exact candidate version/digest.
- Worker reconnects and reports N using the same durable target identity,
  applied revisions, cursor, and pending-result state.
- The existing workspace/session/transcript remains readable and event sequence
  stays monotonic across restart.
- Every already-installed managed native CLI and ACP agent-process artifact
  matches its N catalog pin with zero per-agent reconcile failures.
- A naturally unchanged pin is an evidenced no-op; a naturally changed pin is
  actually downloaded, verified, and activated.
- One additional cheap turn completes in the existing session.
- The sandbox remains based on its immutable N-1 E2B image. Tier 3 separately
  proves that new sandboxes use the N template.

### Cloud evidence

Evidence includes:

- retained N-1 manifest and immutable E2B template identities;
- target/run id and before/after target-scoped desired-version records;
- runtime-written Worker base URL origin and enrollment identity without raw
  tokens;
- Worker heartbeat versions and durable update-request identity;
- Supervisor request, manifest, checksum, staging, activation, restart,
  health-gate, and final status records;
- before/after component digests, runtime health, catalog/registry identities,
  and per-agent native/ACP artifact results;
- Worker durable identity, revision, cursor, and pending-result continuity;
- workspace/session/transcript/event continuity and post-update turn id; and
- cleanup and provider reconciliation.

## First Supervisor-Ownership Transition

The standing cloud scenario assumes the production N-1 installation already
contains and runs a Supervisor that understands the durable request protocol.
Candidate N code cannot retroactively give an older Worker/Supervisor that
ability.

The first release moving from today's direct-Worker activation to
Worker-request/Supervisor-activation therefore requires a one-time bridge with
its own strict transition proof. The implementation must declare how existing
production sandboxes reach the new ownership model—for example, through a
compatible legacy updater that installs and activates the bridge—without
reprovisioning or losing user state. Once that bridge release is production
N-1, subsequent releases use the ordinary standing scenario.

This transition is an implementation prerequisite, not permission to keep two
permanent activation paths. The legacy direct-Worker path is removed after the
supported transition window.

## Change-Triggered Tier 4 Inventory

The remaining `T4-*` rows are selected by changed artifacts and contracts:

- Worker or Supervisor update mechanics trigger their component lifecycle rows.
- Agent seed/catalog changes reuse the two standing worlds' reconciliation
  assertions plus focused lower-tier ownership/safety cases.
- Schema, billing, credential, GitHub, workflow/delegation, support, mobile,
  self-host, and wire-contract changes load their retained N-1 state and run
  their narrow compatibility row.
- E2B template identity is primarily Tier 3 for new sandboxes; Tier 4 only
  proves an existing N-1 sandbox retains its base image and supported in-place
  components converge.
- Public artifact integrity is a release gate but not a third upgrade world.

Change-triggered rows may share a prepared Desktop or sandbox when isolation is
explicit. They do not cause the complete Tier 3 suite or all other Tier 4 rows
to rerun for every permutation.

## Local And GitHub Actions

The same scenario code and artifact manifests execute in both environments:

- Desktop runs on a supported disposable macOS machine. Locally it uses an
  isolated HOME/feed; CI uses a protected macOS runner and protected signing
  material or the retained qualification trust chain.
- Managed cloud always uses real E2B and the public qualification API. Local
  invocation changes only where the runner process lives.
- Candidate artifacts are prepared once and downloaded by digest.
- N-1 artifacts are resolved from the retained production manifest.
- Workflow YAML selects the scenario and supplies protected handles; it does
  not rebuild N-1/N or perform the upgrade itself.

## Current Initial Red Gaps

The agreed contract is not implemented today:

- current Desktop automation builds candidate source twice with version edits,
  stages placeholder sidecars, swaps a bundle without relaunching it, and does
  not exercise runtime/session/agent convergence;
- candidate Worker/AnyHarness version identity is not release-stamped end to
  end: current binaries can report the crate's hard-coded `0.1.0`, and the
  existing cloud update prototype expected-fails on that mismatch (#1089).
  CI/CD artifact construction plus Worker/runtime version reporting own this
  prerequisite; neither standing journey can qualify until the reported
  version and digest identify exact candidate N;
- the exact retained production Desktop cannot yet be safely directed to an
  isolated updater feed in the complete product journey;
- Desktop Tier 4 is opt-in/local-only and reports blocked in CI;
- cloud desired versions are global image environment pins, not target/run
  scoped;
- cloud artifact routes can fall back to rolling `stable` rather than failing
  closed on a missing candidate artifact;
- managed cloud launches AnyHarness and Worker separately; Supervisor is not
  the active product parent;
- Worker directly downloads/swaps/restarts itself and AnyHarness instead of
  writing a durable Supervisor request;
- Supervisor can verify/stage artifacts but does not consume requests,
  activate, health-gate, or orchestrate rollback;
- current cloud automation mutates shared staging, chooses hard-coded published
  versions, checks only runtime health, and allows expected failure;
- the release workflows do not invoke either standing Tier 4 journey as a
  strict promotion dependency;
- the local/Desktop catalog convergence path required after Desktop N relaunch
  is not implemented today; it must be built rather than removed from the
  contract;
- seed/reconcile work is asynchronous and best-effort, while top-level health
  can remain `ok`; qualification must inspect its terminal per-agent results;
  and
- the first direct-Worker to Supervisor-ownership bridge is not designed.

No item above may become a skipped or expected-success release result. Machine
manifest rows remain `planned` until exact collectors, lanes, candidate binding,
evidence, and fail-closed aggregation are audited.
