# Release Worlds And Fixtures

Status: agreed design contract for the Tier 2, Tier 3, and core Tier 4 test
infrastructure. The scenario manifest defines what must be proved; this document
defines the worlds and fixtures in which those scenarios run.
[`tier-3-scenario-contract.md`](tier-3-scenario-contract.md) defines how those
fixtures compose into the exact Tier 3 journeys and matrix cells.
[`tier-4-scenario-contract.md`](tier-4-scenario-contract.md) defines how the
retained production artifacts and candidate handles compose into the two core
upgrade journeys.

## Core Principle

Run each scenario in the smallest realistic composition containing every
boundary that can break its guarantee. Do not rerun the complete product suite
for every host, deployment topology, or authentication permutation.

Local invocation and GitHub Actions use the same runner, world provisioners,
candidate manifests, scenario implementations, and readiness checks. "Local"
means the runner was invoked from a developer machine; remote dependencies such
as AWS, E2B, Stripe, and the public qualification gateway remain real.

## Candidate Artifacts

Every live or upgrade run begins with a content-addressed candidate manifest:

```text
candidate-manifest.json
  source SHA and source-content hash
  server image digest
  Web build identity
  Desktop artifacts and updater signature
  AnyHarness binaries per supported platform
  Worker and Supervisor binaries per supported platform
  catalog.json and registry.json hashes
  E2B template ID and complete template-input hash
  self-host bundle and image digest
  LiteLLM image and configuration identity
```

Build each artifact once per candidate content hash and platform, then reuse it
across worlds. Compilation caches may accelerate the build, but a cache entry is
not qualification evidence. Downstream jobs download the prepared artifact and
verify its digest against the candidate manifest.

Tier 4 additionally resolves the retained manifest for the last qualified
production release, N-1. N-1 is not inferred by decrementing a patch version or
rebuilding current source with an older version string.

Scenarios consume prepared artifact handles. They do not select versions,
build binaries, publish templates, or decide which feed to use.

## Infrastructure Lifetime

### Long-lived qualification infrastructure

- AWS networking, ECS, RDS, DNS, TLS, and artifact storage
- a dedicated publicly reachable qualification API endpoint
- a dedicated publicly reachable LiteLLM inference endpoint; its admin surface
  remains private
- the E2B team and provider account
- the Stripe test account and test catalog
- test GitHub App and provider accounts
- Desktop signing and updater-test infrastructure
- GitHub environments and encrypted secret storage

Long-lived infrastructure is reusable capacity. It is not shared mutable
product state.

### Run-scoped fixtures

- candidate API deployment or isolated release channel
- users, organizations, invitations, and authentication sessions
- Stripe customers, subscriptions, grants, meters, and webhook events
- LiteLLM teams, virtual keys, budgets, and usage correlation
- E2B sandboxes, Worker identities, and enrollment tokens
- repositories, branches, and GitHub installations
- self-host EC2 instances and DNS names
- Desktop updater feed paths
- desired-version pins for upgrade targets
- cleanup ledger and correlation identifiers

Destructive scenarios must not use a shared durable staging user or mutate a
global staging version pin. Every created external resource is registered in
the cleanup ledger immediately. Scenario cleanup is followed by provider
reconciliation and a TTL janitor for abandoned runs.

## Tier 2 World

```text
real server
real Postgres
Stripe test mode where relevant
Web/Desktop browser surface
controlled external-service fixtures
no E2B sandbox
no complete cloud Worker/Supervisor stack
```

Tier 2 owns server, database, browser, authorization, billing-state-machine,
webhook-replay, policy, and deterministic integration guarantees. It may use a
narrow non-LLM AnyHarness HTTP seam, but it does not launch an agent or replace
a Tier 3 journey.

The runner boots the same world locally and in GitHub Actions. Workflow YAML is
a caller, not an alternate implementation of stack preparation.

## Tier 3 Local-Runtime World

```text
candidate server and Postgres
real local AnyHarness
Desktop and, after host unification, Web
real installed harnesses
real cheap LLM requests
LiteLLM gateway
no E2B
```

This is the deep runtime world. It tests every supported harness, authentication
route, configuration option, local preference, local workspace, and core
chat/session behavior.

Gateway selection follows the changed boundary:

- Reuse the public qualification LiteLLM deployment when gateway code and
  configuration are unchanged.
- Deploy the candidate LiteLLM image/configuration to the qualification service
  when that boundary changed.
- A local diagnostic may run candidate LiteLLM in Docker behind an ephemeral
  public TLS tunnel.
- Only required inference routes are public. Master keys and administrative
  routes remain private to the server/provisioner.

The candidate server provisions run-scoped virtual keys and records the exact
gateway image/configuration identity in the world evidence.

## Tier 3 Managed-Cloud World

```text
public candidate API
candidate server and database
immutable candidate E2B template
Worker, Supervisor, and AnyHarness
public qualification LiteLLM inference endpoint
Stripe test mode
GitHub and provider integrations
```

Preparation is one world-level operation:

```text
prepare candidate runtime bundle once
  -> build immutable E2B template once
  -> smoke the template
  -> deploy the candidate API
  -> create run-scoped organization and user
  -> provision an E2B sandbox
  -> enroll Worker
  -> wait for runtime readiness
  -> execute cloud scenarios
  -> pause, wake, and clean up
```

This world tests cloud-specific boundaries: provisioning, enrollment,
connection, repository materialization, secrets, usage import, billing
consumption, pause/wake/resume, callbacks, and cleanup. It does not repeat the
entire local harness/configuration Cartesian product. A small per-harness cloud
launch smoke is sufficient where platform-specific packaging is the boundary.

The complete E2B template identity includes every runtime-bundle input:
AnyHarness, Worker, Supervisor, credential helper, agent seed/catalog inputs,
bootstrap scripts, install layout, and pinned dependencies. A rolling template
tag moves only after strict qualification; scenarios consume immutable template
IDs.

## Tier 3 Self-Host World

```text
disposable EC2 instance
production self-host bundle and Compose topology
real TLS and DNS
candidate server image
Postgres
optional operator-owned LiteLLM
optional E2B/cloud add-on
Desktop pointed at the instance
```

Preparation is:

```text
provision EC2
  -> install the exact candidate bundle
  -> obtain the setup token
  -> claim the administrator
  -> create an invitation and user
  -> connect Desktop
  -> verify login, capability truth, and selected optional profiles
  -> perform one representative real agent turn
  -> terminate the instance
```

This world owns installer, TLS, setup, registration, login, invitations,
Desktop server switching, persistence, optional-profile behavior, and truthful
capability reporting. It does not rerun every managed-cloud or local-runtime
scenario.

## Core Tier 4 Worlds

The agreed core Tier 4 mandate is narrow: prove that an existing Desktop or
managed-cloud sandbox upgrades from real N-1 artifacts to the exact candidate
N, and that AnyHarness then converges its already-installed native CLIs and ACP
agent processes to the N catalog pins.

Here N-1 means the exact retained artifacts from the last qualified production
release, resolved by manifest and digest. It never means a decremented patch
number or candidate source rebuilt with an older version string. Candidate N is
built once during candidate preparation and reused by both worlds.

MCP servers are a separate runtime-configuration surface; they are not ACP
agent processes and do not share this reconciliation assertion.

### Desktop N-1 to N

```text
retained production N-1 Desktop
real N-1 AnyHarness and installed agents
isolated signed updater feed containing N
```

Flow:

```text
launch Desktop N-1
  -> record Desktop, AnyHarness, catalog, native CLI, and ACP process identities
  -> trigger the real Tauri update
  -> install and relaunch Desktop N
  -> launch bundled AnyHarness N against the existing runtime home
  -> wait for seed hydration and agent reconciliation
  -> assert exact N binary and installed-agent pins
  -> perform a cheap real agent turn
```

The updater feed is local to the developer Mac or macOS CI runner. It contains
the exact candidate updater artifact and signature but never moves the public
production stable feed. The retained N-1 application contains its real
production sidecars and seed resources; placeholder sidecars are not qualifying
evidence. Because the production endpoint is currently compiled into the app,
the isolated feed is supplied through the external or previously shipped safe
mechanism defined by the Tier 4 scenario contract without patching N-1 payload
bytes or bypassing signature verification.

When an agent pin differs between N-1 and N, the scenario proves the real
artifact update. When the pins are equal, it proves the startup reconcile is a
no-op. Deterministic pin-drift edge cases remain focused lower-tier tests rather
than artificial Tier 4 world states.

### Managed-cloud sandbox N-1 to N

```text
candidate qualification API
immutable N-1 E2B template
N-1 Worker, Supervisor, and AnyHarness
candidate N artifacts in immutable qualification storage
run-scoped desired-version channel
```

Flow:

```text
set this run's desired versions to N-1
  -> provision an N-1 sandbox
  -> verify the baseline versions
  -> change only this target/run to desired N
  -> Worker heartbeat observes desired N
  -> Worker persists an update request
  -> Supervisor verifies and activates AnyHarness N
  -> Supervisor health-gates the new runtime
  -> AnyHarness reconciles installed native CLIs and ACP agent processes
  -> assert exact N versions and pins
  -> perform a cheap real agent turn
```

The candidate API redirects the target updater to run-scoped immutable
artifacts, for example:

```text
qualification/<run-id>/<candidate-sha>/linux-x86_64/anyharness
qualification/<run-id>/<candidate-sha>/linux-x86_64/anyharness.sha256
```

No test copies a binary or catalog into the sandbox after provisioning. The
product heartbeat and update path must cause convergence.

The intended ownership contract is:

- Worker observes desired state, persists the update request, and later reports
  convergence.
- Supervisor downloads/verifies or consumes verified staged components,
  activates them in dependency order, health-gates them, and rolls back.
- AnyHarness never replaces its own binary. After N starts, it owns installed
  agent reconciliation.

The current direct-Worker activation implementation does not satisfy this
intended boundary. The first release that introduces the Worker-to-Supervisor
handoff requires a dedicated transition test. Subsequent releases use the
ordinary N-1-to-N flow above.

## Local And GitHub Actions Execution

Both environments call the same preparation and scenario code:

```text
local
  credentials from ignored local secret storage
  artifacts from a content-addressed local cache
  remote E2B, AWS, Stripe, and qualification gateway remain real
  Desktop Tier 4 runs on the developer Mac

GitHub Actions
  credentials from protected GitHub environments
  prepare-candidate builds and uploads artifacts once
  downstream world jobs download and verify them
  independent Tier 3 and Tier 4 jobs run in parallel
```

A red CI run must reproduce by using its candidate manifest and runner flags
locally. Secrets are named in the environment-variable catalog and never
embedded in scenarios, artifacts, logs, or evidence.

## Readiness And Signal Rules

Each world provisioner returns a typed ready handle only after validating its
real boundaries: process health, schema readiness, artifact identity, public
reachability where required, and run-scoped credentials. Scenario execution
starts only after world readiness.

A required world that cannot reach readiness fails strict qualification. A
required row cannot be converted to green with `continue-on-error`, an
expected-failure status, a missing credential, or a silently skipped external
dependency. Signal-only runs may continue collecting independent failures, but
their aggregate is not release evidence.

Strict evidence binds the source identity, candidate-manifest hash, world
identity, artifact digests, scenario IDs, final results, and cleanup result.
Production feeds, rolling tags, and desired-version pins move only after that
evidence is green.
