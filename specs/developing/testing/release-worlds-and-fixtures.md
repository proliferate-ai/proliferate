# Release Worlds And Fixtures

Status: target contract for the Tier 2, Tier 3, and core Tier 4 test
infrastructure. The scenario manifest defines what must be proved; this document
defines the worlds and fixtures in which those scenarios run. Current-main
enforcement gaps are named in [`core-release-validation.md`](core-release-validation.md)
and never weaken the target contract silently.
[`tier-3-scenario-contract.md`](tier-3-scenario-contract.md) defines how those
fixtures compose into the exact Tier 3 journeys and matrix cells.
[`tier-4-scenario-contract.md`](tier-4-scenario-contract.md) defines how the
retained production artifacts and candidate handles compose into the packaged
install/update target cells.

## Core Principle

Run each scenario in the smallest realistic composition containing every
boundary that can break its guarantee. Do not rerun the complete product suite
for every host, deployment topology, or authentication permutation.

Local invocation and GitHub Actions use the same runner, world provisioners,
candidate manifests, scenario implementations, and readiness checks. "Local"
means the runner was invoked from a developer machine; remote dependencies such
as AWS, E2B, Stripe, and the public qualification gateway remain real.

## Vocabulary

These axes are independent and must not be collapsed into a generic `lane`:

- **execution host**: the laptop or GitHub Actions runner executing the test
  process;
- **world**: `tier-2`, `local-runtime`, `managed-cloud`, `self-host`, or
  `tier-4`;
- **product host**: Desktop's browser renderer, packaged/native Desktop, or
  hosted Web;
- **target**: the independently evidenced Tier 4 target cell when `world` is
  `tier-4` — clean candidate Desktop, Desktop N-1→N, E2B runtime N-1→N, or
  change-triggered self-host N-1→N;
- **selector**: the required cell set, such as the merge set or release
  qualification set; and
- **behavior**: `diagnostic` or `strict` result handling.

Moving a run from a laptop to GitHub Actions changes the execution host and
secret source, not the selected world, product behavior, preparation code, or
assertions. Existing `LANE` and runtime-lane flags are migration inputs only;
new contracts use the explicit axes above.

## Shared Lifecycle

Every world uses one runner-owned lifecycle:

```text
resolve selected cells and exact artifact receipts
  -> create run and shard identity
  -> preflight required local capabilities and credentials
  -> prepare the selected world
  -> prove readiness and return a typed ready-world handle
  -> compose run-scoped actor/repository/billing fixtures
  -> execute cells and record every final result
  -> reconcile the cleanup ledger
  -> evaluate diagnostic or strict behavior
```

This lifecycle is shared infrastructure, not a second implementation of the
product journeys. A world is prepared once per compatible shard and reused by
the cells whose isolation contract permits it.

## Candidate Artifacts

Every live or upgrade run begins with a content-addressed candidate manifest:

```text
candidate-manifest.json
  source SHA and source-content hash
  server image digest
  Desktop renderer build identity
  hosted Web build identity when enabled
  signed packaged Desktop artifacts and updater signature
  AnyHarness binaries per supported platform
  Worker and Supervisor binaries per supported platform
  catalog.json and registry.json hashes
  E2B template ID and complete template-input hash
  self-host bundle and image digest
```

Build each artifact once per candidate content hash and platform, then reuse it
across worlds. Compilation caches may accelerate the build, but a cache entry is
not qualification evidence. Downstream jobs download the prepared artifact and
verify its digest against the candidate manifest.

Tier 4 additionally resolves the retained manifest for the last qualified
production release, N-1. N-1 is not inferred by decrementing a patch version or
rebuilding current source with an older version string.

Both manifests are versioned machine contracts. Each available artifact slot
contains an immutable locator plus the digest/checksum needed to verify the
downloaded bytes; E2B slots contain an immutable template ID and complete input
hash. A slot may be explicitly unavailable while the foundation is under
construction, but strict execution rejects an unavailable slot required by a
selected world. Rolling references such as `latest` or unverified `stable`
cannot satisfy an artifact slot.

The retained-production manifest also binds the production release/source SHA
to the trusted qualification evidence that allowed it to be promoted. It is
the receipt for the actual production N-1 artifacts, not a request to rebuild
them.

The self-host artifact slot binds both the server image digest and the exact
`proliferate-deploy.tar.gz`. The tarball contains `install.sh`,
`docker-compose.production.yml`, `Caddyfile`, bootstrap/update/preflight/
health/doctor scripts, the environment template, and `VERSION`. Optional
self-host cloud cells additionally bind the Linux AnyHarness, Worker,
Supervisor, catalog/registry, credential-helper, and bootstrap inputs they
install. Scenarios never reconstruct this bundle from loose source files.

The qualification LiteLLM deployment is persistent external infrastructure,
not a candidate artifact rebuilt by every run. World evidence records its
deployed image/configuration identity and readiness, while scenarios receive
fresh run/actor/cell-scoped virtual keys and budgets.

`tests/release/src/template/cache-manifest.ts` is only a local E2B content-cache
index. `core-release-scenario-manifest.json` is only the target scenario
inventory. Neither is a candidate or retained-production artifact manifest.

Scenarios consume prepared artifact handles. They do not select versions,
build binaries, publish templates, or decide which feed to use.

## Infrastructure Lifetime

### Long-lived qualification infrastructure

- AWS IAM, networking, security groups, Route53 authority, TLS/ingress, and
  artifact storage capacity
- a dedicated publicly reachable qualification API ingress; the candidate
  deployment and mutable product/database state behind it remain isolated per
  run or release channel
- a dedicated publicly reachable LiteLLM inference endpoint; its admin surface
  remains private
- a publicly reachable qualification callback relay for Stripe and E2B; it
  preserves exact signed provider bytes while its delay/replay controls remain
  private
- the E2B team and provider account
- the Stripe test account and test catalog
- qualification GitHub App, bot actor, organization, repository, and permanent
  App installation
- durable encrypted GitHub refresh-token storage and a distributed lock for
  token rotation across shards
- test provider accounts
- Desktop signing and updater-test infrastructure
- GitHub environments and encrypted secret storage

Long-lived infrastructure is reusable capacity. It is not shared mutable
product state.

### Run-scoped resources and product state

- candidate API deployment or isolated release channel
- users, organizations, invitations, and authentication sessions
- Stripe customers, subscriptions, grants, meters, and webhook events
- callback-relay routes, delivery ledgers, and controlled delay/replay handles
- LiteLLM teams, virtual keys, budgets, and usage correlation
- E2B sandboxes, Worker identities, and enrollment tokens
- actor GitHub authorizations, product repository registrations/environments,
  repository grants, and any run-specific working branches
- self-host EC2 instances and DNS names
- Desktop updater feed paths
- desired-version pins for upgrade targets
- cleanup ledger and correlation identifiers

Destructive scenarios must not use a shared durable staging user or mutate a
global staging version pin. Every created external resource is registered in
the cleanup ledger immediately. Scenario cleanup is followed by provider
reconciliation and a TTL janitor for abandoned runs.

## World Dependency Matrix

Dependencies are selected per world and per cell; the runner never boots every
provider merely because it is available.

| World | Required composition | Conditional composition | Explicitly absent |
| --- | --- | --- | --- |
| Tier 2 | Real server, Postgres, Desktop renderer in Chromium, deterministic external-service fixtures | Stripe test mode for selected billing cells | Real agent inference, E2B, packaged Desktop, and hosted Web |
| Local runtime | Candidate server/Postgres, candidate AnyHarness, Desktop renderer, installed harnesses, provider route, public qualification LiteLLM | Stripe test mode for billing cells | E2B, self-host EC2, packaged Desktop, and hosted Web |
| Managed cloud | Public candidate API/database, Desktop renderer, immutable candidate E2B template, E2B, Worker, Supervisor, AnyHarness, qualification LiteLLM, persistent qualification GitHub App/bot/install/repository | Stripe for billing cells; integration provider accounts for their cells | Self-host EC2, packaged Desktop, hosted Web, and the full local harness Cartesian product |
| Self-host | Disposable EC2, DNS/TLS, exact candidate bundle/server image, Postgres, Desktop renderer, separate candidate AnyHarness, run-scoped BYOK credential | Operator LiteLLM profile, GitHub OAuth, or E2B add-on only for their advertised-posture cells | Packaged Desktop, managed-product billing, and unrelated hosted services |
| Tier 4 | Candidate and retained-production manifests plus packaged/native controllers and the exact selected target handles | Clean candidate Desktop, Desktop N-1→N, E2B runtime N-1→N, and change-triggered self-host N-1→N cells select only their own composition | The complete Tier 3 functional Cartesian product |

Candidate AnyHarness, Desktop renderer/package, E2B-template, server, and
self-host artifacts are
built once per content identity and reused across compatible world shards.
Long-lived LiteLLM, Stripe, GitHub App, E2B-team, and AWS capacity may be reused,
but every user, key, customer, sandbox, instance, repository grant, and desired
version written for a run is isolated and ledgered.

## Tier 2 World

```text
real server
real Postgres
Stripe test mode where relevant
Desktop renderer in Chromium
controlled external-service fixtures
no E2B sandbox
no complete cloud Worker/Supervisor stack
no packaged Desktop
no hosted Web until product-client unification
```

Tier 2 owns server, database, browser, authorization, billing-state-machine,
webhook-replay, policy, and deterministic integration guarantees. It may use a
narrow non-LLM AnyHarness HTTP seam, but it does not launch an agent or replace
a Tier 3 journey.

Stripe test mode is the one standing real-network Tier 2 exception. It is not a
fake: the tests use Stripe's test API, customers, subscriptions, payments, and
test clocks. Trusted CI must have the test credential and fail closed when it
is absent. A developer's explicitly diagnostic local run may report the Stripe
cells blocked when the credential is unavailable.

The runner boots the same world locally and in GitHub Actions. Workflow YAML is
a caller, not an alternate implementation of stack preparation.

## Tier 3 Local-Runtime World

```text
candidate server and Postgres
real local AnyHarness
Desktop renderer in Chromium
real installed harnesses
real cheap LLM requests
LiteLLM gateway
no E2B
```

This is the deep runtime world. It tests every supported harness, managed
gateway and user-key route, live-discovered configuration option, Desktop-local
workspace, and core chat/session behavior. It uses the Desktop renderer in
Chromium for every product interaction. Ordinary application preferences are
Tier 2; packaged/native Desktop, its bundled sidecar, native filesystem/
keychain behavior, clean installation, and relaunch are Tier 4 only.

Hosted Web is deliberately absent: it cannot and must not reach a local
AnyHarness. The current Tier 2 and Tier 3 contracts use the Desktop renderer;
after product-client unification, selected shared cloud journeys add hosted Web
without duplicating the expensive matrix.

All local-runtime qualification uses the same persistent public qualification
LiteLLM deployment. The runner never resets its global state: the candidate
server provisions fresh run/actor/cell-scoped virtual keys and budgets, then
correlates spend by immutable key identity. Only required inference routes are
public; master keys and administrative routes remain private to the server or
provisioner. World readiness records the exact deployed gateway image/
configuration identity.

## Tier 3 Managed-Cloud World

```text
public candidate API
candidate server and database
Desktop renderer in Chromium
immutable candidate E2B template
Worker, Supervisor, and AnyHarness
public qualification LiteLLM inference endpoint
Stripe test mode when selected
GitHub and provider integrations
```

Base-world preparation creates reusable capacity without pre-completing the
first-user provisioning behavior:

```text
prepare candidate runtime bundle once
  -> build immutable E2B template once
  -> smoke the template
  -> deploy the candidate API
  -> verify E2B, gateway, GitHub App, Stripe, and callback capabilities selected
     by the shard
  -> return the managed-cloud base handle
```

`CLOUD-PROVISION-1` starts from that handle with a fresh actor and proves that
the real GitHub authorization/product path creates exactly one sandbox,
enrolls Worker/Supervisor, and reaches AnyHarness readiness. Other cloud cells
may reuse a separately prepared sandbox resource after that provisioning path
has an independently green result; they never seed workspace/session state
that their own journey is meant to prove.

GitHub qualification keeps three boundaries distinct:

- product GitHub login identifies the Proliferate actor;
- GitHub App user authorization provides that actor's real user-to-server token
  and triggers the personal-sandbox path; and
- the permanent qualification App installation grants repository coverage.

The App remains installed on the durable qualification organization/repository.
Ordinary parallel qualification mocks only the human approval page and the
one-time authorization-code exchange. Playwright clicks the real product
control, captures the generated GitHub URL and signed state, and asks a private
controller to finish approval. That controller verifies the state belongs to
the expected actor, refreshes the real qualification-bot authorization under a
distributed token-rotation lock, and calls the same production-owned completion
tail as the HTTP callback:

```text
completeAuthorizationSuccess(state, realAuthorization)
  -> validate signed state and actor binding
  -> store the real authorization
  -> ensure the personal sandbox row
  -> schedule real materialization after commit
  -> refresh the real installation cache
```

The paid-Core provisioning cell requires this tail to create exactly one real
E2B sandbox. A separate fresh-free-actor cell proves authorization succeeds but
provider creation remains compute-gated until paid credit exists. One serial
periodic smoke drives the real interactive redirect, code exchange, and HTTP
callback end to end. No qualification path may mock GitHub identity/token,
installation/repository authority, E2B, Worker, Supervisor, or AnyHarness.

This world tests cloud-specific boundaries: provisioning, enrollment,
connection, repository materialization, secrets, usage import, billing
consumption, pause/wake/resume, callbacks, and cleanup. It does not repeat the
entire local harness/configuration Cartesian product. One representative cloud
harness proves Worker/runtime packaging; every-harness coverage remains local.

After Web/Desktop unification, one host-specific cloud-access journey runs on
both Desktop and hosted Web against the same candidate deployment. It proves
authentication bootstrap, gateway connection, stream continuity, deep-link
ingress, and capability truth. Expensive provisioning, metering, exhaustion,
and recovery actions still execute once per required world/shard, not once per
historical frontend.

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
Desktop renderer pointed at the instance
separate candidate AnyHarness for the representative local turn
```

Base-world preparation reserves disposable EC2/network/DNS capacity, supplies
the immutable candidate bundle handle, and provides a clean Desktop-renderer
controller plus separate candidate AnyHarness. It does not install or claim the
product. The composed base self-host journey then performs the transitions
being qualified:

```text
provision the disposable EC2 target
  -> install the exact candidate bundle
  -> obtain the setup token
  -> claim the administrator
  -> create an invitation and user
  -> connect the Desktop renderer
  -> verify login, capability truth, and selected optional profiles
  -> perform one representative real agent turn
  -> terminate the instance
```

This world owns installer, TLS, setup, registration, login, invitations,
renderer-level server switching, server-origin isolation, optional-profile
behavior, and truthful capability reporting. Native config/keychain writes,
packaged-app relaunch, and restoration after relaunch remain Tier 4. It does not
rerun every managed-cloud or local-runtime scenario.

## Tier 4 Packaged-Install / Upgrade Stage

Tier 4 is one qualification world/stage with four independently evidenced
target cells:

1. clean candidate Desktop N;
2. retained production Desktop N-1 to candidate N;
3. retained production E2B runtime N-1 to candidate AnyHarness N; and
4. retained production self-host N-1 to candidate N when that deployment
   boundary changed.

It does not rerun Tier 3. It starts from the smallest ordinary working state
needed by each target, uses packaged/native artifacts and the real shipped
mechanism, proves exact candidate artifacts and agent pins, preserves state,
and completes a post-install or post-update turn.

Here N-1 means the exact retained artifacts from the last qualified production
release, resolved by manifest and digest. It never means a decremented patch
number or candidate source rebuilt with an older version string. Candidate N is
built once during candidate preparation and reused by the selected target
cells.

MCP servers are a separate runtime-configuration surface; they are not ACP
agent processes and do not share this reconciliation assertion.

### Clean candidate Desktop N

```text
exact signed candidate Desktop N package
bundled candidate AnyHarness and seed resources
isolated native HOME, keychain, and runtime home
prepared candidate self-host instance for the native connection cell
```

Flow:

```text
install candidate Desktop N in an isolated native environment
  -> launch its bundled candidate AnyHarness
  -> reconcile candidate catalog, native-agent, and ACP-adapter pins
  -> perform a cheap local turn
  -> connect to the prepared self-host instance through native Connect Server
  -> relaunch the packaged app
  -> prove origin/keychain/auth restoration
```

This cell proves the candidate package can be installed fresh. It is not a
substitute for the retained-production updater cell below.

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

### Self-host N-1 to N

This cell is selected when the self-host deploy bundle, server image, Compose
topology, migrations, or update mechanism changed:

```text
install exact retained production N-1 bundle behind real DNS/TLS
  -> claim the instance and create representative auth/product state
  -> perform one representative turn
  -> run the shipped update mechanism with exact candidate bundle/image digests
  -> prove migrations and health are not reported complete early
  -> prove data, auth, and configuration survive
  -> prove retry is idempotent and N-1 is recoverable on failure
  -> perform one post-update turn
```

This target reuses the Tier 3 self-host provisioner but uses packaged retained
state and the real updater. It does not repeat owner/invitation/profile matrices
already qualified in Tier 3.

## Shared Fixtures

A fixture creates reusable prerequisite product state. It must not pre-complete
the behavior the scenario is meant to prove.

World setup is not a fixture: candidate artifacts, API/database/runtime
processes, E2B or EC2 capacity, run/shard identity, readiness, evidence sinks,
and cleanup ledgers belong to provisioners. Provider access is also not a
fixture: Stripe, LiteLLM, GitHub, E2B, AWS, and integration controllers run in
the privileged test process and load secrets from local ignored storage or
protected GitHub environments. Those credentials never enter the browser unless
a scenario intentionally enters a user-owned provider key through product UI.

The shared fixture surface is deliberately limited to six constructors:

1. `authenticatedActor(role)` returns a registered, authenticated owner,
   existing member, or owner in a different organization. It binds user,
   organization, seat, billing-subject, and real product-session identities and
   uses isolated browser storage.
2. `freshIdentity()` returns a unique unused identity for signup, invitation
   acceptance, first-owner claim, or another authentication transition. It does
   not perform that transition.
3. `preparedRepository(actor, world)` uses the durable qualification repository
   at its known default branch and baseline commit. For local-runtime and the
   self-host local turn, setup clones it to a run-scoped controller path and the
   fixture calls real AnyHarness `POST /v1/repo-roots/resolve`; AnyHarness
   validates/persists the main Git root and returns its repo-root identity. For
   managed cloud there is no controller-side clone: the fixture saves the
   actor's real `kind: "cloud"` repository environment through the server, which
   verifies GitHub authority and materializes the repository inside E2B. The
   fixture returns owner/repository, default branch, baseline commit, and the
   world-specific repo-root or environment handle.
4. `productPage(actor?)` returns a fresh Playwright `BrowserContext` and `Page`
   running the Desktop renderer. With an actor it installs that actor's valid
   product session; without one it starts logged out. It points the same renderer
   at the selected ready world's API/runtime target: local candidate API plus
   separate local AnyHarness, public candidate API plus E2B runtime, or self-host
   EC2 API plus separate local AnyHarness. Hosted Web may later become a second
   host for selected shared journeys; packaged Desktop is never returned here.
5. `unregisteredGithubRepository()` is only for managed-cloud onboarding. It
   returns the durable qualification repository as visible to the real
   qualification GitHub actor but not yet registered in Proliferate for this
   test actor. The App installation already exists; the scenario performs user
   authorization, product registration, sandbox provisioning, and materialization.
6. `billingThreshold(actor, balance)` is only for exhaustion/auto-top-up cells.
   A private qualification controller positions the disposable actor's real
   ledger just above the requested threshold. For LLM credit it expires prior
   active grants, creates a run-tagged administrative grant equal to imported
   spend plus the requested remaining balance, and reconciles the LiteLLM
   budget. For compute it reduces the real active compute grant to the requested
   remaining seconds. The scenario must then cross the threshold through real
   LiteLLM usage or real E2B runtime so metering, Stripe payment/webhook, holds,
   top-up, gating, and recovery remain production behavior. Fresh signup grants,
   checkout, plan credits, and ordinary consumption are never seeded.

Workspace/session creation, harness/model/configuration choice, provider-key
entry, integration connection/use, secret CRUD/materialization, invitations,
GitHub onboarding, sandbox create/pause/wake, checkout/grants/usage/top-ups/
holds/recovery, self-host install/claim/login, and Tier 4 baseline/update state
are scenario actions rather than initial fixtures. A transition may return a
typed handle for compatible later cells only after its own scenario is
independently green.

## Construction Sequence

Build this qualification system in dependency order:

1. freeze the scenario/world/fixture contracts and machine inventory;
2. validate persistent LiteLLM, GitHub, E2B, Stripe, AWS, public-ingress, and
   artifact/download capacity;
3. implement the shared artifact-receipt, run/shard, preflight, typed-world,
   readiness, cleanup, evidence, and diagnostic/strict spine;
4. build and independently smoke exact candidate artifacts;
5. prove one local-runtime, managed-cloud, and self-host vertical slice locally,
   then immediately reproduce each same slice in GitHub Actions:
   - local: actor → prepared repository → Desktop renderer → candidate
     AnyHarness → cheap managed-gateway turn → correlated LiteLLM spend;
   - managed cloud: paid actor → GitHub authorization seam → exactly one E2B
     sandbox → Worker/Supervisor/AnyHarness ready → repository materialized →
     cheap turn → cleanup; and
   - self-host: fresh EC2 → candidate bundle → owner claim/login → Desktop
     renderer connection → representative BYOK turn → cleanup;
6. fan out the remaining Tier 3 cells only after every world has one green local
   and Actions slice; and
7. complete the packaged Tier 4 target cells after the Tier 3 worlds are stable.

This is implementation order. Once the platform exists, independent Tier 3 and
Tier 4 qualification jobs may execute concurrently.

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

## Foundation Contracts

### Run and shard identity

The runner creates identity once, before any provider mutation:

- `runId` groups the complete invocation and all of its evidence;
- `shardId` identifies one deterministic parallel partition;
- `attemptId` distinguishes a retry without erasing the original attempt;
- source SHA and candidate/retained-manifest hashes identify what was tested;
  and
- GitHub workflow metadata or local origin is attached automatically for
  traceability, not supplied as product configuration.

Every provider resource, ready-world handle, cell attempt, evidence record, and
cleanup entry carries the run and shard identity. A one-shard local run still
has an explicit shard identity so its output aggregates exactly like CI.

### Secret preflight

Preflight runs after cell and artifact selection but before world provisioning,
account mutation, or provider spend. It derives requirements from
the selected worlds and cells and checks only local availability and safe basic
shape: for example an E2B key/team pair, a Stripe `sk_test_` key, readable key
files, supported host platform, and public-HTTPS URL shape. It never prints
values and does not substitute for provider authentication or health checks.

The laptop reads ignored local secret storage with the ambient environment
taking precedence. GitHub Actions supplies protected environment secrets. Both
invoke the same preflight implementation. Diagnostic behavior marks only the
affected cells blocked and emits non-qualifying evidence; strict behavior fails
before any external mutation. Actual provider permissions, callback delivery,
and reachability are world-readiness checks.

### Typed ready-world handles

Environment variables and configuration are preparation inputs. Scenarios
receive a verified typed handle, not a loose environment map. Every ready
handle contains run/shard and artifact identities, sanitized endpoints or
clients, readiness observations, and references to the evidence sink and
cleanup ledger. A base-world handle exposes prepared capacity; scenario actions
such as first sandbox provisioning, self-host claim, workspace creation, or
integration connection return narrower typed resource handles and register
them in the same ledger. This prevents setup from pre-completing the behavior
being tested. World-specific base fields expose only what that world owns:

- local runtime: candidate API/database, local AnyHarness, Desktop-renderer
  controller, and qualification gateway;
- managed cloud: public API, immutable template, E2B provider access,
  qualification gateway, persistent GitHub authority, and the Desktop-renderer
  controller; provisioned sandboxes add enrolled Worker/Supervisor/runtime
  handles;
- self-host: instance/network/DNS capacity, exact candidate bundle, SSH/SSM
  control, a clean Desktop-renderer controller, and separate candidate
  AnyHarness; installation and claim add TLS/API, setup-token,
  advertised-capability, and authenticated-client handles; and
- Tier 4: candidate/retained manifests plus only the selected target handles —
  isolated clean or N-1 Desktop installation/runtime home and signed updater
  feed, N-1 sandbox identities with candidate API/immutable artifact route/
  target-scoped desired-version controller, or retained/candidate self-host
  bundle handles.

A provisioner returns the handle only after process/schema health, public
reachability where required, artifact identity, controller enrollment, and
credential applicability have all been observed.

### Cleanup ledger

Every external resource is appended to durable run output immediately after
creation and before it is handed to another operation. A ledger entry records
only safe provider/type/resource identity, owning world, creation state,
cleanup state, attempts, and timestamps; credentials and arbitrary provider
payloads are forbidden. Cleanup runs in reverse registration order, continues
through independent failures, and persists every transition atomically.

Normal completion, assertion failure, interruption, and provisioning failure
all enter the same reconciliation path. A cleanup-by-run command can replay
idempotent provider cleanup after a process or runner crash, and a TTL janitor
is the final abandoned-run backstop. Later janitor success does not
retroactively turn a strict run with failed cleanup green.

### Per-cell evidence and result behavior

Each world provisioner returns a typed ready handle only after validating its
real boundaries: process health, schema readiness, artifact identity, public
reachability where required, and run-scoped credentials. Scenario execution
starts only after world readiness.

A required world that cannot reach readiness fails strict qualification. A
required row cannot be converted to green with `continue-on-error`, an
expected-failure status, a missing credential, or a silently skipped external
dependency. There is no blocked budget in qualification: every required cell
must produce exactly one final green result. Optional and change-untriggered
cells are resolved as `not_required`, never disguised as blocked.

Diagnostic local and scheduled runs may report `blocked` or `expected_fail` so
partially configured environments still produce useful signal. They always
emit non-qualifying evidence, compare their blocked set with the previous run,
and may not be consumed by promotion. A newly blocked diagnostic cell is a
regression alert even when the diagnostic command itself continues.

There are two result behaviors:

- `diagnostic` continues independent cells and reports blocked or unfinished
  work, but its aggregate is always non-qualifying; and
- `strict` requires exactly one final green result for every selected required
  cell, complete world readiness, valid artifact receipts, and successful
  cleanup.

Merge and release qualification are selectors for different required cell
sets, not separate execution behaviors. Planning/dry-run is also not a passing
behavior: it may emit a plan but cannot emit green product evidence.

Strict evidence binds the source identity, candidate-manifest hash, world
identity, artifact digests, scenario IDs, final results, and cleanup result.
Production feeds, rolling tags, and desired-version pins move only after that
evidence is green.
