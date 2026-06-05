# Worker Lifecycle

Status: authoritative for
`anyharness/crates/proliferate-worker/src/lifecycle/**`.

`lifecycle/` owns the heartbeat (liveness) and the self-update **request**. The
worker can only *request* an update; the supervisor *applies* it. The two
couple through exactly one thing — an atomic file mailbox — so the request
survives a restart of either process.

```text
versions/status ── heartbeat ──► Cloud ── response carries DESIRED versions ──►
  compare desired vs installed ── if stale ──► write desired-update.json (mailbox)
                                                        │
                                              SUPERVISOR reads + applies
```

## Target Shape

```text
lifecycle/
  mod.rs
  heartbeat.rs
  self_update.rs
  supervisor_mailbox.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Facade exposing the heartbeat main-loop step and test-facing types. | Heartbeat payload internals or mailbox format. |
| `heartbeat.rs` | Heartbeat request construction (versions, status), the `stale/3` cadence, and response interpretation. | Inventory collection; binary management. |
| `self_update.rs` | Compare Cloud desired versions vs installed; decide which components are stale. | Downloading, swapping, restarting, or rolling back binaries. |
| `supervisor_mailbox.rs` | Write/clear the `desired-update.json` mailbox atomically and idempotently. | Reading or acting on the mailbox (that is the supervisor's job). |

## Heartbeat

The heartbeat is the worker's liveness ping and the carrier for the self-update
check — there is no separate version poll.

```text
every stale/3 (≥ 10s):
  POST /heartbeat { versions, status }
    -> response carries DESIRED versions
    -> self_update: compare desired vs installed
    -> if any component is stale: write the mailbox (atomic, idempotent)
```

Cadence lives here as the worker's main loop; `control` and `tail` are their own
spawned tasks.

## Self-Update Boundary

Worker may:

- read Cloud desired versions from the heartbeat response
- compare desired versions with installed versions
- write a narrow supervisor update-request mailbox (only the stale components)
- report update request/status state back to Cloud

Worker must not:

- download binaries
- replace binaries
- restart processes
- roll back versions
- decide supervisor lifecycle

## The Mailbox

`desired-update.json` is a file, not IPC, on purpose: it survives a restart of
either the worker or the supervisor. Writes are atomic (temp → fsync → rename)
and idempotent — writing the same desired state twice is a no-op. The mailbox
lists only stale components; the supervisor applies them per-component.

## Hard Rules

- The heartbeat main loop stays boring: build payload, POST, route the
  self-update check, sleep.
- The worker requests updates; it never applies them. Binary download,
  replacement, restart, and rollback belong to the supervisor.
- Mailbox writes are atomic and idempotent.
- Identity is ephemeral — the heartbeat reports liveness, not a slot or fence.
