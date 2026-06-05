# Worker Control Loop

Status: authoritative for
`anyharness/crates/proliferate-worker/src/control/**`.

`control/` owns the single down-channel: one long-poll that delivers both
**discrete acts** (commands) and **desired steady-state** (reconcile signals).
Folding reconcile (config / agent-auth / exposures / revoked-jti) into this poll
is what makes the worker **two polls, not three**.

```text
Cloud control long-poll
  ── response ──►  command        → commands/   (execute on AnyHarness)
                   revision signal → reconcile/  (converge applied → desired)
```

## Target Shape

```text
control/
  mod.rs
  loop.rs
  commands/
    mod.rs
    executor.rs
    mapping.rs
    handlers/
      git_identity.rs
      repo_checkout.rs
      environment.rs
      agent_auth.rs
      pruning.rs
      backfill.rs
  reconcile/
    mod.rs
    manager.rs
    handlers/
      runtime_config.rs
      agent_auth.rs
      exposures.rs
      revoked_jti.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Facade exposing `run_loop` and types needed by runtime/tests. | Command or reconcile logic. |
| `loop.rs` | Hold the long-poll; on each response, route commands to `commands/` and revision signals to `reconcile/`; re-arm; honor shutdown. | Command lifecycle, reconcile convergence, HTTP wire details. |
| `commands/executor.rs` | One-command lifecycle and deliverability pipeline. | Reconcile, event tailing, raw HTTP. |
| `commands/mapping.rs` | Pure Cloud command envelope → internal `AnyHarnessCommand`. | HTTP, SQLite, reporting, target effects. |
| `commands/handlers/**` | Per-kind behavior for commands with real local work or special reporting. | The generic pass-through path. |
| `reconcile/manager.rs` | Generic engine: track applied/desired/backoff per domain, decide what's due. | Per-domain apply logic; domain-specific bundle shapes. |
| `reconcile/handlers/**` | Per-domain apply: fetch bundle → push to AnyHarness/local → read-back-verify. | The scheduling/backoff policy (that is the manager's job). |

## The Loop Stays Boring

`loop.rs` holds the control long-poll and **routes**; it does not execute.

```text
hold the control long-poll
  → on response:
      for each command         → commands::executor (background; does not block re-arm)
      for each revision signal → reconcile::manager.note_desired(domain, revision)
  → advance control_cursor
  → re-arm the poll (or back off on transport error)
```

The poll is a parked coroutine on the Cloud side, woken by a Redis doorbell or a
per-domain revision delta. The doorbell is a **lossy wakeup**; the durable truth
is the desired-state revision in Postgres, so a missed signal costs nothing —
the next poll re-derives `applied < desired` and converges.

`control_cursor` is "highest desired I've been told" — it suppresses
re-notification and is distinct from `applied` ("highest I've actually
installed"). They can differ (told 7, applied 6 after a failed apply).

## Commands (discrete acts)

`commands/executor.rs` is the canonical place to understand one-command
deliverability. Do not bury this pipeline in `loop.rs` or in a handler.

```text
command envelope
  → classify kind
  → preflight: required revisions applied? (fail-fast with a typed error if a
    depended-on domain is stuck)
  → custom handler if the kind has real local work
    otherwise map → dispatch to AnyHarness
  → report delivery when local delivery begins
  → save the pending result before Cloud upload
  → report the terminal result to Cloud
  → clear the pending result after a successful upload
```

Correctness model: **at-least-once + idempotent + per-session ordered.** A
command is a consumable row; if a message is lost, Cloud redelivers and the
worker's idempotency makes the retry safe. Runtime truth after acceptance
(agent progress, completion) flows through `tail/`, not command results.

### Generic vs custom path

Commands that are only `Cloud payload → AnyHarness request → Cloud result` use
the generic `mapping.rs → anyharness_client → report` path. Examples:
`send_prompt`, `resolve_interaction`, `update_session_config`, `cancel_turn`,
`close_session`.

Add a `handlers/<kind>.rs` only when the command has worker-owned local effects,
special Cloud status reporting, or cross-boundary orchestration:

- `git_identity.rs` — `configure_git_identity`: materialize target-local Git
  credentials/config via `materialization/git_identity.rs`.
- `repo_checkout.rs` — `ensure_repo_checkout`: clone/fetch/verify via
  `materialization/repo_checkout.rs`.
- `environment.rs` — `materialize_environment`: write env/files/config and
  coordinate runtime-config apply.
- `agent_auth.rs` — heavy agent-auth materialization that must ride the command
  path (synced files / gateway config) then call the AnyHarness apply endpoint.
- `pruning.rs` — `prune_workspace_worktree`: call AnyHarness retire/cleanup and
  report materialization state.
- `backfill.rs` — `backfill_exposed_workspace`: command entrypoint that
  delegates the actual snapshot mechanics to `tail/backfill.rs`.

Name handlers by command family. Do not add `handlers/materialization.rs` — it
hides which family is being handled.

## Reconcile (desired steady-state)

A revision lives in three places: Cloud **desired** (source of truth), worker
**applied** (derived from AnyHarness's real state), and Cloud's reported
**applied-per-target** (the worker reports it up for preflight/debug).

`reconcile/manager.rs` is **generic** — it tracks `applied`/`desired`/`backoff`
per domain and decides what is due. `reconcile/handlers/<domain>.rs` are
**per-domain** — they apply.

```text
manager, per domain, every cycle:
  if desired > applied AND now >= next_attempt[domain]:
      handler: fetch bundle (cloud) → apply to local AnyHarness
             → read-back-verify (content_hash) → set applied = revision
      on success: reset backoff
      on failure: bump backoff; after N tries mark 'failed' + surface a typed
                  error; retry only on backoff schedule or the next desired bump
```

Robustness rules — keep these visible:

- **Check is cheap and runs every cycle; apply is gated by per-domain backoff.**
  A stuck domain must not hot-retry on every poll.
- **Per-domain independence.** A broken MCP must not block a prompt that does
  not need it; a command that *does* depend on a stuck domain fail-fasts in
  command preflight.
- **`applied` is read back** from AnyHarness's real state, never an optimistic
  flag — this closes the "applied but forgot to record" bug class.
- **Apply is idempotent.** Over-applying is wasted work, never corruption.

Domains: `runtime_config`, `agent_auth`, `exposures`, `revoked_jti`. They are
siblings of one pattern, not one checking another.

## Hard Rules

- `loop.rs` holds the poll and routes; it never executes a command or applies a
  bundle.
- Commands ride one channel with reconcile signals — never split reconcile into
  its own poll.
- Mapping stays pure; AnyHarness HTTP goes through `anyharness_client`.
- Result retry and save-before-send live in the command executor's report step.
- `reconcile/manager.rs` stays domain-agnostic; per-domain apply stays in
  handlers.
- There are no slots and no fencing — never gate a command or apply on a slot
  generation.
- Control does not own event tailing, Cloud exposure policy, or supervisor
  update application.
