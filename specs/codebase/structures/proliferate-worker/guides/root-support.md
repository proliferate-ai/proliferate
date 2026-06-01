# Worker Root Support Files

Status: authoritative for support files at
`anyharness/crates/proliferate-worker/src/*.rs`.

Root support files are small, boring cross-cutting modules that do not yet need
their own folder. They are not a place for generic utilities or hidden service
layers.

## Target Shape

```text
src/
  config.rs
  error.rs
  logging.rs
  observability.rs
  versions.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `config.rs` | Worker config load, parse, sanitize, and private config writes. | Command, event, target, or identity workflows. |
| `error.rs` | Worker error enum and conversions. | Domain-specific control flow. |
| `logging.rs` | Tracing/Sentry/log initialization. | Per-flow observability policy. |
| `observability.rs` | Shared diagnostic helpers and correlation conventions. | Workflow implementation or hidden global state. |
| `versions.rs` | Worker, AnyHarness, and supervisor version helpers. | Target inventory upload orchestration or update application. |

## Observability

Shared observability helpers may define correlation-field conventions and small
formatting utilities. Flow code still owns when and why it logs.

Important correlation fields:

- `command_id`
- `lease_id`
- `target_id`
- `worker_id`
- `sandbox_profile_id`
- `slot_generation`
- `cloud_workspace_id`
- `anyharness_workspace_id`
- `session_id`
- `session_projection_id`
- `exposure_id`

## Hard Rules

- Keep root support files small and boring.
- Do not add `utils.rs`, `helpers.rs`, or `misc.rs`.
- Do not create an `infra/` folder unless root support files become a real
  source of clutter.
- `infra/` must not become a softer name for `utils`.
- Move code into an owning subsystem when it starts making product, command,
  event, target, store, client, or identity decisions.
