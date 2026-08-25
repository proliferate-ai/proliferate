# Sandbox Lifecycle

Status: target. This document describes the accepted destination for the
cloud sandbox container. The body is written in the ideal state. Every
difference from `main` today is listed in [Current gaps](#current-gaps); the
list shrinks as follow-up PRs land, and the label comes off when it is empty.

## Purpose

The sandbox lifecycle platform owns the container: the E2B microVM a user's
cloud work runs in, the Proliferate processes inside it, the states the
container moves through, the single engine that provisions it, and the
telemetry that says whether it is healthy. Any question of the form "why did
this sandbox wake, pause, or die" is answered here.

Fences, one owner per concern:

- What is *inside* the container on the user's behalf (repo clones,
  worktrees, git identity, the disk they consume) belongs to
  [content.md](content.md). The boundary law: lifecycle owns
  the box, content owns what the user put in it. Runtime binaries and
  rendered state files are machinery, not content, and stay here.
- How bytes reach a running sandbox (the AnyHarness proxy, streaming rules)
  belongs to [gateway.md](gateway.md). This document owns
  only the lifecycle consequence: traffic wakes a paused sandbox.
- Whether a caller may have a sandbox at all, and the choreography callers
  use to reach one, belong to [access.md](access.md).
- This document owns billing's *primitives* — the fenced operations a
  billing system interacts with: when usage segments open and close, and
  the fencing that keeps every open/close exact under races (see
  [Usage fencing](#usage-fencing-the-billing-primitives)). Billing *math* —
  what those segments cost, credits, holds, invoices — belongs to
  [specs/FEATURE_DOCS/BILLING.md](../BILLING.md), which consumes the primitives and never
  reimplements them.
- Worker and Supervisor internals (binary swap mechanics, mailbox
  protocol, rollback) belong to
  [proliferate-worker](../../worker.md) and
  [proliferate-supervisor](../../supervisor.md);
  this document owns when those processes exist and what convergence the
  sandbox is guaranteed.
- GitHub credentials inside the sandbox belong to
  [github-auth.md](github-auth.md).

## How E2B works

E2B serves resumable microVMs created from template snapshots (see the
[sandbox lifecycle](https://e2b.dev/docs/sandbox) and
[persistence](https://e2b.dev/docs/sandbox/persistence) docs). The facts
this platform is built on:

- A sandbox has an inactivity timeout. We create every sandbox with
  `lifecycle: {"on_timeout": "pause", "auto_resume": True}` and a 2700
  second (45 minute) timeout
  ([e2b.py](../../../server/proliferate/integrations/sandbox/e2b.py),
  [constants](../../../server/proliferate/constants/sandbox/e2b.py)), so
  an idle sandbox pauses; it never dies on its own.
- Pause preserves everything: filesystem, memory, running processes, loaded
  state. Resume restores the sandbox exactly as paused, in about a second.
  The provider adapter exposes this as `preserves_processes_on_resume`,
  and it is why a resumed sandbox usually needs no relaunch of anything.
- With [auto-resume](https://e2b.dev/docs/sandbox/auto-resume) enabled,
  activity wakes a paused sandbox by itself: inbound HTTP to the sandbox's
  public host and SDK operations both trigger resume. Nothing on our side
  issues a "wake" call; forwarding traffic is the wake.
- Paused sandboxes are retained indefinitely on E2B's side. There is no
  provider TTL; the only way a sandbox ceases to exist is our explicit
  kill.
- E2B exposes each sandbox port as a per-sandbox HTTPS host
  (`get_host(port)`); AnyHarness serves on port 8457 and is reachable only
  through that host.
- E2B posts lifecycle webhooks (created, resumed, paused, timeout, killed)
  that let our row converge on provider truth without polling.

## The template

A sandbox is instantiated from an
[E2B template](https://e2b.dev/docs/sandbox-template): a snapshot with our
runtime binaries baked in. The arc is build, publish, instantiate,
initialize.

### Build

[build-template.mjs](../../../scripts/build-template.mjs) calls the E2B
SDK's `Template.build` with 4 CPUs and 8192 MB memory and copies three
binaries into the image: AnyHarness at `/home/user/anyharness`, the Worker
and Supervisor under `/home/user/.proliferate/bin/`. Binaries are baked, not
downloaded at boot; a fresh sandbox needs no network egress or credentials
to have its runtime present. The build stamps the binaries with the full
commit SHA.

### Publish

CI publishes each build under an immutable `sha-<12-hex>` tag
([release-cloud-template.yml](../../../.github/workflows/release-cloud-template.yml))
on one template family. Immutable tags are like commits; the rolling tags
`:staging` and `:production` are movable pointers, like branch names.
Promotion and rollback are the same operation, re-pointing a rolling tag
at a different immutable build
([promote-cloud-template.mjs](../../../scripts/promote-cloud-template.mjs)),
allowed only after
[smoke-cloud-template.mjs](../../../scripts/smoke-cloud-template.mjs)
passes against the exact immutable ref.

**A rolling tag move affects only new sandboxes.** The pointer is read
once, at sandbox creation; a sandbox is an instantiated snapshot, so
existing running or paused sandboxes keep the image they booted from
forever, and there is no atomic replacement flow. After a bad promotion,
"which live sandboxes still carry the bad image" is answered by the
provider, not by us: E2B's sandbox listing is the authority for which
sandbox runs which template, and the rollback runbook queries it (via the
dashboard/CLI, or the adapter's listing if the check needs scripting).
The row deliberately does not duplicate the template reference — a stored
copy is one more write path whose honesty we would have to maintain, for
an enumeration the provider already owns. Operating procedure:
[e2b-template-operations.md](../../../guides/operating/e2b-template-operations.md).

### Instantiate

Server config names the template through `e2b_template_name`
([config.py](../../../server/proliferate/config.py)); hosted deploys
point it at a rolling tag. In production an unset template name hard-fails
rather than falling back (debug builds fall back to E2B's `base` image).
Creation tags the provider sandbox with `proliferate_cloud_sandbox_id` and
`proliferate_owner_user_id` metadata, which is what makes orphan reaping
attributable.

### Initialize

The template boots with binaries present but nothing running: a booted VM
is inert until the provisioning engine (below) initializes it. Every step
runs as server-issued commands over the E2B SDK's exec channel, which is
authenticated by our `E2B_API_KEY` and exists before any Proliferate
process does; the sandbox needs no credentials of its own to be
initialized. In order:

1. Stop any stale runtime processes left by a previous attempt: a scoped
   pgrep/kill against the known binary paths
   ([bootstrap.py](../../../server/proliferate/server/cloud/runtime/bootstrap.py)).
   This step exists because a resumed VM can carry an old AnyHarness still
   bound to port 8457 under an old bearer token, which made freshly minted
   tokens 401 in a real incident (self-healed since;
   [test_cloud_sandbox_reconnect_self_heal.py](../../../server/tests/integration/test_cloud_sandbox_reconnect_self_heal.py)).
2. Mint a single-use Worker enrollment token, then write two config files
   into the VM (mode 600): the Worker config
   (`~/.proliferate/worker/config.toml`: Cloud base URL, enrollment
   token, identity) and the Supervisor config
   (`~/.proliferate/supervisor/config.toml`: both child binary paths,
   AnyHarness args and health URL, restart delay, the update mailbox and
   staging directories, and the env each child receives).
3. Launch one process, detached: the Supervisor
   (`proliferate-supervisor --config ... run`, nohup'd with logs
   redirected). Everything else inside the sandbox is its child. It
   starts AnyHarness first (with `ANYHARNESS_BEARER_TOKEN`, the data key,
   and identity env: `PROLIFERATE_RUNTIME_ENV=e2b`, sandbox/org/user
   ids), then the Worker; restarts either on crash after a 5 second
   delay; and applies binary updates from the mailbox with health gates
   and rollback to the previous binary
   ([proliferate-supervisor](../../supervisor.md)).
   The server never launches or updates AnyHarness or the Worker
   directly.
4. The Worker spends its enrollment token against Cloud, receiving its
   durable identity and bearer, and starts heartbeating; heartbeats carry
   back desired binary versions, which is how updates reach a running
   sandbox (see [Health](#health)).
5. Poll AnyHarness health over its public E2B host (up to 30 attempts,
   0.5 s apart), then verify auth is actually enforced by asserting an
   unauthenticated request is rejected
   ([liveness_health.py](../../../server/proliferate/server/cloud/runtime/liveness_health.py)).
   A runtime that answers health but skips the auth check is treated as
   failed, never exposed.
6. Persist the runtime access triple onto the row: the public base URL,
   the bearer token ciphertext, and the data-key ciphertext (encrypted
   at rest, decrypted only by the sandbox gateway). The write is a
   compare-and-swap fenced by the attempt epoch and the exact provider
   binding, so a superseded attempt can never clobber a newer one; then
   the row is marked `ready`.

## Account model

One sandbox per (user, organization), and **orgs are the only billing
subject** — the same law [specs/FEATURE_DOCS/MODELS.md](../MODELS.md) settled for
inference spend. There is no personal context and no personal subject: a
solo user's work runs in their (user, default-org) sandbox, and the
default org — the org created at signup that nobody else has joined —
bills like any other org. A user working solo and inside two companies
holds three sandboxes; each bills its own org. Sandboxes are never shared
between users; the VM boundary is the user boundary, the org boundary is
the payer boundary.

The row shape this implies
([sandboxes.py](../../../server/proliferate/db/models/cloud/sandboxes.py)):

```text
cloud_sandbox
├── owner_user_id        the person; every sandbox has exactly one
├── organization_id      never null; solo work lives in the default org
├── provider_sandbox_id  current E2B binding (nullable, detachable)
├── status               creating | ready | paused | error | destroyed
└── unique (owner_user_id, organization_id) where destroyed_at is null
```

There is deliberately no stored billing subject on the row: the org *is*
the payer, so a second stored copy could only drift from it. Billing
derives the subject from `organization_id`; compute usage segments (see
[specs/FEATURE_DOCS/BILLING.md](../BILLING.md)) open and close against that org on the
lifecycle events in the causes table below. Which sandbox serves a
request is decided by the workspace's context: a workspace under an org
repo environment materializes into the (user, that org) sandbox,
anything else into the (user, default-org) one. Solo experiments cannot
leak onto a company invoice because they live in a different sandbox
billed to a different org.

## States and causes

Row status is one of `creating`, `ready`, `paused`, `error`, `destroyed`
(check-constrained on the row). Laws:

- **Only explicit delete destroys.** No timeout, error, webhook, or reaper
  pass sets `destroyed` on an attributed row; idle sandboxes pause. This
  closes the failure mode of a user's warm state vanishing because they
  went to lunch.
- **`error` is per-attempt, not terminal.** It records that the last
  materialization attempt failed (with a sanitized `last_error` receipt);
  the next materialization retries the same row.
- **Ensure never provisions.** `POST /ensure` creates or returns the row
  and applies the billing gate; it never touches E2B. Provider work
  happens only inside a materialization operation. This keeps row
  bookkeeping cheap and the ensure verb free to call from anywhere.
- **A sandbox provisions when it first becomes able to do repo work —
  not before, and not lazier.** The eager trigger is authority-chain
  completion for the (user, org) pair: the user is a member of the org,
  the org has the GitHub App installation, and the user has completed App
  user-authorization ([github-auth.md](github-auth.md)).
  Whichever event completes the chain — user-auth callback, installation
  callback, or joining an org whose other two legs already hold —
  schedules the one background bootstrap for that pair's sandbox. Before
  the chain completes there is nothing a sandbox could clone, so nothing
  provisions; after it completes, every later operation (workspace
  create, catalog sync, repo add) finds a warm-or-paused sandbox instead
  of paying a cold provision.
- **The eager bootstrap ends paused.** When the chain-completion
  bootstrap finishes — runtime launched, configured repos precloned,
  secrets and agent-auth state written — the server explicitly pauses the
  provider sandbox (the same pause verb the billing-hold path uses)
  rather than letting it idle to E2B's 45-minute timeout. Wake stays
  traffic-driven (~1 s), so the only cost of eager provisioning is the
  bootstrap minutes themselves. The pause applies only to this bootstrap;
  interactive materializations never pause behind the user.
- **The gateway gates on policy, E2B wakes on traffic, materialization
  repairs.** The sandbox gateway forwards when the caller may reach the
  sandbox (access and billing checks pass) regardless of VM liveness;
  E2B's auto-resume brings a paused VM back under the forwarded traffic;
  a VM that resumes broken (dead runtime, stale token) is repaired by the
  next materialization operation, not by the gateway.
- **Cold access is the loss backstop, and it schedules its own repair.**
  Under the chain-completion law a healthy user's sandbox always exists —
  at worst paused, which is warm ("paused" keeps its stamped access and
  wakes under traffic). A row with *no* stamped runtime access is the
  exceptional state: provider loss cleared it, or the caller is pre-chain
  and was never provisioned. An access path that finds it answers the
  typed 409 `cloud_sandbox_runtime_not_ready` (provisioning is far too
  slow to hold a request open) *and* schedules one background
  materialization for that sandbox
  ([materialization/service.py](../../../server/proliferate/server/cloud/materialization/service.py)),
  so the caller's retry is a wait, not a dead end. Two things keep it
  from stampeding: a non-blocking cross-process Redis claim keyed on the
  sandbox id (N concurrent cold callers schedule at most one run), and
  the per-sandbox materialization lock below (any run that starts is
  serialized). The repair is an ordinary materialization operation and
  inherits every gate above it — the scheduler adds no gate and bypasses
  none. Skipped for destroyed rows (gone, not cold) and for deployments
  without managed-cloud provisioning. The claim is in-process
  fire-and-forget, so a server restart during a provision strands it:
  repair stays suppressed for that sandbox until the 900 s TTL lapses —
  accepted, because the TTL self-heals and a durable queue buys nothing
  at this scale. This law is the single owner of the repair mechanism;
  [gateway.md](gateway.md) and
  [access.md](access.md) link here rather than restating
  it, and access owns what the caller sees while it runs.

Every transition has exactly one cause:

| Cause | E2B touched | Transition | Why |
| --- | --- | --- | --- |
| First ensure (GitHub App callbacks, materialization entry, explicit `POST /ensure`) | No | row created, `creating` | Row bookkeeping is free; the ensure verb never provisions |
| Authority chain completes for the (user, org) pair (user-auth ∧ installation ∧ membership) | Yes: the eager background bootstrap | `creating` → `ready` → explicit pause → `paused` | A sandbox provisions when it first becomes able to do repo work; it ends paused so eagerness costs only the bootstrap minutes |
| Materialization operation (workspace create, repo-environment materialize, workflow delivery, cold-access repair) | Yes: resume or create, then launch | `creating` → `ready` | The one engine below; the only path that spends provider resources |
| Gateway traffic to a paused sandbox | Yes: E2B auto-resume | `paused` → `ready` (via `resumed` webhook) | Forwarding is the wake; no wake verb exists |
| 45 minutes idle | Yes: E2B pauses itself | `ready` → `paused` (via `paused`/`timeout` webhook); usage segment closes | Idle compute costs money; state is preserved |
| Billing hold observed on a `created`/`resumed` webhook | Yes: server pauses the provider sandbox | → `paused`; segment closes as quota enforcement | A held subject must not accrue compute spend |
| Materialization attempt fails | Attempted | → `error` + `last_error` receipt | Per-attempt receipt; row stays retryable |
| E2B reports the sandbox killed or missing | No (it is already gone) | provider binding detached; row keeps status, next materialization creates a new VM under the same row | Provider truth is authoritative; the logical sandbox survives its VM |
| `DELETE /cloud-sandbox` | Yes: kill, after commit | → `destroyed` (terminal); worker tokens revoked | The only destruction path a user can cause |
| Orphan reaper (5 minute cron) | Yes: kill unattributed or superseded provider VMs past a 900 s grace | no row transition | Backstop for lost destroy callbacks; never touches a healthy attributed VM |

### A sandbox's first day, worked

The laws in sequence, for one user's first cloud workspace:

1. The user authorizes the GitHub App and installs it on their repos.
   The callbacks ensure the sandbox row, and whichever callback completes
   the authority chain schedules the eager background bootstrap: the
   engine creates the E2B sandbox from the rolling template tag
   (metadata: sandbox id, owner), initializes the runtime, preclones the
   configured repos, writes secrets and agent-auth state, then explicitly
   pauses the VM. Total spend: the bootstrap minutes, billed to the org.
   From this moment "no sandbox" is over — every later operation finds a
   warm-or-paused machine.
2. The user creates a workspace. This is a materialization operation, so
   the engine runs: the paused VM resumes (~1 s), the healthy runtime is
   reused, the worktree is cut from the precloned repo, the row is
   `ready`, and a usage segment opens. (Usage opens are idempotent and
   dual-sourced: the materialization engine opens at resume acceptance
   for the resumes it performs, and the provider webhooks open for
   transitions the engine never sees, like traffic wakes; whichever
   observes liveness first wins, the other is a no-op.) Without the eager
   bootstrap this step would have paid the full cold provision — VM
   create plus runtime initialize plus clone — inside the one synchronous
   request the user is watching.
3. The user works for an hour, then stops. 45 idle minutes later E2B
   pauses the VM mid-process; the `paused` webhook moves the row to
   `paused` and closes the usage segment. Nothing was torn down; the
   session is frozen in place, and the paused VM is retained indefinitely
   at no compute cost.
4. Next morning the user reopens the workspace. The client's first
   request hits the sandbox gateway, which checks policy only: the user
   may reach this sandbox, so the request is forwarded. The paused VM
   wakes under that forwarded traffic (E2B auto-resume, about a second),
   the frozen AnyHarness answers it, and the `resumed` webhook flips the
   row `ready` and reopens the usage segment (the webhook is the opener
   here because no materialization ran — the idempotent dual-source rule
   above). No Proliferate code issued a wake; forwarding was the wake.
5. Had the org's credit been exhausted overnight, step 4 stops at the
   policy check: the gateway refuses, the traffic never leaves our
   server, and the VM stays paused. If a stray `resumed` webhook arrives
   anyway, the server re-pauses the provider sandbox and closes the
   segment as quota enforcement. Access is the gate; liveness is E2B's
   problem; repair (a VM that resumed broken) is the next
   materialization's problem.

## The provisioning engine

All provider work funnels through one engine: `connect_ready_sandbox`
([connect.py](../../../server/proliferate/server/cloud/materialization/sandbox_io/connect.py)),
always invoked through
[operation.py](../../../server/proliferate/server/cloud/materialization/operation.py),
which ends the DB transaction, takes a per-sandbox distributed lock, and
reloads the row so no stale snapshot drives a lifecycle decision. The
engine answers one question: "give me this row's sandbox, live and
authenticated, whatever that takes." In order:

1. Refuse destroyed rows; re-check the billing resume gate.
2. Bump the attempt epoch (every later write is fenced by it).
3. If a provider binding exists, resume it (`Sandbox.connect`; E2B has no
   separate resume verb). If E2B says the target is authoritatively gone,
   detach the binding and fall through to create a new VM under the same
   row.
4. If no binding exists, create one from the configured template with
   attribution metadata, then connect to it.
5. Accept the resume: a state read immediately after can still find the
   provider paused (
   [resume_acceptance.py](../../../server/proliferate/server/cloud/materialization/sandbox_io/resume_acceptance.py));
   genuine liveness opens a usage segment, anything else downgrades the
   row honestly instead of reporting a false ready.
6. Health-probe the existing runtime. A resumed VM whose AnyHarness
   survived pause and still answers with enforced auth is reused as-is
   (the warm path); otherwise run the initialize sequence above.
7. Mark ready with the CAS write.

Concurrent operations on the same sandbox serialize on the lock; lock
timeout surfaces as a typed busy error rather than a second engine run.

The sandbox bootstrap composes independently: global secrets and
agent-auth state apply without any repository configuration (no GitHub
authority needed for the non-repository state), and each configured
repository preclone owns its own authority check and stays best-effort,
so one repository's failure cannot prevent the non-repository state from
converging.

## Usage fencing: the billing primitives

This platform owns the operations billing consumes — the fenced open and
close of compute usage segments — and [specs/FEATURE_DOCS/BILLING.md](../BILLING.md) owns what
they cost. The fences exist so that every segment is attributed to one
exact provider VM and no race can double-open, double-close, or reassign
one. Absorbed from the retired sandbox-provisioning document at its
implemented truth:

- **Three fence inputs, all on the row.** `materialization_attempt` is
  the attempt epoch: it advances for every engine run (including a
  healthy `ready` retry), and attempt-owned completions compare it before
  changing lifecycle or accounting state. The exact `provider_sandbox_id`
  binding is the identity fence: usage opens and closes always name the
  binding they fence against. `provider_observed_at` is the provider
  freshness floor: retry start, conservative resume request-start
  acceptance, and direct provider observations advance it — runtime-ready
  persistence does not — and any delayed provider observation at or
  before the floor is inert.
- **Legacy repair before provider I/O.** The engine closes a legacy
  null-attributed open segment under that unchanged unknown identity
  (end clamped no earlier than start) before touching the provider; a
  *non-null* conflicting provider is preserved open with a durable
  support receipt instead, because it may still be live. Duration is
  never reassigned between identities.
- **Supersession is transactional and committed first.** Only
  authoritative provider-target-not-found detaches a binding: the engine
  compare-and-swaps the expected binding to absent and closes that exact
  provider's open segment in one transaction, cloud-row-first lock order,
  and commits the supersession before creating one replacement. Transient
  and configuration failures never supersede; they fail closed and keep
  the binding for retry.
- **Create records identity and usage together.** A provider create
  persists the exact new provider id and its provision usage in one
  transaction. If that commit is ambiguous and the same attempt remains
  unbound, the failure transaction adopts the known candidate and its
  exact usage rather than losing custody of a spending VM.
- **Resume acceptance is conservative.** After every successful resume
  the engine revalidates the exact binding and attempt epoch at the
  request-start boundary; if a pause overlaps the request, a post-resume
  exact-ID state read decides between reopening usage as running and
  retaining the paused closure. Cancellation, ambiguous commits, and
  late transient observations all route through the same fenced usage
  open in the failure transaction.
- **Webhooks reinforce, never adopt.** The webhook path verifies the
  signature, correlates to an already-persisted exact binding,
  deduplicates, and idempotently reinforces or closes segments — always
  in one cloud-row-first transaction fenced by binding, epoch, and the
  freshness floor. Webhook metadata is never authority to adopt an
  uncommitted provider; the engine owns the required usage open, so
  delivery timing is advisory. Spend-hold processing runs under the same
  materialization lock and commits its receipt, lifecycle update, and
  usage close before releasing it.
- **Terminal events close exactly one segment.** A `killed` event for
  the current binding closes that provider's segment, detaches the
  binding, and records a recoverable `error`; it never destroys the row.
  Terminal events for an already-destroyed row close exact usage only.
  Delete and the orphan reaper follow the same rule: whatever else they
  tear down, the segment they close is the exact bound provider's.
- **`last_error` is a receipt, not raw text.** It is durable, bounded,
  and secret-safe — a classified operator-safe message describing the
  latest terminal attempt or authoritative provider loss; a new attempt
  clears it, and it is written only when the attempt's exact binding and
  epoch are still current.

## Pause and resume, end to end

Pause is the steady state of an idle sandbox, not an exception:

- E2B pauses the VM after 45 idle minutes. Processes freeze mid-flight and
  survive; nothing inside the sandbox observes the pause.
- The `paused`/`timeout` webhook (HMAC-verified, deduplicated, correlated
  against the exact persisted binding in
  [webhooks/service.py](../../../server/proliferate/server/cloud/webhooks/service.py))
  moves the row to `paused` and closes the open usage segment. Row truth
  converges on provider truth; we never poll.
- Waking is caused by traffic or by a materialization operation, per the
  causes table. On `resumed`, the webhook reopens a usage segment and
  marks the row `ready`, unless the subject holds a billing hold, in which
  case the server immediately re-pauses the provider sandbox and closes
  the segment as quota enforcement.
- Because processes survive pause, a live session that spans a
  pause/resume cycle continues where it stopped. The failure this design
  must handle is not lost state but stale state: the stop-stale step in
  initialization exists because a resumed VM can hold an old runtime
  process bound to the port under an old bearer token.

## Health

- AnyHarness liveness and auth enforcement are probed during
  materialization (
  [liveness_health.py](../../../server/proliferate/server/cloud/runtime/liveness_health.py)).
- The Worker heartbeats every 30 seconds; liveness is derived at read time
  as `last_seen_at` within 90 seconds
  ([constants](../../../server/proliferate/constants/cloud.py)). The
  heartbeat response carries desired binary versions and the desired
  topology, which is how a long-lived sandbox converges to the current
  release without redeploying the template.
- **A dead Worker on a running sandbox surfaces, but does not yet alert.**
  A Worker that misses its heartbeat window (or never enrolled at all) on
  a `running` sandbox surfaces as `workerDegraded: true` in the workspace
  runtime-status payload and logs a structured warning on each read
  (`_worker_degraded` in
  [workspaces/service.py](../../../server/proliferate/server/cloud/workspaces/service.py)),
  because a silently dead Worker means stale binaries and expiring git
  credentials with no user-visible symptom. A paused/creating/error/destroyed
  sandbox's Worker is not expected to be heartbeating and is never reported
  degraded. Routing that condition into the production alert path is still
  open — see gap list.
- Runtime pressure telemetry (CPU, memory, and disk) flows from AnyHarness
  health to the client pressure surfaces. Lifecycle transports the
  measurement; [content.md](content.md) owns what consumes
  the disk number.
- The E2B webhook is the passive health channel; the orphan reaper
  ([orphan_sandboxes.py](../../../server/proliferate/server/cloud/worker/orphan_sandboxes.py))
  is the active one, listing provider sandboxes every 5 minutes and
  destroying only exact-attributed orphans past the grace window.

## API surface

`/v1/cloud/cloud-sandbox` owns exactly the container relationship:

- `GET /cloud-sandbox`: the row (status, timestamps, last error receipt).
- `POST /cloud-sandbox/ensure`: create or return the row, billing-gated.
  Never touches E2B. There is no wake verb; waking is traffic.
- `DELETE /cloud-sandbox`: revoke the active Worker's tokens and its
  integration-gateway token, mark destroyed, kill the provider sandbox
  after commit (reaper as backstop). Delete never touches
  `cloud_workspace` rows; workspaces bound to the dead VM render as lost
  ([content.md](content.md)) — deletion plus recreation
  is not a lossless repair and is never presented as one.

Workspace-scoped runtime status (`GET /workspaces/{id}/runtime-status`)
projects the sandbox status plus Worker liveness for one workspace; its
shape belongs to [access.md](access.md).

## Code map

```text
scripts/
├── build-template.mjs                       template build: Template.build, binaries baked in
├── promote-cloud-template.mjs               move a rolling tag onto a verified immutable tag
└── smoke-cloud-template.mjs                 throwaway-sandbox smoke against an exact ref
.github/workflows/
├── release-cloud-template.yml               immutable sha-tag build lane, moves :staging
└── promote-cloud-template.yml               smoke an immutable tag, move :production
server/proliferate/
├── constants/sandbox/e2b.py                 timeout (2700 s), runtime port (8457), binary path
├── integrations/sandbox/e2b.py              provider adapter: create/connect/pause/kill, host resolution
├── db/models/cloud/sandboxes.py             the row: status constraint, owner uniqueness, version overrides
├── db/store/cloud_sandboxes.py              fenced transitions (ensure, retry, observe, destroy)
└── server/cloud/
    ├── cloud_sandboxes/                     ensure/destroy API + service
    ├── materialization/
    │   ├── operation.py                     per-sandbox lock around every engine run
    │   └── sandbox_io/
    │       ├── connect.py                   the provisioning engine
    │       ├── resume_acceptance.py         post-resume pause reconciliation
    │       └── runtime_launch.py            Supervisor-owned runtime launch (only
    │                                        topology; also mints the Worker
    │                                        enrollment token)
    ├── runtime/bootstrap.py                 env, launcher, and Supervisor config builders
    ├── runtime/liveness_health.py           health + auth-enforcement probes
    ├── webhooks/                            E2B lifecycle event ingestion (HMAC, dedupe, correlate)
    └── worker/orphan_sandboxes.py           attributed-orphan reaper
```

## Failure modes

- Materialization attempt fails: row `error` with a sanitized receipt; the
  next materialization retries. First response:
  [cloud-provisioning-failure.md](../../../guides/operating/cloud-provisioning-failure.md).
- Provider target authoritatively gone: binding detached, next attempt
  creates a new VM under the same row; user state inside the old VM is
  lost, the logical sandbox is not.
- Resume accepted but provider found paused immediately after: row
  downgraded to `paused`, usage closed; the operation reports a typed
  command error instead of a false ready.
- Stale runtime after resume (old process, old token): stopped and
  relaunched by the initialize sequence; fresh token persisted even when
  the URL is unchanged.
- Billing hold: gateway refuses (policy gate), and any `created`/`resumed`
  webhook while held re-pauses the provider sandbox.
- Webhook signature invalid or event uncorrelated with the persisted
  binding: ignored; row truth never moves on unauthenticated or
  misattributed events.
- Concurrent materializations: serialized on the per-sandbox lock; lock
  timeout is a typed busy error.
- Destroy callback lost (process died between commit and provider kill):
  the reaper destroys the attributed orphan after the grace window.

## Proof

- Recovery and invariant suites:
  [test_cloud_sandbox_recovery.py](../../../server/tests/integration/test_cloud_sandbox_recovery.py),
  [test_cloud_sandbox_recovery_invariants.py](../../../server/tests/integration/test_cloud_sandbox_recovery_invariants.py),
  [test_cloud_sandbox_reconnect_self_heal.py](../../../server/tests/integration/test_cloud_sandbox_reconnect_self_heal.py),
  [test_cloud_sandbox_orphan_reaper_lock.py](../../../server/tests/integration/test_cloud_sandbox_orphan_reaper_lock.py).
- Usage fencing and connection state machine (absorbed with the fencing
  section):
  [test_sandbox_materialization.py](../../../server/tests/unit/test_sandbox_materialization.py),
  [test_cloud_connect_race.py](../../../server/tests/unit/test_cloud_connect_race.py),
  [test_cloud_materialization_failures.py](../../../server/tests/unit/test_cloud_materialization_failures.py),
  [test_cloud_webhook_service.py](../../../server/tests/unit/test_cloud_webhook_service.py),
  [test_cloud_webhook_recovery_races.py](../../../server/tests/unit/test_cloud_webhook_recovery_races.py),
  [test_cloud_orphan_reaper.py](../../../server/tests/unit/test_cloud_orphan_reaper.py),
  [test_cloud_sandbox_reaper_task.py](../../../server/tests/unit/test_cloud_sandbox_reaper_task.py),
  [test_cloud_sandbox_reconciler_recovery.py](../../../server/tests/integration/test_cloud_sandbox_reconciler_recovery.py),
  [test_cloud_sandbox_last_error_migration.py](../../../server/tests/integration/test_cloud_sandbox_last_error_migration.py),
  [test_cloud_sandbox_ensure_billing_gate.py](../../../server/tests/integration/test_cloud_sandbox_ensure_billing_gate.py).
  Deterministic contracts only; live E2B qualification stays separate
  operational evidence.
- Cold-access repair scheduling and its stampede guard:
  [test_cloud_sandbox_cold_access_repair.py](../../../server/tests/integration/test_cloud_sandbox_cold_access_repair.py);
  the claim primitive itself in
  [test_redis_lock.py](../../../server/tests/unit/test_redis_lock.py).
- Template smoke:
  [smoke-cloud-template.mjs](../../../scripts/smoke-cloud-template.mjs)
  (binaries present, Supervisor can start AnyHarness, sandbox killed on
  exit); run by the release and promote lanes and by the rollback runbook.
- Managed runtime update proof: T4-RUNTIME-1 (heartbeat-driven update on a
  live sandbox) in the release suite.
- Live E2B N-1 to N update proof (2026-07-26): real sandbox, supervisor-owned
  topology, pins 0.3.47->0.3.48, zero rollbacks, sha256 of active binaries
  matched published CDN artifacts, ~75s convergence. This gated the
  Supervisor-owned topology default, which is now on.
- D5 BRIDGE proof (2026-07-26, sandbox `iwwvadhffzxoora56f437`): a running
  legacy (pre-Supervisor) sandbox migrated onto the Supervisor-owned topology
  in place, in ~2.5s, via the `desiredTopology` heartbeat signal — no
  destroy/recreate. This, together with the update proof above, gated
  deleting the legacy launch path entirely: every (re)launch is now
  unconditionally Supervisor-owned. `supervisor_owned_runtime`
  ([config.py](../../../server/proliferate/config.py)) survives only to
  gate that same `desiredTopology` heartbeat signal for any already-running
  legacy worker still bridging — see its docstring for the asymmetry.

Corridor E — provisioning triggers and the org account model. Named,
binary assertions; the corridor is done when they are green. IDs are
stable — tests reference them by name:

- **E1** A user-auth callback with no installation schedules *no*
  bootstrap; the event that completes the authority chain schedules
  exactly one. (github_app service pytest)
- **E2** The chain-completion bootstrap ends with the provider sandbox
  explicitly paused; interactive materializations never force-pause.
  (materialization pytest)
- **E3** After the migration every active row carries a non-null
  `organization_id`, uniqueness is (owner, org), solo flows land in the
  default org, and re-running the migration is a no-op.
  (migration pytest + intent test)
- **E4** Billing derives the payer from the row's org; grep-gate:
  `billing_subject_id` is gone from the sandbox model and store.
  (pytest + grep gate)
- **E5** Joining an org whose installation and user-auth legs already
  hold bootstraps that (user, org) sandbox. (server pytest; lands with
  E3)
- **E6** [test_cloud_sandbox_cold_access_repair.py](../../../server/tests/integration/test_cloud_sandbox_cold_access_repair.py)
  survives unchanged — cold repair stays the loss backstop. Grep-gates:
  no `POST /wake` route, no legacy (non-Supervisor) launch path.

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] Worker death still has no alert path: the Worker is now a
      Supervisor-owned child with automatic restart-with-backoff
      (`restart_delay_seconds`), so the old "sidecar launch failures are
      swallowed" framing is gone along with the deleted sidecar launcher.
      What remains open is alerting — a `running` sandbox's stale or
      missing Worker surfaces as `workerDegraded: true` on the workspace
      runtime-status payload and logs a structured warning on each read
      (PR #1526), but nothing routes that condition into the production
      alert path, and the warm-reuse path still never relaunches a dead
      Worker.
- [ ] The account model is one sandbox per user globally (partial unique
      index on `owner_user_id`; org variants are stubs that raise, and
      the store hardcodes `organization_id=None`,
      [cloud_sandboxes.py](../../../server/proliferate/db/store/cloud_sandboxes.py)).
      Ruled shape: `organization_id` NOT NULL keyed (owner, org), solo
      work in the default org, no stored billing subject. Migration:
      backfill `organization_id` to each owner's default org, re-key the
      uniqueness to (owner_user_id, organization_id), drop the
      billing-subject column, and derive the payer from the org.
      Ruling: orgs are the only billing subject
      ([specs/FEATURE_DOCS/MODELS.md](../MODELS.md)); a stored payer copy can
      only drift.
- [ ] Provisioning does not fire on authority-chain completion: the
      user-auth callback alone schedules the bootstrap even when no
      installation exists
      ([github_app/service.py](../../../server/proliferate/server/cloud/github_app/service.py)),
      the installation callback never bootstraps the sandbox, and org
      membership changes trigger nothing. Gate the bootstrap on the
      complete chain (membership ∧ installation ∧ user-auth) in both
      App callbacks; the org-join trigger lands with the per-(user, org)
      account model above. Ruling: a sandbox provisions when it first
      becomes able to do repo work.
- [ ] The eager bootstrap does not force-pause on completion: a
      chain-completion bootstrap leaves the VM idling to E2B's 45-minute
      timeout, spending ~45 idle minutes per provision. Pause the
      provider sandbox explicitly when the bootstrap finishes (the
      billing-hold path's pause verb). Ruling: eagerness should cost the
      bootstrap minutes, not the timeout window.
- [ ] `runtime_generation` is a hardcoded constant stamped by the store
      (`runtime_generation=0`,
      [cloud_sandboxes.py](../../../server/proliferate/db/store/cloud_sandboxes.py))
      after its column was dropped; [gateway.md](gateway.md)
      owns the deletion end to end (wire field, client cache keys) and
      cross-lists it here for the store constant.
