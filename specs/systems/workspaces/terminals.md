# Terminals

Status: current (grade B). System spec in the Organization Standard anatomy. The runtime system that owns interactive PTYs and one-shot command runs inside a workspace: creation, input/resize/close, the ordered output stream with replay, and the durable `terminal_command_runs` ledger that setup scripts, archive scripts, agent logins and `get_task_output` all read. It is small (~700 durable + ~2K live lines) but earns a spec by the granularity test: it has owned state, a public surface three other systems consume, and kill-ordering laws an uninformed change would violate.

Depth references: the Live Terminals section of [live-runtime.md](../../areas/anyharness.md) and the client-side [terminals.md](../workspace-surface/terminals.md).

## 1. Purpose

Give every workspace a shell the user and the agent can share, and give the runtime a single mechanism for "run this command in the workspace env, stream it, bound it, and be able to kill it for certain". Product outcome: a terminal pane that survives reconnects with replay, setup scripts whose status never lies, and workspace stop/archive that provably leaves no PTY behind.

## 2. Owned state

| State | Where |
| --- | --- |
| `terminal_command_runs` — purpose (`general`/`run`/`setup`), command, status (`queued`…`timed_out`), exit code, bounded stdout/stderr/combined output (64 KiB cap), timing | [store.rs](../../../anyharness/crates/anyharness-lib/src/domains/terminals/store.rs) |
| Live registry of running PTYs and output hubs (`TerminalRegistry`, `TerminalOutputRegistry`) | [live/terminals/manager.rs](../../../anyharness/crates/anyharness-lib/src/live/terminals/manager.rs) — process-lifetime only |
| Active setup/archive-script task registry | `TerminalService.active_setup_tasks` |
| Agent-login terminal records | [live/terminals/agent_login/](../../../anyharness/crates/anyharness-lib/src/live/terminals/agent_login/mod.rs) |
| `workspace_setup_state` — the durable "latest setup run" pointer per workspace (`set_latest_setup_run`, read by `latest_setup_run`) | [store.rs](../../../anyharness/crates/anyharness-lib/src/domains/terminals/store.rs); *when* it is set is [workspaces](../workspaces/README.md)' policy |

`TerminalRecord` itself is a live projection (id, workspace, title, purpose, cwd, status, exit code, latest command run) — terminals are not durable across runtime restarts; their command runs are.

## 3. Public surface

HTTP ([terminals.rs](../../../anyharness/crates/anyharness-lib/src/api/http/terminals.rs)):

| Route | Meaning |
| --- | --- |
| `GET|POST /v1/workspaces/{id}/terminals` | list / create (cwd, shell, purpose, env, startup command + timeout, cols/rows) |
| `GET|DELETE /v1/terminals/{id}` | record / close |
| `POST /v1/terminals/{id}/title`, `/resize` | rename, resize |
| `POST /v1/terminals/{id}/commands` | run a bounded command in an existing terminal |
| `GET /v1/terminal-command-runs/{id}` | a command-run record |
| terminal output stream (SSE/WS) | `TerminalOutputEvent::{Data{seq,…}, Exit{seq,code}, ReplayGap{requested_after_seq, floor_seq}}` |

Wire shapes: [terminals.rs](../../../anyharness/crates/anyharness-contract/src/v1/terminals.rs).

In-process: `TerminalService` ([manager.rs](../../../anyharness/crates/anyharness-lib/src/live/terminals/manager.rs)) exposes create/list/close, `start_setup_command` (start-and-poll), `run_blocking_command_for_workspace` (await-to-exit), `kill_active_run_for_workspace` and `close_all_for_workspace` ([command_runs/](../../../anyharness/crates/anyharness-lib/src/live/terminals/command_runs)); `TerminalCommandService` ([service.rs](../../../anyharness/crates/anyharness-lib/src/domains/terminals/service.rs)) owns the durable ledger rules.

## 4. Consumes

- `process_kill` (crate root) — `PlaneKills` census; every kill awaits
  confirmed process death.
- `adapters/processes` for one-shot spawns; portable-pty for PTYs
  ([driver/](../../../anyharness/crates/anyharness-lib/src/live/terminals/driver)).
- The workspace-derived env from [workspaces.md](../workspaces/README.md) (terminals never
  reconstruct env themselves).

## 5. Laws

**Kill by session, not by pid.** `close_all_for_workspace` kills every terminal by PTY *session* — the PTY child is a session leader, so this is what reaches a `&`-backgrounded job that job control put in its own group — and runs the per-terminal kills concurrently so a workspace pays one grace window ([command_runs/workspace_stop](../../../anyharness/crates/anyharness-lib/src/live/terminals/command_runs)).

**`is_setup_running` never lies.** `kill_active_run_for_workspace` kills the active setup/archive run by process *group* and marks the command run interrupted before returning.

**An archive script never becomes the setup pointer.** `run_blocking_command_for_workspace` records with `TerminalPurpose::Run`, registers in the active-run registry so it can be cancelled, but never calls `set_latest_setup_run`; and it *owns* the terminal it creates, closing it on every exit path (including the `ArchiveRunGuard::drop` backstop) because the terminal is rooted in the workspace being archived.

**Mechanism only, no composition.** None of the workspace-wide primitives takes an operation-gate lease, asserts the access gate, or kills the other resource in its pair (killing the setup terminal does not kill the script and vice versa); that composition is quiesce's, in [workspaces.md](../workspaces/README.md).

**Startup reconciles the ledger.** `TerminalService::new` marks every still-active command run failed and prunes completed non-setup runs to the newest 100, so a crash cannot leave a run reported as running.

**Output is bounded and ordered.** Command output is capped at 64 KiB with `output_truncated` set; stream events carry a monotonic `seq` and a subscriber that asks for a seq below the retained floor receives `ReplayGap` rather than silently missing data.

## 6. Emits

- The terminal output stream (`Data`/`Exit`/`ReplayGap`) consumed by the client
  terminal pane and by agent-login flows.
- Command-run records consumed by workspaces (setup status), subagents
  (`get_task_output`), and harnesses (login terminals).

## 7. Fences

| Not owned | Owner |
| --- | --- |
| Setup-script *policy* (detect, when to run, rerun) and the durable setup pointer | [workspaces.md](../workspaces/README.md) (`setup_runtime.rs`, `workspace_setup_state`) |
| Quiesce ordering across sessions/terminals/scripts | workspaces (`archive/quiesce.rs`) |
| Agent login semantics (which command, when Ready flips) | [harnesses.md](../harnesses/README.md); this system only hosts the PTY |
| Process spawning and kill mechanics | `process_kill` and `adapters/processes` (runtime capabilities) |
| Terminal pane UI, creation grid, tab behavior | client workspace surface ([terminals.md](../workspace-surface/terminals.md)) |

Declared edges into this domain: `workspaces → terminals`, `materialization → terminals`, `mobility → terminals`; this domain declares none outward.

## 8. Code map

```text
anyharness/crates/anyharness-lib/src/
├── domains/terminals/               durable half   → target: systems/terminals/
│   ├── model.rs                     TerminalRecord, command-run record, enums, options, output events
│   ├── service.rs                   TerminalCommandService: ledger rules, 64 KiB cap
│   └── store.rs                     terminal_command_runs SQL
├── live/terminals/                  live half      → target: systems/terminals/live/
│   ├── manager.rs                   TerminalService: registries, create/close, setup tasks
│   ├── handle.rs                    TerminalHandle: write, resize, close, subscribe
│   ├── driver/                      PTY + shell process lifecycle
│   ├── output_sink/                 ordered output/status hub with replay floor
│   ├── command_runs/                bounded runs, setup runs, workspace-wide stop
│   └── agent_login/                 login terminals hosted for harnesses (+ the seat-mint half)
├── api/http/terminals.rs            transport
└── (sse/ws transport for the output stream lives in api/)
anyharness/crates/anyharness-contract/src/v1/terminals.rs
```

Client-plane presentation: [components/workspace/terminals](../../../apps/packages/product-client/src/components/workspace/terminals), [hooks/terminals](../../../apps/packages/product-client/src/hooks/terminals), [lib/domain/terminals](../../../apps/packages/product-client/src/lib/domain/terminals), [lib/infra/terminals](../../../apps/packages/product-client/src/lib/infra/terminals), [stores/terminal](../../../apps/packages/product-client/src/stores/terminal).

## 9. Proof

- [live/terminals/manager_tests.rs](../../../anyharness/crates/anyharness-lib/src/live/terminals/manager_tests.rs)
  — registry, create/close, setup-run lifecycle, workspace-wide stop.
- The archive `quiesce` and `undo` scenarios in
  [workspaces/archive/tests](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/archive/tests/mod.rs)
  exercise `close_all_for_workspace` + `run_blocking_command_for_workspace`
  end to end.
- Client: the creation-grid acceptance in
  [terminals.md](../workspace-surface/terminals.md).

## Known gaps / follow-ups

- Terminal records do not survive a runtime restart; a cloud task environment
  that checkpoints and reaps loses open shells by design — the environments
  spec should say so explicitly.
- The durable store has no dedicated unit suite beyond the manager tests.
