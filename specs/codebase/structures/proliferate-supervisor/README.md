# Proliferate Supervisor Structure

Status: target standard for `proliferate-supervisor` code.

## Scope

These standards apply to the target-side Supervisor binary:

- `anyharness/crates/proliferate-supervisor/**`

This document defines Supervisor source structure and ownership rules. It does
not own server-side managed-cloud bootstrap, SSH installer behavior, Worker
command delivery, or AnyHarness runtime internals. Read the owning docs for
those areas when changing those boundaries:

- `specs/codebase/structures/server/README.md` for managed-cloud bootstrap code under
  `server/**`
- `install/README.md` for SSH target installer behavior
- `specs/codebase/structures/proliferate-worker/README.md` for target Worker behavior
- `specs/codebase/structures/anyharness/README.md` for AnyHarness runtime behavior

## Goal

Supervisor exists to make a Proliferate target boring to operate. Once a target
has the runtime bundle, one local process should own the lifecycle of the two
long-lived child processes:

```text
proliferate-supervisor
  starts and restarts:
    anyharness
    proliferate-worker
```

The explicit goals are:

- make target process lifecycle predictable
- keep Worker focused on Cloud transport and command delivery
- keep AnyHarness focused on runtime execution
- keep Cloud and installers responsible for provisioning/configuration, not
  child-process supervision
- keep update staging local, narrow, verifiable, and separate from rollout
  policy

Supervisor is not Cloud, not Worker, and not AnyHarness.

## Implementation Status (this PR)

The update-mailbox consumer this PR adds is implemented and unit-tested. The
shared `proliferate-runtime-update-protocol` dependency, the `SupervisorConfig`
mailbox/health/download fields, the `SupervisorError` variants, the mailbox
consumer (`update/request.rs`), the bounded artifact download (`update/download.rs`),
the activation state machine (`update/activate.rs`), `RollbackPlan::apply`
(restore `.prev` over the active path), and the real `/health`-polling gate in
`process/health.rs` are all in place. `process/mod.rs` drains the mailbox
(`activate::run_pending` via the `LiveHost` adapter) once children are up, and
`cargo build -p proliferate-supervisor` succeeds. The only deferred piece is the
live E2B N-1→N proof, tracked with the rest of Tier 4. Everything below
describes running code.

## Target Shape

```text
src/
  main.rs
  config.rs
  error.rs
  logging.rs
  observability.rs

  process/
    mod.rs
    child.rs
    health.rs
    restart.rs

  install/
    mod.rs
    layout.rs
    service.rs

  update/
    mod.rs
    request.rs
    manifest.rs
    download.rs
    staging.rs
    activate.rs
    rollback.rs
```

Do not create empty folders. Introduce a file or folder only when it has real
responsibility to own.

## What Goes Where

Use the lowest layer that can own the logic cleanly.

| Area | Path | Owns | Must Not Own |
| --- | --- | --- | --- |
| CLI entry | `src/main.rs` | CLI parsing, command dispatch, top-level error capture, and invoking the owning module. | Process lifecycle logic, update artifact mechanics, config schema policy, Cloud or AnyHarness semantics. |
| Config | `src/config.rs` | `SupervisorConfig`, TOML load/parse, default config path, and default restart/argument values. | Server bootstrap config generation, installer env validation, runtime execution policy. |
| Process lifecycle | `src/process/**` | Starting AnyHarness, starting Worker, restart timing, child process kill/wait behavior, and upgrade-window hooks. | Cloud command semantics, AnyHarness session/workspace behavior, binary download/swap, target enrollment. |
| Child spawning | `src/process/child.rs` | Focused child process spawn wrapper and env injection. | Restart loops or command-specific process behavior. |
| Restart policy | `src/process/restart.rs` | Boring restart delay/backoff helpers. | Product policy or target availability decisions. |
| Process health hooks | `src/process/health.rs` | Bounded polling of AnyHarness `/health` (matching the candidate version when known) and Worker liveness after a restart — the real activation health gate. | Cloud target state, update admission policy, artifact mechanics. |
| Install helpers | `src/install/**` | Supervisor-owned install layout helpers and systemd unit rendering. | Full SSH installer flow, binary download, enrollment token handling, Cloud API calls. |
| Mailbox consumer | `src/update/request.rs` | Consuming the shared `proliferate-runtime-update-protocol` crate: scanning the mailbox for the next pending request, deduping against an already-written result, and recording results/invalid outcomes. | Defining the wire shapes (owned by the shared protocol crate), download, staging, or activation mechanics. |
| Update manifest | `src/update/manifest.rs` | Manifest parsing, supported component validation, artifact lookup, size checks, and checksum verification. | Rollout policy, desired-version reconciliation, binary replacement. |
| Update download | `src/update/download.rs` | Bounded `reqwest` GET of only the `artifact_url` named in a verified request, into the private staging dir, with timeout and max-size guards. | Following redirects beyond the single named URL, Cloud API calls, checksum policy (that stays a re-verify step against the manifest). |
| Update staging | `src/update/staging.rs` | Verified artifact staging, private permissions, atomic write/rename, and parent directory sync. | Downloading artifacts, applying swaps, restarting children after swaps. |
| Update activation | `src/update/activate.rs` | The activation state machine: verify → download → re-verify → stage → atomic activate → dependency-ordered restart → health-gate → result or rollback. Drains one mailbox request per supervise cycle. | Cloud command semantics, AnyHarness/Worker product behavior, desired-version policy (the request already encodes that). |
| Rollback | `src/update/rollback.rs` | Rollback plan data shape **and** its real `apply()` — restoring `.prev` over the active path when a health gate fails. | Production rollout orchestration or Worker/Cloud status policy. |
| Logging | `src/logging.rs` | Tracing/Sentry initialization and target-safe event scrubbing. | Product analytics, Cloud status, command correlation policy outside Supervisor logs. |
| Observability | `src/observability.rs` | Small semantic log helpers for Supervisor-owned events. | Broad telemetry pipelines or target inventory reporting. |
| Errors | `src/error.rs` | `SupervisorError` variants for Supervisor-owned failures. | Worker, Cloud, AnyHarness, or installer error domains. |

## Core Workflow

The main `run` workflow lives in `src/process/mod.rs`.

```text
load SupervisorConfig

loop:
  spawn AnyHarness with configured args/env

  loop:
    spawn Worker with:
      --config <worker_config>
      PROLIFERATE_SUPERVISOR_VERSION=<supervisor version>

    drain the update mailbox (update::activate::run_pending):
      for each next pending request with no result yet:
        verify manifest -> download -> re-verify -> stage
          -> activate atomically -> restart the changed component(s)
             in dependency order (AnyHarness before Worker)
          -> health-gate; on failure, roll back to `.prev`, restart, re-gate
        write exactly one result (activated | rolled_back | invalid)

    if AnyHarness exits:
      kill Worker
      wait for Worker
      restart both

    if Worker exits:
      wait restart delay
      restart Worker

  wait restart delay
```

The mailbox drain runs once per supervise cycle, after children are up and
before/around the restart select, so an update in flight cannot race an
unrelated child-exit restart. This is the core Supervisor primitive. Keep it
legible.


## Operational Notes

- A persistent TLS-trust failure fetching an update artifact (e.g. an expired or
  wrong certificate at the CDN) is classified as a transient `DownloadTransport`
  error, so the mailbox request is retried indefinitely rather than latching a
  terminal `Invalid` (consistent with R9-002's "network blips retry" intent).
  Operationally this means a genuinely broken artifact host shows up as a
  never-converging update, not a failed one — watch heartbeat staleness /
  desired-vs-observed divergence rather than expecting a terminal result. A
  bounded-retry cap is a possible future refinement.

## Boundary Model

```text
Server / SSH installer
  writes worker config
  writes supervisor config
  launches supervisor

Supervisor
  starts/restarts AnyHarness and Worker
  injects configured env into children
  consumes the update mailbox: verifies, fetches (bounded reqwest),
    re-verifies, stages, atomically activates, restarts in dependency
    order, health-gates, and rolls back an unhealthy activation
  never self-updates (image-bound)

Worker
  enrolls target with Cloud
  heartbeats component versions/status
  leases Cloud commands
  writes narrow desired-update mailbox requests

AnyHarness
  owns target-local runtime execution:
  workspaces, sessions, transcripts, agents, MCP, files, git, terminals
```

Supervisor should know paths, binaries, env, child exits, restart delay, and
update artifacts. It should not know product workflows.

## Hard Rules

- `main.rs` stays a thin CLI and command dispatcher.
- `process/**` owns child lifecycle only. It must not call Cloud APIs,
  AnyHarness HTTP APIs, or Worker internals.
- Supervisor starts Worker; Worker talks to Cloud. Do not add a Cloud client
  to Supervisor.
- Supervisor starts AnyHarness; AnyHarness owns runtime semantics. Do not add
  session, workspace, agent, MCP, file, git, or terminal behavior to
  Supervisor.
- Supervisor may fetch (bounded `reqwest`, only the URL named in a verified
  request), stage, activate, health-gate, and roll back update artifacts. It
  must not own desired version policy, update admission, billing, target
  selection, or Cloud status policy — the request already encodes what to do.
- Update artifact identifiers must remain path-safe. Components stay limited
  to `anyharness` and `worker` (the shared protocol crate's `UpdateComponent`
  enum has no `supervisor` variant — the Supervisor is image-bound and never
  self-updates; a request naming it cannot be represented, not merely
  rejected).
- Staged update files and update directories must use private permissions.
- Child processes must be killed/waited in the same lifecycle boundary that
  spawned them.
- Environment passed to children must be explicit and config-driven. Do not
  silently inherit new credential or product env.
- Keep module names concrete. Do not add `utils.rs`, `helpers.rs`, or
  `misc.rs`.

## Dependency Direction

Preferred direction:

```text
main -> config / process / install / update / logging / observability

process -> config / error
process -> process/child
process -> process/restart
process -> process/health

install -> config / install/layout
update -> error
update/request -> proliferate-runtime-update-protocol (shared wire crate)
update/download -> reqwest (bounded fetch only)
update/activate -> update/{request,manifest,download,staging,rollback} / process/health
observability -> update/staging
logging -> no product modules
```

`proliferate-runtime-update-protocol` is an explicit, allowed workspace
dependency: a tiny serde-only crate that defines the mailbox wire shapes and
their atomic file IO. Both Supervisor and Worker depend on it; it depends on
neither, so taking it on does not pull in Worker internals and is not the
forbidden direction below. `reqwest` is likewise an explicit, declared
dependency (added for this change) scoped to `update/download.rs` only —
Supervisor's one and only outbound HTTP client, bounded to the single
`artifact_url` named in an already-verified request.

Forbidden direction:

```text
Supervisor -> server/**
Supervisor -> proliferate-worker internals (the shared protocol crate is not this)
Supervisor -> anyharness-lib runtime internals
Supervisor -> cloud SDK/client code
```

If a dependency feels awkward, keep the boundary narrow by passing paths,
args, env, or manifest data in through config or CLI arguments.

## Change Discipline

- Preserve the simple process model unless the task explicitly changes target
  lifecycle behavior.
- When changing runtime bundle layout, check server bootstrap, SSH installer,
  release/template scripts, and smoke tests together.
- When changing config schema, update both managed-cloud config generation and
  SSH installer config generation.
- When changing update staging or manifest validation, add focused Rust tests
  for path safety, checksum/size rejection, and permission behavior.
- When splitting files, split by responsibility first and preserve behavior.
- Keep Supervisor docs focused on Supervisor. Link to Worker, Server,
  Installer, and AnyHarness docs instead of copying their rules here.

## Review Checklist

- Can I tell from the path whether this is CLI, config, child lifecycle,
  install rendering, update verification/staging, logging, or errors?
- Did process lifecycle stay independent from Cloud command semantics?
- Did Supervisor avoid AnyHarness runtime behavior?
- Did Supervisor avoid Worker command/event/status logic?
- Are child env vars explicit and intentional?
- Are update artifact identifiers and staged paths path-safe?
- Are staged update permissions private?
- Did config schema changes update every config writer?
- Did runtime bundle changes check SSH, managed cloud, release, and smoke
  paths together?
