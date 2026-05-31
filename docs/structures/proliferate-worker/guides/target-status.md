# Worker Target Status

Status: authoritative for
`anyharness/crates/proliferate-worker/src/target_status/**`.

`target_status/` owns target health and status reporting.

```text
target / AnyHarness / versions
  -> Worker status loop
  -> Cloud heartbeat, inventory, desired-version status
```

## Target Shape

```text
target_status/
  mod.rs
  loop.rs
  health.rs
  heartbeat.rs
  inventory_report.rs
  update_observation.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Facade exposing the target status loop and test-facing types. | Status-loop internals. |
| `loop.rs` | Recurring loop: sleep on interval, probe health, send heartbeat/status, observe desired versions, honor shutdown. | Health probe details, update application, target materialization. |
| `health.rs` | Health probes and health summaries, especially AnyHarness availability. | Command lease support policy. |
| `heartbeat.rs` | Cloud heartbeat request construction and response interpretation. | Inventory collection internals or update mailbox writes. |
| `inventory_report.rs` | Target inventory upload orchestration. | Inventory fact collection; that belongs under `target/inventory`. |
| `update_observation.rs` | Desired-version observation and delegation to `target/updates`. | Binary download, replacement, restart, or rollback. |

## Responsibilities

Target status reports what is true about the target and what Cloud currently
wants. It does not change runtime state except by delegating narrow update
mailbox writes to `target/updates`.

It may report:

- Worker identity and slot metadata
- Worker, AnyHarness, and supervisor versions
- AnyHarness health
- target inventory summaries
- desired-version observation
- update request/status summaries

## Update Boundary

Worker may:

- observe Cloud desired versions from heartbeat/status responses
- compare desired versions with installed versions
- write a narrow supervisor update-request mailbox through `target/updates`
- report update request/status state back to Cloud

Worker must not:

- download binaries
- replace binaries
- restart processes
- rollback versions
- decide supervisor lifecycle

## Hard Rules

- `target_status/loop.rs` stays boring.
- Health summaries are status inputs, not command lease policy.
- Inventory collection lives under `target/inventory`.
- Update application belongs to supervisor.
- Desired-version mailbox writes go through `target/updates`.
