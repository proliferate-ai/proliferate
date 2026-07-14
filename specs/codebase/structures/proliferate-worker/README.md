# Proliferate Worker Standards

Status: authoritative for `anyharness/crates/proliferate-worker/**`.

For the consolidated worker + supervisor narrative — purpose, the 20k-foot
model, and core workflows — read [architecture.md](architecture.md) first. This
file is the structural authority for the worker crate; the guides go deep per
module.

## Scope

These standards apply to the target-side Proliferate Worker binary:

- `anyharness/crates/proliferate-worker/**`

Proliferate Worker is the target-side bridge between Proliferate Cloud and the
local AnyHarness runtime. It runs inside the sandbox, enrolls once, then runs
two long-polls plus a heartbeat: it leases nothing and holds no slot — it just
pumps intent down and truth up.

Identity is **collapsed and ephemeral**: one runtime = one sandbox = one Target
(1:1). A sandbox death is a fresh Target, not a re-enrollment, so there are
**no slots, no `slot_generation`, and no fencing** anywhere in the worker.

The worker is not Cloud, not AnyHarness, and not supervisor.

```text
Cloud ──► Worker ──► AnyHarness     control (down): commands + reconcile
AnyHarness ──► Worker ──► Cloud     tail (up): events
Worker ──► Supervisor               lifecycle: desired-update mailbox
```

## Goal

The worker is organized into distinct folders for process composition, the
control poll (commands + config reconcile), the event tail, lifecycle
(heartbeat + self-update), inventory, target-local materialization effects, raw
clients, local durability, and identity.

The explicit goals are:

- make the two poll directions obvious from the path: `control/` is down,
  `tail/` is up
- keep loops boring and keep workflow semantics in the owning module
- separate raw HTTP access (`cloud_client/`, `anyharness_client/`) from
  worker-owned command, reconcile, and event logic
- keep target-local filesystem/Git/auth effects (`materialization/`) out of the
  clients and the control logic
- make restart recovery visible — applied-revisions, the up-cursor, and
  save-before-send results are explicit, not incidental

A file path should tell a developer whether the code is control-down,
tail-up, lifecycle, materialization effect, client access, store durability,
identity, or inventory before they open the file.

## Target Shape

Existing code that violates this shape is a migration exception, not precedent.
Do not create empty folders; add a file or folder when it has real
responsibility to own.

```text
src/
  main.rs
  runtime.rs

  identity/
    mod.rs
    enrollment.rs
    credentials.rs
    fingerprint.rs

  control/                 # DOWN — the single control long-poll
    mod.rs
    loop.rs                # holds the poll and routes news; does not execute
    commands/              # discrete acts
      mod.rs
      executor.rs
      mapping.rs
      handlers/            # only kinds with real local work
    reconcile/             # desired-state convergence
      mod.rs
      manager.rs           # generic: applied/desired/backoff per domain
      handlers/            # per-domain apply: fetch bundle → apply → verify

  tail/                    # UP — event tailer + backfill (a dumb pump)
    mod.rs
    loop.rs
    cursors.rs
    mapping.rs
    backfill.rs

  lifecycle/               # heartbeat + self-update (request, never apply)
    mod.rs
    heartbeat.rs
    self_update.rs
    supervisor_mailbox.rs

  inventory/               # capability introspection, reported once at startup
    mod.rs
    platform.rs
    versions.rs
    capabilities.rs
    providers.rs
    mcp.rs

  materialization/         # target-local effects, called by control/commands/handlers
    mod.rs
    paths.rs
    files.rs
    env.rs
    git.rs
    git_identity.rs
    repo_checkout.rs
    runtime_config.rs
    agent_auth.rs
    manifest.rs

  cloud_client/            # transport TO cloud, one file per endpoint
    mod.rs                 # module root/facade, not the only client file
    control.rs
    commands.rs
    heartbeat.rs
    events.rs
    ...

  anyharness_client/       # the local runtime substrate
    mod.rs

  store/                   # local SQLite — the only durable worker state
    mod.rs
    connection.rs
    migrations.rs
    identity.rs
    applied_revisions.rs
    up_cursor.rs
    exposure_cache.rs
    pending_command_results.rs

  config.rs
  error.rs
  logging.rs
  observability.rs
  process_lock.rs
  versions.rs
```

## What Goes Where

Use the lowest layer that can own the logic cleanly.

| Area | Path | Owns | Must Not Own | Canon |
| --- | --- | --- | --- | --- |
| Process entry | `src/main.rs` | Arg/config parse, logging bootstrap, call into `runtime::run`. | Worker workflows or subsystem policy. | This doc, [guides/runtime.md](guides/runtime.md) |
| Runtime | `src/runtime.rs` | The internal loop supervisor: enroll, build shared context, spawn `control` + `tail`, run the heartbeat main loop, coordinate shutdown. | Command kinds, reconcile domains, event cursors, heartbeat payload semantics, materialization. | [guides/runtime.md](guides/runtime.md) |
| Identity | `src/identity/**` | One-time enrollment, the durable worker token, machine fingerprint. | Slots, fencing, command/reconcile/event/heartbeat logic. | [guides/identity.md](guides/identity.md) |
| Control loop | `src/control/loop.rs` | Holding the single control long-poll and routing each response — commands to `commands/`, revision signals to `reconcile/`. | Executing commands or applying config itself. | [guides/control.md](guides/control.md) |
| Commands | `src/control/commands/**` | One-command lifecycle: map the envelope, dispatch to AnyHarness (or a per-kind handler with real local work), save-before-send the result, report. | Reconcile domains, event tailing, raw HTTP, exposure policy. | [guides/control.md](guides/control.md) |
| Reconcile | `src/control/reconcile/**` | Desired-state convergence per domain (config / agent-auth / exposures / revoked-jti): compare applied vs desired, fetch bundle, apply, read-back-verify, per-domain backoff. | Exposure policy, Cloud projection persistence, command lifecycle. | [guides/control.md](guides/control.md) |
| Event tail | `src/tail/**` | Tail AnyHarness per exposed session after the up-cursor, batch, upload, advance to the acked contiguous seq, backfill gaps. | Exposure policy, projection persistence, transcript reconstruction, AnyHarness mutation. | [guides/tail.md](guides/tail.md) |
| Lifecycle | `src/lifecycle/**` | Heartbeat liveness ping; compare desired (from the heartbeat response) vs installed versions; write the supervisor update-request mailbox. | Downloading/replacing binaries, restarting processes, rollback (supervisor owns those). | [guides/lifecycle.md](guides/lifecycle.md) |
| Inventory | `src/inventory/**` | Read-only environment introspection (os/arch, tool versions, providers, MCPs, capabilities), reported once at startup. | Mutating target state; ongoing polling. | [guides/inventory.md](guides/inventory.md) |
| Materialization | `src/materialization/**` | Target-local filesystem/Git/env/auth/runtime-config effects with centralized path safety and atomic private writes, called by command handlers. | Raw Cloud HTTP, Cloud policy, AnyHarness execution semantics, supervisor process management. | [guides/materialization.md](guides/materialization.md) |
| Cloud client | `src/cloud_client/**` | Raw worker-facing Cloud HTTP — one file per endpoint, typed request/response DTOs, auth headers, status parsing. | Product workflows, retry beyond request mechanics, store writes, filesystem effects. | [guides/clients.md](guides/clients.md) |
| AnyHarness client | `src/anyharness_client/**` | The only path to local AnyHarness: execute, push config, health-probe, pull events. | Command/reconcile policy, cursor reconciliation, exposure decisions. | [guides/clients.md](guides/clients.md) |
| Store | `src/store/**` | Worker-local SQLite: worker token, applied-revisions + backoff, the up-cursor, exposure cache, pending command results. | Cloud/AnyHarness HTTP, command/reconcile/tail workflows, product authorization. | [guides/store.md](guides/store.md) |
| Root support files | `src/config.rs`, `src/error.rs`, `src/logging.rs`, `src/observability.rs`, `src/process_lock.rs`, `src/versions.rs` | Cross-cutting support that is small, boring, and not a subsystem. | Workflows, generic utilities, hidden service layers. | [guides/root-support.md](guides/root-support.md) |

## Read Order

Always start here and with [architecture.md](architecture.md). Then read the
focused guide for the module being changed:

- [guides/runtime.md](guides/runtime.md)
- [guides/identity.md](guides/identity.md)
- [guides/control.md](guides/control.md)
- [guides/tail.md](guides/tail.md)
- [guides/lifecycle.md](guides/lifecycle.md)
- [guides/inventory.md](guides/inventory.md)
- [guides/materialization.md](guides/materialization.md)
- [guides/clients.md](guides/clients.md)
- [guides/store.md](guides/store.md)
- [guides/root-support.md](guides/root-support.md)

When behavior crosses worker boundaries, also read the primitive or system doc
that owns the external contract:

- Cloud commands: `specs/codebase/platforms/product/cloud-commands.md`
- Sandbox provisioning: `specs/codebase/platforms/product/sandbox-provisioning.md`
- Workspace lifecycle: `specs/codebase/platforms/product/workspace-lifecycle.md`
- Agent auth: `specs/codebase/platforms/product/agent-auth.md`
- MCPs and skills: `specs/codebase/platforms/product/mcp-runtime.md` and
  `specs/codebase/platforms/product/mcp-skills.md`
- Server control plane: `specs/codebase/structures/server/README.md`
- AnyHarness runtime: `specs/codebase/structures/anyharness/README.md`

## Ownership Boundaries

Cloud owns:

- org, team, user, and actor authorization
- target registry and enrollment token issuance
- command queue admission and terminal command state
- desired config/exposure/revoked-jti revisions (the source of truth the worker
  reconciles toward)
- Cloud workspace and session projection records
- billing, audit, and compute policy

AnyHarness owns:

- target-local workspace records and session execution
- prompt/config/cancel/close semantics
- session event ordering and transcript truth
- agent subprocesses, MCP launch, provider launch, and local runtime behavior

Supervisor owns:

- process lifecycle, binary installation and replacement, restart, rollback
- applying the worker's update request

Supervisor structure rules live in
`specs/codebase/structures/proliferate-supervisor/README.md`.

Worker owns:

- one-time enrollment and the durable worker token
- the control poll: command delivery to AnyHarness or a local handler, plus
  per-domain config reconcile (incl. revoked-jti)
- target-local materialization effects
- the event tail: AnyHarness events up to the Cloud projection
- heartbeat liveness and writing the supervisor update-request mailbox when
  desired versions differ from installed
- local bridge durability: worker token, applied-revisions, up-cursor,
  exposure cache, pending command results

## Dependency Direction

Preferred direction:

```text
runtime -> identity / control / tail / lifecycle / inventory / store / clients

control/loop          -> control/commands / control/reconcile
control/commands      -> anyharness_client / materialization / store
control/reconcile     -> cloud_client / anyharness_client / store
tail                  -> anyharness_client / cloud_client / store
lifecycle             -> cloud_client / store / supervisor mailbox (a file)
inventory             -> root support files
materialization       -> root support files (no clients, no store)
cloud_client          -> root support files only
anyharness_client     -> root support files only
store                 -> root support files only
identity              -> cloud_client (enroll) and store (save/load) through narrow helpers
```

When a dependency feels awkward, prefer moving a small DTO or pure helper to the
owning boundary over importing across layers casually.

## Hard Rules

- Identity is collapsed and ephemeral. Do not reintroduce slots,
  `slot_generation`, supersession, or any fence. A dead sandbox is a new Target.
- The control poll is the single down-channel. Commands and **all** reconcile
  signals (config, agent-auth, exposures, revoked-jti) ride it — do not add a
  separate exposures poll or revoked-jti poll.
- Use `control`, not `command_downlink`; use `tail`, not `event_uplink` or
  `sync`; reconcile lives under `control/reconcile`, not a top-level `sync`.
- `control/loop.rs` and `tail/loop.rs` stay boring: hold the poll, route, sleep,
  honor shutdown. Lifecycle logic lives in `commands/`, convergence in
  `reconcile/`.
- Worker reads/writes AnyHarness only through `anyharness_client`; it never
  touches AnyHarness SQLite directly.
- Worker must not own Cloud authorization, exposure policy, or projection
  persistence; it reconciles toward Cloud's desired revisions.
- Worker must not own supervisor install, restart, rollback, or binary
  replacement — it only writes the update-request mailbox.
- `applied` is read back from AnyHarness's real state, never an optimistic flag.
- Materialization centralizes path safety and atomic private writes; command
  handlers call into it rather than hand-rolling filesystem effects.
- Do not add `utils.rs`, `helpers.rs`, `misc.rs`, or broad service buckets.
- Preserve current behavior unless an explicit behavior change is requested;
  delete dead code when replacing an implementation.

## Review Checklist

- Can I tell from the path whether this is control-down, tail-up, lifecycle,
  materialization effect, client access, store durability, identity, or
  inventory?
- Are `control/loop.rs` and `tail/loop.rs` still boring?
- Did one-command lifecycle land in `commands/executor.rs`, not the loop?
- Did the command need a per-kind handler, or could it use the generic
  map → dispatch → report path?
- Is `reconcile/manager.rs` still domain-agnostic, with apply logic in
  `reconcile/handlers/<domain>.rs`?
- Is `applied` read back from real AnyHarness state, with per-domain backoff and
  a terminal `failed` state both visible?
- Did a client start making product decisions?
- Did materialization start calling Cloud directly?
- Did store become a workflow/service layer?
- Did the worker start owning Cloud auth/exposure policy, AnyHarness execution
  truth, or supervisor update application?
- Did anyone reintroduce a slot, fence, or second/third poll?
- Do logs include the relevant correlation fields for the flow: `command_id`,
  `target_id`, `worker_id`, `cloud_workspace_id`, `anyharness_workspace_id`,
  `session_id`, `session_projection_id`, `exposure_id`, and — for reconcile —
  `domain`, `applied_revision`, `desired_revision`?
