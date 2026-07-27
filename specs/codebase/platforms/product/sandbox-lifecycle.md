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
  [sandbox-content.md](sandbox-content.md). The boundary law: lifecycle owns
  the box, content owns what the user put in it. Runtime binaries and
  rendered state files are machinery, not content, and stay here.
- How bytes reach a running sandbox (the AnyHarness proxy, streaming rules)
  belongs to [sandbox-gateway.md](sandbox-gateway.md). This document owns
  only the lifecycle consequence: traffic wakes a paused sandbox.
- Whether a caller may have a sandbox at all, and the choreography callers
  use to reach one, belong to [sandbox-access.md](sandbox-access.md).
- Compute billing math (usage segments, holds, credit) belongs to
  [billing.md](billing.md); this document only names the lifecycle events
  that open and close usage segments.
- Worker and Supervisor internals (binary swap mechanics, mailbox
  protocol, rollback) belong to
  [proliferate-worker](../../structures/proliferate-worker/README.md) and
  [proliferate-supervisor](../../structures/proliferate-supervisor/README.md);
  this document owns when those processes exist and what convergence the
  sandbox is guaranteed.
- GitHub credentials inside the sandbox belong to
  [sandbox-github-auth.md](sandbox-github-auth.md).

## How E2B works

E2B serves resumable microVMs created from template snapshots (see the
[sandbox lifecycle](https://e2b.dev/docs/sandbox) and
[persistence](https://e2b.dev/docs/sandbox/persistence) docs). The facts
this platform is built on:

- A sandbox has an inactivity timeout. We create every sandbox with
  `lifecycle: {"on_timeout": "pause", "auto_resume": True}` and a 2700
  second (45 minute) timeout
  ([e2b.py](../../../../server/proliferate/integrations/sandbox/e2b.py),
  [constants](../../../../server/proliferate/constants/sandbox/e2b.py)), so
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

[build-template.mjs](../../../../scripts/build-template.mjs) calls the E2B
SDK's `Template.build` with 4 CPUs and 8192 MB memory and copies three
binaries into the image: AnyHarness at `/home/user/anyharness`, the Worker
and Supervisor under `/home/user/.proliferate/bin/`. Binaries are baked, not
downloaded at boot; a fresh sandbox needs no network egress or credentials
to have its runtime present. The build stamps the binaries with the full
commit SHA.

### Publish

CI publishes each build under an immutable `sha-<12-hex>` tag
([release-cloud-template.yml](../../../../.github/workflows/release-cloud-template.yml),
[_deploy-e2b.yml](../../../../.github/workflows/_deploy-e2b.yml)) on one
template family. Immutable tags are like commits; the rolling tags
`:staging` and `:production` are movable pointers, like branch names.
Promotion and rollback are the same operation, re-pointing a rolling tag
at a different immutable build
([promote-cloud-template.mjs](../../../../scripts/promote-cloud-template.mjs)),
allowed only after
[smoke-cloud-template.mjs](../../../../scripts/smoke-cloud-template.mjs)
passes against the exact immutable ref.

**A rolling tag move affects only new sandboxes.** The pointer is read
once, at sandbox creation; a sandbox is an instantiated snapshot, so
existing running or paused sandboxes keep the image they booted from
forever, and there is no atomic replacement flow. This is why every
sandbox row records the exact immutable tag it was created from: after a
bad promotion, "which live sandboxes still carry the bad image" must be
enumerable. Operating procedure:
[e2b-template-operations.md](../../../developing/operating/e2b-template-operations.md).

### Instantiate

Server config names the template through `e2b_template_name`
([config.py](../../../../server/proliferate/config.py)); hosted deploys
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
   ([bootstrap.py](../../../../server/proliferate/server/cloud/runtime/bootstrap.py)).
   This step exists because a resumed VM can carry an old AnyHarness still
   bound to port 8457 under an old bearer token, which made freshly minted
   tokens 401 in a real incident (self-healed since;
   [test_cloud_sandbox_reconnect_self_heal.py](../../../../server/tests/integration/test_cloud_sandbox_reconnect_self_heal.py)).
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
   ([proliferate-supervisor](../../structures/proliferate-supervisor/README.md)).
   The server never launches or updates AnyHarness or the Worker
   directly.
4. The Worker spends its enrollment token against Cloud, receiving its
   durable identity and bearer, and starts heartbeating; heartbeats carry
   back desired binary versions, which is how updates reach a running
   sandbox (see [Health](#health)).
5. Poll AnyHarness health over its public E2B host (up to 30 attempts,
   0.5 s apart), then verify auth is actually enforced by asserting an
   unauthenticated request is rejected
   ([liveness_health.py](../../../../server/proliferate/server/cloud/runtime/liveness_health.py)).
   A runtime that answers health but skips the auth check is treated as
   failed, never exposed.
6. Persist the runtime access triple onto the row: the public base URL,
   the bearer token ciphertext, and the data-key ciphertext (encrypted
   at rest, decrypted only by the sandbox gateway). The write is a
   compare-and-swap fenced by the attempt epoch and the exact provider
   binding, so a superseded attempt can never clobber a newer one; then
   the row is marked `ready`.

## Account model

One sandbox per billing context. A user's personal work runs in their
personal sandbox, billed to their personal subject; work inside an
organization runs in a per-(user, organization) sandbox, billed to the org
subject. Sandboxes are never shared between users; the VM boundary is the
user boundary.

The row shape this implies
([sandboxes.py](../../../../server/proliferate/db/models/cloud/sandboxes.py)):

```text
cloud_sandbox
├── owner_user_id        the person; every sandbox has exactly one
├── organization_id      null = personal context; set = that org's context
├── billing_subject_id   resolved once, at row creation, from the context
├── provider_sandbox_id  current E2B binding (nullable, detachable)
├── template_ref         exact immutable sha- tag the VM booted from
├── status               creating | ready | paused | error | destroyed
└── unique (owner_user_id, organization_id) where destroyed_at is null
```

Which sandbox serves a request is decided by the workspace's context: a
workspace under an org repo environment materializes into the (user, that
org) sandbox, anything else into the personal one. Billing never resolves
per request; the row's `billing_subject_id` is fixed at creation, so an org
member's personal experiments cannot leak onto the org invoice and org
work cannot land on a personal card. Compute usage segments (see
[billing.md](billing.md)) open and close against that subject on the
lifecycle events in the causes table below.

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
  bookkeeping cheap and makes provider spend attributable to a real need.
- **The gateway gates on policy, E2B wakes on traffic, materialization
  repairs.** The sandbox gateway forwards when the caller may reach the
  sandbox (access and billing checks pass) regardless of VM liveness;
  E2B's auto-resume brings a paused VM back under the forwarded traffic;
  a VM that resumes broken (dead runtime, stale token) is repaired by the
  next materialization operation, not by the gateway.

Every transition has exactly one cause:

| Cause | E2B touched | Transition | Why |
| --- | --- | --- | --- |
| First ensure (signup hook, GitHub App callback, explicit `POST /ensure`) | No | row created, `creating` | Row bookkeeping is free; provider spend waits for real work |
| Materialization operation (workspace create, repo-environment materialize, workflow delivery, sandbox bootstrap) | Yes: resume or create, then launch | `creating` → `ready` | The one engine below; the only path that spends provider resources |
| Gateway traffic to a paused sandbox | Yes: E2B auto-resume | `paused` → `ready` (via `resumed` webhook) | Forwarding is the wake; no wake verb exists |
| 45 minutes idle | Yes: E2B pauses itself | `ready` → `paused` (via `paused`/`timeout` webhook); usage segment closes | Idle compute costs money; state is preserved |
| Billing hold observed on a `created`/`resumed` webhook | Yes: server pauses the provider sandbox | → `paused`; segment closes as quota enforcement | A held subject must not accrue compute spend |
| Materialization attempt fails | Attempted | → `error` + `last_error` receipt | Per-attempt receipt; row stays retryable |
| E2B reports the sandbox killed or missing | No (it is already gone) | provider binding detached; row keeps status, next materialization creates a new VM under the same row | Provider truth is authoritative; the logical sandbox survives its VM |
| `DELETE /cloud-sandbox` | Yes: kill, after commit | → `destroyed` (terminal); worker tokens revoked | The only destruction path a user can cause |
| Orphan reaper (5 minute cron) | Yes: kill unattributed or superseded provider VMs past a 900 s grace | no row transition | Backstop for lost destroy callbacks; never touches a healthy attributed VM |

### A sandbox's first day, worked

The laws in sequence, for one user's first cloud workspace:

1. The user connects the GitHub App. The callback ensures the sandbox row
   (`creating`, no provider binding) and schedules a background bootstrap.
   No E2B call has happened; if the user walks away now, nothing was
   spent. This is the ensure-never-provisions law: rows are free,
   provider VMs are not, so the row exists as soon as we know the user
   and the VM waits for real work.
2. The user creates a workspace. This is a materialization operation, so
   the engine runs: no binding exists, so it creates the E2B sandbox from
   the rolling template tag (metadata: sandbox id, owner), connects,
   initializes the runtime, marks the row `ready`, and opens a usage
   segment. (Usage opens are idempotent and dual-sourced: the
   materialization engine opens at resume acceptance for the resumes it
   performs, and the provider webhooks open for transitions the engine
   never sees, like traffic wakes; whichever observes liveness first
   wins, the other is a no-op.) The HTTP response waits for all of it;
   creation is the one deliberately slow, synchronous path.
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
5. Had the user's credit been exhausted overnight, step 4 stops at the
   policy check: the gateway refuses, the traffic never leaves our
   server, and the VM stays paused. If a stray `resumed` webhook arrives
   anyway, the server re-pauses the provider sandbox and closes the
   segment as quota enforcement. Access is the gate; liveness is E2B's
   problem; repair (a VM that resumed broken) is the next
   materialization's problem.

## The provisioning engine

All provider work funnels through one engine: `connect_ready_sandbox`
([connect.py](../../../../server/proliferate/server/cloud/materialization/sandbox_io/connect.py)),
always invoked through
[operation.py](../../../../server/proliferate/server/cloud/materialization/operation.py),
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
   [resume_acceptance.py](../../../../server/proliferate/server/cloud/materialization/sandbox_io/resume_acceptance.py));
   genuine liveness opens a usage segment, anything else downgrades the
   row honestly instead of reporting a false ready.
6. Health-probe the existing runtime. A resumed VM whose AnyHarness
   survived pause and still answers with enforced auth is reused as-is
   (the warm path); otherwise run the initialize sequence above.
7. Mark ready with the CAS write.

Concurrent operations on the same sandbox serialize on the lock; lock
timeout surfaces as a typed busy error rather than a second engine run.

## Pause and resume, end to end

Pause is the steady state of an idle sandbox, not an exception:

- E2B pauses the VM after 45 idle minutes. Processes freeze mid-flight and
  survive; nothing inside the sandbox observes the pause.
- The `paused`/`timeout` webhook (HMAC-verified, deduplicated, correlated
  against the exact persisted binding in
  [webhooks/service.py](../../../../server/proliferate/server/cloud/webhooks/service.py))
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
  [liveness_health.py](../../../../server/proliferate/server/cloud/runtime/liveness_health.py)).
- The Worker heartbeats every 30 seconds; liveness is derived at read time
  as `last_seen_at` within 90 seconds
  ([constants](../../../../server/proliferate/constants/cloud.py)). The
  heartbeat response carries desired binary versions and the desired
  topology, which is how a long-lived sandbox converges to the current
  release without redeploying the template.
- **A dead Worker on a running sandbox surfaces, but does not yet alert.**
  A Worker that misses its heartbeat window (or never enrolled at all) on
  a `running` sandbox surfaces as `workerDegraded: true` in the workspace
  runtime-status payload and logs a structured warning on each read
  (`_worker_degraded` in
  [workspaces/service.py](../../../../server/proliferate/server/cloud/workspaces/service.py)),
  because a silently dead Worker means stale binaries and expiring git
  credentials with no user-visible symptom. A paused/creating/error/destroyed
  sandbox's Worker is not expected to be heartbeating and is never reported
  degraded. Routing that condition into the production alert path (issue
  tracker) is still open — see gap list.
- Runtime pressure telemetry (CPU, memory, and disk) flows from AnyHarness
  health to the client pressure surfaces. Lifecycle transports the
  measurement; [sandbox-content.md](sandbox-content.md) owns what consumes
  the disk number.
- The E2B webhook is the passive health channel; the orphan reaper
  ([orphan_sandboxes.py](../../../../server/proliferate/server/cloud/worker/orphan_sandboxes.py))
  is the active one, listing provider sandboxes every 5 minutes and
  destroying only exact-attributed orphans past the grace window.

## API surface

`/v1/cloud/cloud-sandbox` owns exactly the container relationship:

- `GET /cloud-sandbox`: the row (status, timestamps, last error receipt).
- `POST /cloud-sandbox/ensure`: create or return the row, billing-gated.
  Never touches E2B. There is no wake verb; waking is traffic.
- `DELETE /cloud-sandbox`: revoke worker tokens, mark destroyed, kill the
  provider sandbox after commit (reaper as backstop).

Workspace-scoped runtime status (`GET /workspaces/{id}/runtime-status`)
projects the sandbox status plus Worker liveness for one workspace; its
shape belongs to [sandbox-access.md](sandbox-access.md).

## Code map

```text
scripts/
├── build-template.mjs                       template build: Template.build, binaries baked in
├── promote-cloud-template.mjs               move a rolling tag onto a verified immutable tag
└── smoke-cloud-template.mjs                 throwaway-sandbox smoke against an exact ref
.github/workflows/
├── release-cloud-template.yml               immutable sha-tag build lane
└── _deploy-e2b.yml                          reusable build/promote lane
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
    │       ├── runtime_launch.py            Supervisor-owned runtime launch
    │       └── worker_sidecar.py            Worker enrollment token mint + config
    ├── runtime/bootstrap.py                 env, launcher, and Supervisor config builders
    ├── runtime/liveness_health.py           health + auth-enforcement probes
    ├── webhooks/                            E2B lifecycle event ingestion (HMAC, dedupe, correlate)
    └── worker/orphan_sandboxes.py           attributed-orphan reaper
```

## Failure modes

- Materialization attempt fails: row `error` with a sanitized receipt; the
  next materialization retries. First response:
  [cloud-provisioning-failure.md](../../../developing/operating/cloud-provisioning-failure.md).
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
  [test_cloud_sandbox_recovery.py](../../../../server/tests/integration/test_cloud_sandbox_recovery.py),
  [test_cloud_sandbox_recovery_invariants.py](../../../../server/tests/integration/test_cloud_sandbox_recovery_invariants.py),
  [test_cloud_sandbox_reconnect_self_heal.py](../../../../server/tests/integration/test_cloud_sandbox_reconnect_self_heal.py),
  [test_cloud_sandbox_orphan_reaper_lock.py](../../../../server/tests/integration/test_cloud_sandbox_orphan_reaper_lock.py).
- Template smoke:
  [smoke-cloud-template.mjs](../../../../scripts/smoke-cloud-template.mjs)
  (binaries present, Supervisor can start AnyHarness, sandbox killed on
  exit); run by the release and promote lanes and by the rollback runbook.
- Managed runtime update proof: T4-RUNTIME-1 (heartbeat-driven update on a
  live sandbox) in the release suite.
- Live E2B N-1 to N update proof (2026-07-26): real sandbox, supervisor-owned
  topology, pins 0.3.47->0.3.48, zero rollbacks, sha256 of active binaries
  matched published CDN artifacts, ~75s convergence. This gates the
  Supervisor-owned topology default (below), which is now on.

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] Cold access is a dead end at the gateway: the 409
      `cloud_sandbox_runtime_not_ready` fires whenever the row's runtime
      access was never stamped or was cleared by provider loss
      ([cloud_sandboxes/service.py](../../../../server/proliferate/server/cloud/cloud_sandboxes/service.py)),
      and nothing on the access path starts the materialization that
      would repair it — the client can only retry into the same 409.
      Paused sandboxes are already fine (their stored address stays
      valid, so forwarded traffic wakes them); the fix waits on the
      cold-start choreography ruling (wake-and-poll vs
      provision-on-access), still open.
- [ ] `supervisor_owned_runtime` now defaults on
      ([config.py](../../../../server/proliferate/config.py)): the live E2B
      N-1 to N proof passed (2026-07-26), so newly (re)launched cloud
      sandboxes boot Proliferate Supervisor first by default. The legacy
      launch path (direct detached AnyHarness plus a best-effort Worker
      sidecar,
      [runtime_launch.py](../../../../server/proliferate/server/cloud/materialization/sandbox_io/runtime_launch.py))
      still exists behind the flag (env var opt-out) for rollback; its
      deletion is the named follow-up.
- [ ] Worker death still has no alert path: a `running` sandbox's stale or
      missing Worker now surfaces as `workerDegraded: true` on the
      workspace runtime-status payload
      (`_worker_degraded` in
      [workspaces/service.py](../../../../server/proliferate/server/cloud/workspaces/service.py))
      and logs a structured warning on each read, but nothing routes that
      condition into the production alert path (issue tracker), sidecar
      launch failures are still swallowed at boot, and the warm-reuse path
      still never relaunches a dead Worker.
- [ ] The account model is one sandbox per user globally (partial unique
      index on `owner_user_id`; org variants are stubs that raise,
      [cloud_sandboxes.py](../../../../server/proliferate/db/store/cloud_sandboxes.py)).
      Ideal is one per (user, org context) so org-billed work is isolated
      from personal work; today an org member's single sandbox mixes both
      and bills to whichever subject resolution picks.
- [ ] The row does not record the real template ref: `e2b_template_ref` is
      hardcoded to the provider kind `"e2b"`
      ([cloud_sandboxes/service.py](../../../../server/proliferate/server/cloud/cloud_sandboxes/service.py)),
      so "which live sandboxes still run the bad template" is not
      enumerable and rollback recovery of existing sandboxes stays manual.
      Persist the exact immutable tag at create time.
- [ ] `_runtime_status` in
      [workspaces/service.py](../../../../server/proliferate/server/cloud/workspaces/service.py)
      maps sandbox statuses `provisioning` and `stopped` that the enum and
      check constraint do not allow; the runtime-status shape belongs to
      [sandbox-access.md](sandbox-access.md), which cross-lists this
      dead-branch deletion on its fix PR.
