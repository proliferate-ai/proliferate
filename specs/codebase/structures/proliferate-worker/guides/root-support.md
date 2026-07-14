# Worker Root Support Files

Status: authoritative for cross-cutting files at
`anyharness/crates/proliferate-worker/src/*.rs`.

Root support modules are small process-wide dependencies. The focused root
workflow modules—`catalog_sync.rs`, `integration_gateway.rs`,
`self_update.rs`, and `anyharness_update.rs`—are covered by the identity,
lifecycle, and client guides rather than treated as generic utilities.

## Ownership

| File | Owns | Does not own |
| --- | --- | --- |
| `config.rs` | TOML config loading, defaults, enrollment-token sanitation, atomic private writes | Enrollment or convergence decisions |
| `error.rs` | Worker error variants and source conversion | Recovery policy |
| `logging.rs` | Tracing and Sentry initialization, release identity, privacy scrubbing | Per-flow decisions |
| `observability.rs` | Heartbeat acknowledgement event | A generic telemetry service |
| `process_lock.rs` | One Worker process per canonical database path | Process supervision |
| `versions.rs` | Stamped Worker version and boot-time AnyHarness version hint | Desired-version policy |

## Configuration Boundary

Current configuration includes:

- Cloud base URL, optional enrollment token, and Worker database path;
- heartbeat interval;
- integration-gateway output home;
- independent Worker and AnyHarness update gates;
- fixed AnyHarness binary, launcher, and working-directory paths used when its
  update gate is enabled;
- runtime base URL and optional runtime bearer token for narrow local calls.

Update gates default to false. Runtime URL defaults to
`http://127.0.0.1:8457`. Runtime bearer auth can be loaded from config or the
`ANYHARNESS_BEARER_TOKEN` environment variable by the focused caller.

## Telemetry And Privacy

`logging.rs` stamps component-specific Worker release identity, initializes
Sentry when configured, and scrubs bearer values, URL query strings, and
absolute local paths from captured text. Flow modules still decide what an
event means and when to emit it.

Use current identifiers such as `worker_id` and the authenticated user context
when available. Do not add removed command, Target, projection, slot, or
generation identifiers as standard Worker fields.

## Hard Rules

- Do not add catch-all `utils`, `helpers`, `misc`, or service modules.
- Keep secrets out of errors and telemetry.
- Keep private writes atomic and permission-restricted.
- Move a decision into its focused owner when a support file starts owning a
  workflow.
- The process lock prevents two Workers from sharing one local database; it is
  not a distributed lock or Supervisor contract.
