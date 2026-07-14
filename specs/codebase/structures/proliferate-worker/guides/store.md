# Worker Store

Status: authoritative for `anyharness/crates/proliferate-worker/src/store/**`.

Worker-local SQLite contains only restart-critical Worker state. It is not
Cloud workspace state, AnyHarness runtime state, or a copy of server truth.

## Current Tree

```text
store/
├── mod.rs
├── connection.rs
├── migrations.rs
├── identity.rs
└── anyharness_update.rs
```

## Current Schema

```text
identity (single row, id = 1)
  worker_id
  worker_token
  updated_at

anyharness_update (single row, id = 1)
  converged_version
  failed_pin
  updated_at
```

`identity` lets a restart reuse the opaque Worker credential without another
enrollment. `anyharness_update` records the runtime version last swapped and
health-verified plus a pin explicitly marked after a relaunch or health-gate
failure, preventing that recorded pin from being retried every heartbeat.

## Source Ownership

| File | Owns |
| --- | --- |
| `mod.rs` | `WorkerStore` handle and module boundary |
| `connection.rs` | Database creation, private permissions, connection pragmas, and busy timeout |
| `migrations.rs` | Current table creation |
| `identity.rs` | Single-row identity load and upsert |
| `anyharness_update.rs` | Converged-version and failed-pin reads/writes |

The connection enables foreign keys and WAL and uses a five-second busy
timeout. The containing directory and database file are permission-restricted
on Unix.

## Hard Rules

- Keep APIs table-shaped and narrow; do not hide HTTP or convergence workflows
  behind store methods.
- Never store enrollment tokens, integration-gateway credentials, Cloud
  sandbox/workspace rows, commands, event cursors, or projections here.
- Do not log or expose `worker_token`.
- Preserve the single-row invariants unless the identity model itself changes.
- Use the schema and migrations that exist; do not document planned tables as
  current.
