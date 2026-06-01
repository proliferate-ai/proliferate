# Worker Command Downlink

Status: authoritative for
`anyharness/crates/proliferate-worker/src/command_downlink/**`.

`command_downlink/` owns the Cloud command delivery path.

```text
Cloud command queue
  -> Worker lease
  -> command processor
  -> target-local handler or AnyHarness dispatch
  -> Cloud delivery/result report
```

## Target Shape

```text
command_downlink/
  mod.rs
  loop.rs
  lease_state.rs
  catalog.rs
  processor.rs
  mapping.rs
  anyharness_dispatch.rs
  reporting.rs
  idempotency.rs
  stale_slot.rs
  handlers/
    git_identity.rs
    repo_checkout.rs
    environment.rs
    agent_auth.rs
    runtime_config.rs
    pruning.rs
    backfill.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Facade exposing `run_loop` and types needed by runtime/tests. | Command processing logic. |
| `loop.rs` | Boring lease loop: flush pending results, build lease state, lease from Cloud, pass command to processor, sleep/backoff, honor shutdown. | Command-specific behavior. |
| `lease_state.rs` | Per-pass local capability snapshot. | Command catalog policy or Cloud HTTP mechanics. |
| `catalog.rs` | Canonical command names, categories, and requirements. | Cloud client code. |
| `processor.rs` | One-command lifecycle and deliverability pipeline. | Family-specific target effects. |
| `mapping.rs` | Pure Cloud command envelope to internal `AnyHarnessCommand` conversion. | HTTP, SQLite, Cloud reporting, target effects. |
| `anyharness_dispatch.rs` | Internal `AnyHarnessCommand` to local AnyHarness HTTP call. | Command lifecycle policy. |
| `reporting.rs` | Delivery/result reports, result shaping, pending-result save-before-send, retry, and cleanup. | Handler-specific target effects. |
| `idempotency.rs` | Duplicate lease, crash recovery, and safe retry rules. | Generic result upload mechanics. |
| `stale_slot.rs` | Worker-side stale sandbox/profile/slot checks and logging. | Cloud-side source-of-truth enforcement. |
| `handlers/**` | Command-family behavior that needs Worker-owned target effects or cross-boundary orchestration. | Generic AnyHarness command mapping. |

## Command Lifecycle

```text
lease request
  -> Cloud marks command leased
  -> Worker receives command envelope
  -> processor validates/classifies command
  -> Worker reports delivery when local delivery begins
  -> custom handler or generic AnyHarness dispatch runs
  -> Worker shapes accepted/rejected/failed result
  -> Worker reports result to Cloud
```

Terms:

- `lease`: Cloud reserves a command row for this worker.
- `delivery`: Worker says it received the lease and started local delivery.
- `result`: immediate local delivery outcome: accepted,
  accepted-but-queued, rejected, or failed delivery.
- `events`: runtime truth after acceptance. Agent progress and completion flow
  through `event_uplink`, not command results.

## Supported Kinds

The lease loop tells Cloud which command kinds this worker can safely lease
right now. This is Worker capability policy, not Cloud authorization policy.

`lease_state.rs` builds the current state:

- AnyHarness configured
- AnyHarness healthy
- materialization root configured
- supervisor update mailbox available
- slot identity present/current
- worker version known
- AnyHarness version known
- provider/tooling readiness when supported by inventory

`catalog.rs` maps that state to command support.

Canonical command kinds:

- `start_session`
- `configure_git_identity`
- `ensure_repo_checkout`
- `materialize_workspace`
- `prune_workspace_worktree`
- `materialize_environment`
- `refresh_agent_auth_config`
- `send_prompt`
- `resolve_interaction`
- `update_session_config`
- `cancel_turn`
- `close_session`
- `backfill_exposed_workspace`

Requirement categories:

- materialization-only
- requires AnyHarness
- requires healthy AnyHarness
- requires materialization root
- requires supervisor mailbox
- requires current slot

## Processor

`processor.rs` is the canonical place to understand one-command
deliverability.

It owns this pipeline:

```text
leased Cloud command
  -> validate lease and slot context
  -> classify command kind
  -> enforce requirements from catalog
  -> call custom handler if needed
  -> otherwise map to AnyHarnessCommand
  -> report delivery when appropriate
  -> dispatch to AnyHarness when appropriate
  -> classify handler or AnyHarness response
  -> save pending result before Cloud upload
  -> report terminal result to Cloud
  -> clear pending result after successful upload
```

Do not bury this pipeline in `loop.rs` or in a command-family handler.

## Generic AnyHarness Path

Commands that are only:

```text
Cloud payload -> AnyHarness request -> Cloud result
```

use:

```text
mapping.rs -> anyharness_dispatch.rs -> reporting.rs
```

Examples:

- `send_prompt`
- `resolve_interaction`
- `update_session_config`
- `cancel_turn`
- `close_session`

Add a custom handler only when the command has Worker-owned target effects,
special Cloud status reporting, cross-boundary orchestration, or
command-family logic that does not belong in the generic path.

## Handlers

- `handlers/git_identity.rs`: `configure_git_identity`. Fetch Cloud material
  and write target-local Git credential/config.
- `handlers/repo_checkout.rs`: `ensure_repo_checkout`. Clone, fetch, and
  verify repo checkout on the target.
- `handlers/environment.rs`: `materialize_environment`. Fetch target config
  plan, write env/files/config, and coordinate runtime config apply.
- `handlers/agent_auth.rs`: `refresh_agent_auth_config`. Fetch agent auth
  materialization plan, materialize synced auth files/gateway config, call
  AnyHarness apply endpoint, and report agent auth status.
- `handlers/runtime_config.rs`: runtime config apply orchestration when
  environment/agent-auth flows need a dedicated split.
- `handlers/pruning.rs`: `prune_workspace_worktree`. Call AnyHarness
  retire/cleanup APIs and report Cloud materialization state.
- `handlers/backfill.rs`: `backfill_exposed_workspace`. Command entrypoint
  that delegates actual backfill mechanics to `event_uplink/backfill.rs`.

Avoid `handlers/materialization.rs`; it collides with `target/materialization`
and hides which command family is being handled.

## Hard Rules

- The loop stays boring.
- Supported-kind policy lives in `catalog.rs`, not in the Cloud client.
- Mapping stays pure.
- AnyHarness HTTP dispatch lives in `anyharness_dispatch.rs`.
- Result retry lives in `reporting.rs`.
- Idempotency and stale-slot behavior stay explicit.
- Command downlink does not own event tailing, Cloud exposure policy, or
  supervisor update application.
