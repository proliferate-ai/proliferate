# Proliferate Supervisor Structure

Status: target standard for `proliferate-supervisor` code.

## Scope

These standards apply to the target-side Supervisor binary:

- `anyharness/crates/proliferate-supervisor/**`

This document defines Supervisor source structure and ownership rules. It does
not own server-side managed-cloud bootstrap, SSH installer behavior, Worker
command delivery, or AnyHarness runtime internals. Read the owning docs for
those areas when changing those boundaries:

- `docs/structures/server/README.md` for managed-cloud bootstrap code under
  `server/**`
- `install/README.md` for SSH target installer behavior
- `docs/structures/proliferate-worker/README.md` for target Worker behavior
- `docs/structures/anyharness/README.md` for AnyHarness runtime behavior

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
    manifest.rs
    staging.rs
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
| Process health hooks | `src/process/health.rs` | Narrow process-lifecycle health gates such as upgrade-window checks. | AnyHarness `/health` interpretation, Worker heartbeat status, Cloud target state. |
| Install helpers | `src/install/**` | Supervisor-owned install layout helpers and systemd unit rendering. | Full SSH installer flow, binary download, enrollment token handling, Cloud API calls. |
| Update manifest | `src/update/manifest.rs` | Manifest parsing, supported component validation, artifact lookup, size checks, and checksum verification. | Rollout policy, desired-version reconciliation, binary replacement. |
| Update staging | `src/update/staging.rs` | Verified artifact staging, private permissions, atomic write/rename, and parent directory sync. | Downloading artifacts, applying swaps, restarting children after swaps. |
| Rollback data | `src/update/rollback.rs` | Rollback plan data shapes when needed by update mechanics. | Production rollout orchestration or Worker/Cloud status policy. |
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

    if AnyHarness exits:
      kill Worker
      wait for Worker
      restart both

    if Worker exits:
      wait restart delay
      restart Worker

  wait restart delay
```

This is the core Supervisor primitive. Keep it legible.

## Boundary Model

```text
Server / SSH installer
  writes worker config
  writes supervisor config
  launches supervisor

Supervisor
  starts/restarts AnyHarness and Worker
  injects configured env into children
  verifies/stages update artifacts

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
- Supervisor may stage and verify update artifacts. It must not own desired
  version policy, update admission, billing, target selection, or Cloud status
  policy.
- Update artifact identifiers must remain path-safe. Components stay limited
  to `anyharness`, `worker`, and `supervisor`.
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
observability -> update/staging
logging -> no product modules
```

Forbidden direction:

```text
Supervisor -> server/**
Supervisor -> proliferate-worker internals
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
