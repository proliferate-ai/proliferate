# Tier 3 Scenario Contract

Status: target contract for the first standing Tier 3 foundation qualification
wave. This document defines the exact scenario composition, fixtures,
observable evidence, and intentional non-duplication across the local-runtime,
managed-cloud, and self-host worlds.

[`core-release-validation.md`](core-release-validation.md) owns the broader
release inventory. [`release-worlds-and-fixtures.md`](release-worlds-and-fixtures.md)
owns artifact preparation and world lifetimes. This document turns the aligned
Tier 3 subset into executable cases. Case names such as `LOCAL-2` and
`CLOUD-PROVISION-1` are composed journeys beneath the existing `T3-*` target
IDs; they do not create a second guarantee inventory. The machine target
manifest is the sole journey-to-guarantee map. This document deliberately owns
only actions, assertions, evidence, and world reuse, so prose mappings cannot
drift from the executable selector.

## What Is Settled

There is no remaining architectural choice blocking implementation of these
scenarios. Two pricing constants remain configuration inputs:

- the canonical conversion from the Core plan's `$15` compute allocation to
  Proliferate Compute Units;
- the exact LLM and compute top-up pack sizes and prices, which must preserve a
  positive margin.

Those values are configuration inputs. They do not change the worlds, fixture
boundaries, test actions, or required evidence below.

Already-ready cloud access has a settled product target of less than five
seconds to commandable AnyHarness. Cold authorization-to-ready and paused
wake-to-ready are measured separately until product SLOs are set for them.

## Product Rulings Exercised By These Tests

These are test inputs, not conclusions that a test may reinterpret:

1. Proliferate does not use Bifrost. The managed model gateway is LiteLLM.
2. A managed-gateway session receives only the public inference URL and its
   scoped virtual key. LiteLLM administrative credentials never enter a
   runtime target.
3. A user-key session may receive the user's raw provider credential in the
   explicitly permitted runtime target. It must not consume managed LLM credit.
4. Route selection is frozen when an agent process starts. Changing the
   selected route affects a new session, or an explicit process restart where
   that operation is supported; it does not mutate a live process in place.
5. Free personal users receive one lifetime `$2` managed-LLM grant, deduplicated
   by GitHub identity rather than merely by a Proliferate account id.
6. Core costs `$20` per active billed seat per month. Each active billed seat
   contributes `$5` managed-LLM credit and `$15`-equivalent compute credit to
   the organization's shared pools. Usage retains member attribution.
7. LLM balances and top-ups are denominated in USD. Compute remains denominated
   in its canonical compute unit.
8. LLM auto-top-up and compute overage/top-up are separate explicit settings.
   Enabling one never authorizes charges for the other.
9. Managed-LLM exhaustion blocks managed gateway use. It does not pause a
   sandbox, and a valid user API key remains usable.
10. Compute exhaustion pauses and gates cloud compute. It does not consume or
    refill managed-LLM credit.
11. A top-up grant exists only after a successful Stripe payment event. Invoice
    creation, finalization, failure, or an uncollected invoice grants nothing.
12. Organization route policy is flag-only in this qualification wave. Policy
    enforcement can be expanded without changing these base route proofs.

The `$2` free grant and Core `$20 = $5 managed LLM + $15 compute` allocation
are intentional target behavior. Current code still contains the prior `$5`
free-credit and twenty-managed-cloud-hours posture. That mismatch is a product
migration gap to fix against these cases, not a reason to weaken the cases.

## Composition Rule

Each guarantee runs in the smallest real composition containing every boundary
that can break it:

| World | Deeply proves | Does not repeat |
| --- | --- | --- |
| Local runtime | Desktop-renderer workspace/runtime behavior, every supported harness, managed gateway and user API-key routes, live-discovered configuration, session/tab semantics, and per-harness Product MCP integration | Ordinary product preferences, native Desktop persistence/restart, Hosted Web, E2B provisioning, compute metering, cloud secret materialization, self-host installation |
| Managed cloud | GitHub-to-user sandbox binding, immutable template, repo materialization, warm access, Desktop-renderer cloud access, future Web parity, cloud credentials, integrations, compute accounting, holds, and recovery | The full harness/configuration Cartesian product already proved locally |
| Self-host | Candidate install, TLS, first-owner claim, invitations, Desktop-renderer login, origin isolation, optional gateway, and optional cloud add-on | Native Tauri persistence/relaunch, Hosted identity matrix, all local harness options, all managed-cloud billing variants |

A shared prerequisite is proved once and reused within a shard. For example,
an authenticated actor and prepared repository may support several scenarios;
workspace creation, session creation, integration connection, billing
transitions, and provider effects remain scenario actions when they are the
behavior under test.

## Fixture Vocabulary

### World setup

World setup creates expensive shared capacity and verifies readiness. It does
not pre-complete a behavior a scenario is supposed to prove.

- exact candidate manifest and verified artifact handles;
- candidate API/database, persistent qualification LiteLLM identity, and the
  public TLS endpoints required by the selected world;
- local candidate AnyHarness or the immutable candidate E2B template plus the
  artifacts/configuration needed for later Worker/Supervisor enrollment;
- disposable self-host instance where applicable;
- Stripe, GitHub App, E2B, and provider qualification account access;
- run id, resource ledger, evidence sink, and TTL cleanup registration.

Actual actor authorization, E2B creation, Worker/Supervisor enrollment, and
AnyHarness startup in the first-user path remain `CLOUD-PROVISION-1` actions;
world setup supplies capacity and verified inputs only.

### Reusable fixtures

Fixtures provide preconditions whose creation is not the assertion of the
scenario using them:

- `authenticatedActor(role)`: a registered owner, existing member, or owner in
  a different organization, with isolated browser storage, a real product
  session, and returned user, organization, seat, and billing-subject identity;
- `freshIdentity()`: a unique unused identity for signup, invitation acceptance,
  first-owner claim, and other authentication journeys whose transition remains
  scenario behavior;
- `preparedRepository(actor, world)`: the durable qualification repository at a
  known default branch and baseline commit, prepared through the production path
  for the selected world. Local-runtime and self-host setup clone it to a
  run-scoped runner path and resolve it through AnyHarness
  `POST /v1/repo-roots/resolve`; managed cloud saves the actor's cloud repository
  environment and materializes it inside E2B without a controller-side clone;
- `productPage(actor?)`: a fresh Playwright browser context and page running the
  Desktop product renderer, pointed at the selected ready world. It installs the
  actor's real product session when supplied and starts logged out when login or
  registration is the behavior under test;
- `unregisteredGithubRepository()`: a real covered qualification repository that
  is not yet registered in Proliferate. The qualification GitHub App is already
  installed; authorization, registration, sandbox provisioning, and repository
  materialization remain managed-cloud scenario actions;
- `billingThreshold(actor, balance)`: a private qualification controller that
  positions a disposable actor's real LLM or compute ledger just above a target
  threshold. For LLM credit it expires prior active grants, creates a run-tagged
  administrative fixture adjustment equal to imported spend plus the requested
  remainder, and reconciles the LiteLLM budget. For compute it reduces the real
  active compute grant to the requested remainder.

Raw provider and integration keys are privileged controller inputs, not
fixtures. They come from the local qualification secret file or GitHub Actions
secrets and enter the browser only when a scenario deliberately stores a
user-owned credential through the product UI. Gateway enrollment, provider-key
selection, integration connection, and the product grant or payment being
asserted remain scenario actions.

The gateway actor and user-key actor are normally different fresh users. A
route-switch scenario intentionally gives one actor both routes so it can prove
process-bound route semantics. Every fresh actor also gets its own registered
repository fixture.

### Scenario-owned state

Unless a case explicitly says otherwise, the scenario itself creates:

- the workspace and session;
- selected harness, model, mode, and reasoning configuration;
- gateway enrollment and provider-key configuration;
- integration connection and MCP use;
- scoped secret creation/update/deletion;
- invitation, registration, GitHub authorization, repository registration, and
  first-owner claim when those transitions are under test;
- checkout, payment, renewal, top-up, usage, exhaustion, hold, and recovery;
- sandbox creation, pause, wake, or provider-side transition being asserted.

There are no generic `emptyWorkspace` or `workspaceWithSession` fixtures for
the core cases. Those states are important product transitions and are created
in the test.

## Cross-World Evidence Contract

Every case records:

- source SHA, candidate-manifest hash, and every artifact digest or template
  id used by the world;
- world, run, shard, actor, organization, repository, workspace, session, and
  sandbox identifiers as applicable;
- exact route, harness, probed capability snapshot, selected model, and process
  generation;
- sanitized provider request, usage, Stripe, E2B, Worker, and product ledger
  correlation identifiers needed by the case;
- measured readiness and propagation timings;
- cleanup registration and final reconciliation result.

Secrets, raw virtual keys, provider keys, refresh tokens, setup tokens, and
integration credentials never enter logs or evidence.

A required case has one final state: green or red. Missing credentials,
unavailable infrastructure, a blocked provider, a missing product path, or an
unimplemented assertion is red for qualification. Diagnostic siblings and
cleanup may continue after a failure, but `continue-on-error`, expected-fail,
skip-as-success, and normalized exit codes cannot make the aggregate green.

Matrix journeys emit one explicit result per required harness, route, host, or
other derived cell. A journey-level return without those child results cannot
mark the matrix green. This prevents one successful harness from hiding a
skipped or swallowed failure in another.

## Local-Runtime World

### Matrix discovery

The bundled catalog is not assumed to be the sole source of truth. The runner
composes shipped registry/catalog intent, product policy and overlays, and the
live AnyHarness/ACP probe. The live probe is authoritative for what an
installed harness can actually select.

For each supported harness, the runner chooses the cheapest bounded model from
the intersection of the qualification allowlist and the live probed model
set. It first completes one real turn. Only after that proof does it exercise
every visible probed mode, reasoning option, and configuration control.

GitHub Actions exercises managed gateway and user API-key routes. Native agent
authentication is not part of this qualification matrix.

### Local cases

#### `LOCAL-1` — repository to workspace

Given an authenticated actor and prepared local repository, create a local
workspace through the product surface. Assert the correct repository and
default branch, commandable AnyHarness, one visible empty chat, and reload
continuity. Do not seed the workspace or session directly.

#### `LOCAL-2` — managed gateway turn for every harness

For every supported probed harness:

1. create a fresh gateway actor and register its repository;
2. enroll it through the production server path, producing a new LiteLLM
   virtual key and recorded `token_id`;
3. if the harness is not installed, install it through the candidate
   AnyHarness path and verify the exact trusted pin plus ready state;
4. select managed gateway, create a new session, and send one bounded prompt on
   the cheapest eligible model;
5. assert session completion and one stable response after reload;
6. poll LiteLLM unsummarized spend logs and find exactly the correlated request
   under `api_key == token_id`, with real request, model, token, and cost data;
7. assert the product usage event and managed balance reconcile to that request.

The launch evidence must identify the managed route and public LiteLLM origin
without exposing the key. Configuration success alone is not route proof.
For OpenCode, the test explicitly selects a model from the runtime gateway
catalog's injected `proliferate` provider so a native or direct provider cannot
satisfy the turn.

#### `LOCAL-3` — user API-key turn for every harness

For every supported probed harness, read a run-scoped provider key from the
controller's secret environment, store and select it through the product UI,
create a new user-key session, and complete the same bounded turn. Assert the
launch route is user key, the turn completes, no LiteLLM spend row appears for
the actor/run/session, and no managed balance changes. For OpenCode, select a
model belonging to the matching direct provider rather than the injected
`proliferate` gateway provider.

This is provider-agnostic qualification of the user-key route. Individual
harness tests do not encode unrelated provider-specific behavior.

#### `LOCAL-4` — live configuration matrix

After the harness has completed its cheap baseline turn, iterate the controls
advertised by its live probe:

- visible models eligible for qualification;
- visible modes;
- visible reasoning options and levels; and
- other mutable ACP configuration controls.

For each value, select it through the product UI, wait beyond the normal
rejection window, and assert that the UI still shows the accepted value. A
rejected value must leave the last accepted value intact. A paid LLM turn is not
required for every option unless the control's contract cannot otherwise be
observed.

#### `LOCAL-5` — session and tab semantics

Prove all of the following in one workspace:

- switching harness in a visible empty chat preserves one visible tab but
  replaces the unused backend runtime session; the session id changes;
- switching harness after the current session has messages preserves the old
  transcript and creates a new session tab immediately to its right;
- selecting the same harness and changing a supported model stays in the
  session where the harness contract permits it; and
- reload preserves tab order, active tab, harness attachment, and transcript.

#### `LOCAL-6` — route-change semantics

Use a representative single-source harness and give one actor both a valid user
key and gateway enrollment. Start and prove a user-key session, then change the
selected route to managed gateway through the product UI and wait for the new
auth-state revision:

- the existing process remains on the user-key route;
- a new session starts on the gateway route and produces correlated LiteLLM
  spend;
- the old session remains attached to its original route.

OpenCode is excluded from this switch case because its gateway and direct
provider sources intentionally coexist. Its two routes are proved independently
by `LOCAL-2` and `LOCAL-3` with route-specific models.

#### `LOCAL-7` — Product MCP integration for every harness

For each supported harness, connect the deterministic real integration through
the product UI, create a fresh session so startup MCP injection is exercised,
and use the cheapest eligible model to make one real call through the
Proliferate integrations MCP. Assert the expected provider/tool operation and
product audit correlation.

This case proves positive per-harness Product MCP translation. It does not
assert hidden server credential state or a disconnect/failure matrix.

### Local managed-LLM billing cases

#### `LOCAL-BILL-1` — free personal grant and drawdown

Create a fresh GitHub-backed personal identity. Assert one `$2` lifetime grant,
including concurrent/replayed enrollment and a second Proliferate account with
the same GitHub identity. Complete a real managed turn and reconcile LiteLLM
cost to the USD balance debit. Complete a user-key turn and assert no debit.

#### `LOCAL-BILL-2` — Core checkout, seats, and initial grants

Use a real Stripe test checkout for Core. Assert activation only after verified
payment, `$20 × active billed seats` subscription quantity, the correct
proration for seat changes, `$5 × seats` LLM grant, and `$15 × seats` compute
allocation using the configured canonical conversion. Product UI, Stripe, and
both ledgers must agree.

#### `LOCAL-BILL-3` — organization pool and member attribution

Have two members consume real managed turns. Assert both debit the shared
organization LLM pool, each usage record retains the correct member, and no
member's personal `$2` grant changes.

#### `LOCAL-BILL-4` — renewal and replay

Advance a Stripe test clock through renewal. Assert a paid invoice creates
exactly one per-seat LLM and compute period grant, replay creates none, and an
unpaid or failed renewal creates none.

#### `LOCAL-BILL-5` — LLM exhaustion with auto-top-up disabled

Arrange only a small remaining managed balance, spend through it with a real
turn, and assert the scoped managed key is disabled or rejected. The next new
managed session and any existing managed process fail with the owned typed
error; no charge or grant occurs. A user-key session remains usable. No sandbox
pause is expected.

#### `LOCAL-BILL-6` — successful LLM auto-top-up

Enable only LLM auto-top-up, cross the threshold with real LiteLLM usage, and
assert one real Stripe test payment. Only the successful payment event creates
the configured top-up grant. Assert key reactivation/rematerialization and a
subsequent real managed turn. Compute overage remains unchanged.

#### `LOCAL-BILL-7` — declined LLM auto-top-up

Use a declining Stripe test payment method, cross the threshold, and assert no
grant, the managed key remains blocked, a user-key turn still works, and retries
cannot create an unbounded charge storm.

Compute provider effects remain in the cloud world.

## Managed-Cloud World

### Ownership and GitHub qualification controller

The supported base model is one active personal E2B sandbox per product user,
containing multiple workspaces. Organization-owned sandboxes are not part of
this wave.

GitHub App user authorization is user-scoped and ensures the logical personal
sandbox row. Provider materialization remains compute-gated. GitHub App
installation is organization-scoped and grants repository coverage; it must not
create a second sandbox. Effective repository authority is the intersection of
the user's authorization and installation coverage.

Qualification uses a dedicated GitHub bot, a qualification GitHub App installed
on a test organization, one covered private repository, and one uncovered
repository. World setup owns that persistent installation, protected rotating
refresh token, App credential, and distributed refresh lock; it does not
authorize a disposable actor or pre-create that actor's sandbox.

The production HTTP callback and private qualification controller call one
production-owned `complete_authorization_success(state, authorization)`
service. Playwright clicks the real Authorize GitHub control and captures its
real signed state. The controller verifies that state is bound to the expected
actor, refreshes the bot's real authorization under the distributed lock, and
passes it to the shared completion service. That service persists the
authorization, ensures the logical personal sandbox row, schedules real
materialization after commit, and refreshes the real installation cache.

Ordinary qualification may mock only the human GitHub approval page and
one-time authorization-code exchange. Identity and token authority, signed
state, App installation, repository authority, E2B creation, Worker and
Supervisor startup, credential delivery, clone/fetch/worktree operations, and
AnyHarness remain real. Qualification never installs or uninstalls the GitHub
App per shard.

### Cloud cases

#### `CLOUD-PROVISION-1` — authorization binds exactly one candidate sandbox

Start with paid Core actor A and no GitHub App user authorization, logical
sandbox row, or provider sandbox. Click the real product authorization control,
capture its signed state, and complete it through the qualification controller.
Assert the state is bound to actor A and that the resulting real authorization
can access the covered qualification repository.

Replay the same real authorization payload through the shared completion
service concurrently in separate transactions. Every attempt must converge
without an unhandled error. Assert exactly one active database sandbox row for
actor A and exactly one E2B sandbox whose provider metadata contains actor A's
id and that database sandbox id. This paired database/provider assertion must
detect both duplicate rows and orphaned provider sandboxes.

Compare the run's candidate template receipt—template id, build id, complete
input hash, and AnyHarness, Worker, and Supervisor versions and hashes—with the
raw E2B sandbox record and the matching receipt baked inside the sandbox. Query
E2B directly and require that same provider sandbox to be `running`; the
product's aggregate `ready` state is not sufficient evidence.

Require exactly one active `cloud_sandbox` Worker bound to actor A and the
sandbox, a recent heartbeat, and self-reported candidate Worker and AnyHarness
versions. Require Supervisor to be the running parent of Worker and AnyHarness
and to attest its candidate version. Authenticated AnyHarness `/health` must
report the candidate version and `/v1/agents` must return the expected non-empty
live catalog.

With isolated actor B, assert the product API does not reveal actor A's sandbox,
the gateway cannot proxy to it, actor A's workspace and session ids return
not-found, and the direct AnyHarness endpoint rejects missing or actor-B product
credentials. Database, E2B, process, heartbeat, and HTTP assertions each emit
independent evidence rather than trusting one aggregate readiness flag.

#### `CLOUD-FREE-COMPUTE-GATE-1` — free authorization remains compute-gated

Start with a fresh free actor. Complete GitHub App user authorization through
the same product and qualification path. Assert the actor receives only the
settled `$2` managed-LLM grant and no compute allocation. The authorization tail
may create the logical personal-sandbox row, but no provider E2B sandbox may
start. The product must show the owned compute/payment gate. After a successful
Core checkout, the same actor and logical row materialize exactly one real
sandbox.

#### `CLOUD-PROVISION-RECOVERY-1` — accepted-work recovery is duplicate-safe

Inject one failure at each important accepted-work boundary: provider creation,
Worker enrollment, runtime readiness, repository materialization, and workspace
creation. At each boundary, retry through the normal product path and assert the
system adopts or cleans partial state without creating a duplicate sandbox,
workspace, session, or prompt.

#### `CLOUD-GITHUB-CALLBACK-1` — serial real callback smoke

On the periodic provider lane, drive the real GitHub browser redirect, approval,
one-time code exchange, HTTP callback, and resulting product state end to end.
This serial smoke is not repeated in ordinary pull-request shards, which may
bypass only the interactive approval/code exchange and never signed-state or
callback-tail behavior.

#### `CLOUD-REPO-1` — real covered-repository materialization

Through the Worker credential path, materialize the covered private repository
and assert clone/fetch, expected default branch and commit, and a secret-free
remote URL. Assert the uncovered repository is rejected. No OAuth fallback or
long-lived token may appear in the repository.

#### `CLOUD-WARM-ACCESS-1` — already-ready access under five seconds

With the personal sandbox ready and repository already materialized, create a
cloud workspace and measure from the successful create-workspace response
received by the client until the first authenticated AnyHarness health/read
request for that workspace succeeds. The budget is less than five seconds.
UI-click-to-response and pending-shell render time are recorded separately and
cannot substitute for commandability.

Cold authorization-to-ready and paused wake-to-ready are separate measured
budgets and do not use the five-second warm guarantee.

#### `CLOUD-WAKE-1` — ordinary pause/wake continuity

After one real turn in a ready sandbox, record the repository commit,
workspace/session ids, a sentinel filesystem value, transcript sequence, and
Worker/AnyHarness identities. Pause the sandbox through the supported product
lifecycle and confirm E2B ground truth. Open the workspace through the normal
product path, assert exactly one wake, measure wake-request-to-commandable, and
verify every recorded state value plus monotonic transcript replay. Complete
one post-wake turn exactly once. This journey uses funded compute and therefore
tests the ordinary wake mechanism independently from exhaustion or paid
recovery.

#### `CLOUD-HOSTS-1` — Desktop and hosted Web cloud access after Web unification

Authenticate the same disposable actor independently in Desktop and hosted
Web. Against one prepared candidate sandbox, assert both hosts observe the same
repository, workspace, sessions, transcript, configuration, and server-owned
state; each can open a commandable cloud session through the product gateway;
and a message sent from one host becomes visible exactly once on the other
after stream/replay convergence.

Also assert the contract differences: hosted Web exposes no local workspace or
local worktree creation, never constructs a localhost/local-runtime request,
and uses Web callback/deep-link ingress; Desktop retains its native/local
capabilities and Desktop deep links. This journey proves host integration once.
The remaining expensive cloud cases are not duplicated per host.

#### `CLOUD-GATEWAY-1` — representative cloud managed-gateway turn

Enroll the cloud actor through the product server path, create a fresh session
with a representative harness, and complete one cheap real turn through the
public qualification LiteLLM endpoint. Assert that only the scoped virtual key
reaches the sandbox, then correlate its `token_id`, model, tokens, USD cost,
imported usage event, payer, member attribution, and visible balance. This case
proves cloud Worker/runtime gateway materialization; the local world owns the
every-harness matrix.

#### `CLOUD-APIKEY-1` — representative cloud user-key turn

Materialize a run-scoped provider key through the production cloud credential
path, create a fresh session with a representative harness, and complete one
cheap real turn. Assert the user-key route and zero LiteLLM spend. The local
world, not this case, owns every-harness repetition.

#### `CLOUD-SECRETS-1` — scoped secret materialization

Create personal, organization, and workspace environment secrets plus supported
personal/workspace text-file secrets through product surfaces. Assert exact
target paths or environment scope by hash, then update and delete them and
observe propagation. Another user and workspace cannot read them, and plaintext
is absent from transcript, events, logs, and evidence.

#### `CLOUD-INTEGRATION-1` — representative cloud integration

Connect the deterministic real integration through the product, create a fresh
cloud session, and complete one real integration-backed Product MCP call. Assert
the provider operation and product audit correlation. Per-harness repetition
belongs to `LOCAL-7`.

#### `CLOUD-PRODUCT-MCP-1` — built-in Product MCP smoke

Where the candidate claims built-in Product MCP features such as reviews or
subagents, complete one representative real read and permitted mutation using
the candidate runtime. This is separate from third-party integration proof.

#### `CLOUD-COMPUTE-METER-1` — real E2B usage accounting

Generate genuine E2B open/close provider events and assert one closed compute
segment with real duration. Reconcile billable seconds and organization payer
plus member attribution. The actor's personal compute subject remains
unchanged, and no overage is exported while included credit remains.

#### `CLOUD-COMPUTE-EXHAUST-1` — exhaustion pauses and fails closed

Arrange only a few remaining compute seconds, then use real E2B running time to
cross zero. Invoke the production accounting/reconciler synchronously if needed
to avoid a polling delay. Assert the real sandbox is paused, an active typed
compute hold exists, and create/ensure/wake/command/stale-session/second-member
entry points are blocked. If the provider is resumed directly for the drill,
the product immediately re-pauses it.

#### `CLOUD-COMPUTE-REFILL-1` — paid recovery and state preservation

Complete a real compute top-up payment through the supported product path.
Assert no grant before payment, exactly one grant after payment, hold clearance,
actual E2B wake, and recovery of repository, workspace, filesystem, and session
state. Record payment-to-gate-clear and gate-clear-to-commandable separately.

This scenario is a required product target even while the modern compute pack
path is an implementation gap.

#### `CLOUD-COMPUTE-OVERAGE-1` — bounded compute overage

Enable only compute overage, cross included compute with real E2B time, and
assert exact Stripe meter quantity/cents up to the configured per-seat cap.
After the cap, write-off and compute hold occur without overcharge. LLM
auto-top-up remains disabled and no LLM grant or charge occurs.

#### `CLOUD-COMPUTE-RENEW-1` — paid renewal recovery

Use a Stripe test clock to pay the next Core period. Assert one per-seat compute
grant, replay safety, hold clearance, real wake, and preserved state. A failed
or uncollected renewal grants nothing and leaves the applicable hold in place.

#### `CLOUD-BILLING-RECONCILE-1` — provider delivery and importer convergence

Use the signed qualification callback relay to delay and replay genuine Stripe
and E2B deliveries while restarting the candidate API, production billing
reconciler, usage importers, and one affected Worker at recorded accepted-work
boundaries. Rotate that actor's scoped LiteLLM key through the product path
while the Worker is offline, then let desired-state repair converge after
restart. Generate enough cheap LiteLLM requests to cross spend-log pages and
overlap one polling window. Assert every payment, grant, E2B interval, LiteLLM
request/cost, receipt, cursor, hold, materialization revision, and provider
export converges exactly once after recovery; held sandboxes re-pause inline;
and no provider or administrative secret enters evidence. The relay preserves
exact signed provider bytes and cannot synthesize an event.

Report independent required child cells for Stripe delivery, E2B delivery,
LiteLLM pagination/import, process-restart recovery, and scoped-key
materialization repair. They may share the prepared actor and sandbox, but one
green child cannot hide another child's skip or failure.

#### `CLOUD-BILLING-CONCURRENCY-1` — shared-pool concurrency bound

Prepare two Core organization members with distinct personal sandboxes and
scoped LiteLLM virtual keys. Run two isolated child cells: concurrent virtual
key requests against a nearly exhausted organization LLM pool while compute is
funded, then concurrent sandboxes against a nearly exhausted organization
compute pool while LLM credit is funded. Before each cell, record that ledger's
owning product contract and maximum evidenced in-flight allowance. Assert usage
never exceeds the applicable pool plus its allowance, later launches fail
before scheduling, all keys or compute gates converge, every usage event
imports once with its member attribution, and personal/organization plus
LLM/compute balances remain isolated. A missing, cross-ledger, or
runtime-invented allowance fails the relevant child cell.

### Permitted acceleration

The runner may position a small starting balance through the run-tagged
administrative fixture adjustment owned by `billingThreshold` and synchronously
invoke production accounting/reconciliation. That adjustment is fixture state,
not evidence of the product grant under test. It may directly pause or resume
E2B only to generate a genuine provider event or read provider ground truth. It
may not fabricate a usage segment, asserted plan/top-up grant, hold, gate
decision, Stripe payment, provider state, or product recovery outcome.

## Self-Host World

### Base posture and authentication

The base world deploys the exact candidate image and production bundle to a
disposable EC2 instance behind real DNS and TLS. It is a single-organization
installation. Tier 3 drives the Desktop product renderer in Chromium with
Playwright plus a separate candidate AnyHarness for the representative local
turn. Packaged Desktop and its native boundaries are Tier 4 concerns.

First-owner claim is always the server-rendered `/setup` flow. The runner reads
the one-time setup token through SSH/SSM, creates the initial email/password
user and owner organization, and asserts `/setup` is permanently closed. Here,
"password auth" is Proliferate email/password bearer authentication, not HTTP
Basic Auth.

Through the shared product host adapter, Connect Server normalizes the operator
URL, fetches `/meta`, presents host/version/capability trust, points the Desktop
renderer at the selected API base URL, and exposes the server's advertised auth
methods. The owner then signs in with the setup password. Native Tauri config
writing, keychain persistence, packaged-app relaunch, and restoration after
relaunch are proved in Tier 4.

Invitations currently use the server-rendered registration URL. The invited
user opens `/register?token=...&email=...` in a browser, creates a password,
then opens a second isolated product page pointed at the same server and logs
in. No automatic browser-to-Desktop handoff is required by the current
contract.

The base release gate requires password auth. A separate configured GitHub
OAuth case proves:

- setup still uses password;
- a verified matching GitHub email links to the existing owner rather than
  creating a duplicate;
- a new GitHub identity needs a pending invitation, consumes it, and receives
  its role; and
- an uninvited identity is denied.

New password, GitHub, and Google accounts require invitations. Only an
explicitly configured SSO JIT policy may bypass that rule.

### Self-host cases

#### `SH-INSTALL-CLAIM` — exact candidate installation and owner claim

Install by the production installer using an immutable candidate
manifest/image digest and checksum. Assert TLS, `/health`, `/meta`, advertised
candidate versions, base capabilities, first owner claim, permanent second
claim rejection, restart persistence, and truthful absence of vendor billing,
pricing, hosted Web, or optional services.

#### `SH-DESKTOP-OWNER` — Desktop-renderer connection and login

Through the shared product host adapter in an isolated Desktop-renderer page,
reject an invalid URL and a healthy non-Proliferate host, confirm that only
public metadata is fetched before trust, point the renderer at the candidate
instance, select password auth, and log in as the owner. Assert the single
organization and candidate capabilities. Tier 4 separately proves native
configuration persistence, keychain behavior, packaged-app relaunch, and
restored login.

#### `SH-BASE-TURN` — base self-host product turn

As the authenticated owner, store a run-scoped user API key through the
self-host product, create a local workspace through the Desktop renderer and
separate candidate AnyHarness, and complete one bounded turn with a
representative harness. Assert the self-host server, Desktop renderer, local
AnyHarness, workspace, session, and transcript remain
commandable without the optional LiteLLM or E2B profiles.

#### `SH-INVITEE` — invitation, registration, and isolated member page

Invite a member through the product UI, capture the qualification email or
invitation response, register through the browser page, and connect/login from
a second isolated product page. Assert the assigned role and one authenticated
member action. Wrong-email, revoked, replayed, expired, duplicate, and
uninvited registration matrices remain deterministic Tier 2 requirements and
are not repeated against EC2.

#### `SH-GITHUB-AUTH` — configured optional GitHub auth

Using fixed qualification DNS and OAuth application configuration, claim the
owner through password, sign in through GitHub as that verified owner and
assert account reuse, then accept a pending invite as a second GitHub user.
Assert an uninvited GitHub identity is denied.

#### `SH-SWITCH-ISOLATION` — server-origin isolation

Provision real servers A and B. Authenticate isolated Desktop-renderer product
state to A, then switch that product state to B through the shared host adapter.
Assert no A access token, refresh token, pending state, provider credential,
runtime identity, workspace, or session is sent to or visible on B. B begins
anonymous, can authenticate independently, and reconnecting to A restores only
origin-scoped A state under the chosen reset/reconnect contract. Tier 4 owns the
corresponding native config/keychain persistence and app-relaunch boundary.

This case is fail-closed and currently expected to expose a product bug; that
does not make it optional.

#### `SH-GATEWAY` — optional operator LiteLLM profile

Boot the documented optional gateway profile from the installation bundle.
Enroll a product actor through the self-host server, materialize a scoped
virtual key, and complete one cheap AnyHarness turn through the operator's
LiteLLM endpoint. A direct call using a master key is not product proof. The
base installation remains healthy and truthful when this profile is absent.

#### `SH-CLOUD-ADDON` — optional self-host cloud capability

Configure the instance's own GitHub App, E2B account, and immutable self-built
template. Using the generic cloud helpers, prepare one covered repository,
provision a personal sandbox/workspace, complete one representative turn, and
pause/wake with state intact. Disabling the add-on leaves the base installation
healthy and removes cloud capability truthfully.

#### `SH-CFN-WRAPPER` — shallow infrastructure wrapper proof

When CloudFormation is a supported install entry point, verify candidate input
digests, stack outputs, DNS/TLS, and `/meta` version. Do not repeat the owner,
invite, and Desktop authentication journey already proved above.

Self-hosted Web, when supported, is the instance's same-origin Web application.
It reuses product assertions but has no server picker, config rewrite, relaunch,
or cross-server switch. Hosted Proliferate Web is never pointed arbitrarily at
a self-hosted API.

## Sharding And Reuse

- Local route/harness cells use a distinct actor and gateway key when they run
  in parallel. Configuration cells may reuse the already-qualified harness
  process where state ordering is explicit.
- Managed cloud reuses one candidate sandbox and prepared repository per
  non-destructive shard. Billing/exhaustion cases get separate actors and
  sandboxes so holds and balances cannot contaminate other cases.
- Self-host auth journeys reuse one candidate instance. Cross-server isolation
  alone provisions two. Tier 4 uses a separate N-1 instance.
- Candidate binaries, E2B template, server image, Desktop artifact, and
  LiteLLM deployment identity are built once per content hash and verified
  before reuse across worlds.

The same runner and world code execute locally and in GitHub Actions. Workflow
YAML supplies credentials and selects shards; it does not contain a second
implementation of setup or assertions.

## Known Initial Red Gaps

These are implementation work, not unresolved test design and not permitted
skips:

- the release E2B lane is not yet consistently bound to the immutable candidate
  template;
- the current provisioning collector proves mainly aggregate readiness and
  `/v1/agents`; provider-side exact-one evidence, full baked receipt comparison,
  Worker/Supervisor attestation, concurrent completion, free-user compute
  gating, actor isolation, and accepted-work recovery are not yet collected;
- staging E2B webhook signature validation has rejected real callbacks, which
  prevents genuine compute metering evidence;
- cloud wake currently ensures product state without reliably resuming the real
  E2B sandbox;
- the intended Worker GitHub lease target is not fully implemented; the current
  materializer can write a token directly;
- the cloud lane does not yet drive representative user-key, managed-gateway,
  and integration turns through the complete Worker/runtime path;
- the existing `T3-CHAT-1` collector carries a hand-maintained harness allowlist
  rather than deriving the resolved matrix from the candidate catalog and live
  probe;
- self-host Desktop-renderer connection and login are not yet driven by the
  existing Playwright lane; native config, keychain, and relaunch proof belongs
  to Tier 4;
- Desktop auth/runtime state is not yet safely partitioned by server origin;
- the self-host provisioner can select a rolling `stable` artifact rather than
  the exact candidate digest;
- invitation-gated GitHub self-host login is not fully enforced;
- a modern compute top-up pack and its paid wake path are not complete;
- existing release workflows contain non-blocking/expected-failure behavior
  that must be removed from the qualification aggregate;
- current billing constants implement the previous `$5` free-credit and
  twenty-hour compute posture rather than the settled `$2` and `$5 + $15`
  policy;
- hosted Web is not booted by the current shared Playwright world and has no
  real managed-cloud host cell;
- the current runner can swallow per-harness non-green results and still mark
  the parent scenario green instead of emitting explicit matrix-cell results.

Implementation proceeds world foundation first, then independent scenario
shards, then bug fixing against the same cases. A case becomes blocking only
after its collector, evidence, and candidate binding are audited, but a missing
case never counts as a passed release guarantee.
