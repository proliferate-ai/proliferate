# Worker Store

Status: authoritative for `anyharness/crates/proliferate-worker/src/store/**`.

`store/` owns worker-local SQLite and bridge durability.

The worker store is not product truth. It exists so the bridge can recover from
restarts and transient Cloud failures.

## Target Shape

```text
store/
  mod.rs
  connection.rs
  migrations.rs
  identity.rs
  pending_command_results.rs
  projection_cursors.rs
  workspace_mappings.rs
  workspace_discovery.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Store facade and narrow construction surface. | Workflow methods. |
| `connection.rs` | SQLite connection setup, pragmas, busy timeout. | Table-specific queries. |
| `migrations.rs` | Worker DB schema creation and migration helpers. | Runtime workflow decisions. |
| `identity.rs` | Persisted worker identity row access. | Enrollment workflow. |
| `pending_command_results.rs` | Command result retry records. | Command processing lifecycle. |
| `projection_cursors.rs` | Event uplink cursor state, ack state, and gap state. | Event tailing or Cloud upload. |
| `workspace_mappings.rs` | Local AnyHarness workspace/session to Cloud mapping cache. | Cloud projection persistence. |
| `workspace_discovery.rs` | Exposed-workspace discovery throttling. | Discovery workflow orchestration. |

## Allowed

Store code may own:

- table-shaped CRUD
- row mapping
- local transactions
- migration helpers
- narrow recovery queries used by loops

## Banned

Store code must not own:

- Cloud HTTP calls
- AnyHarness HTTP calls
- command processing workflows
- event uplink workflows
- product authorization
- broad "reconcile everything" service methods

## API Shape

Good store APIs are boring:

```rust
save_pending_command_result(...)
list_pending_command_results(...)
delete_pending_command_result(...)
reconcile_projection_cursors(...)
list_active_projection_cursors(...)
update_projection_cursor_ack(...)
upsert_workspace_mapping(...)
```

Bad store APIs hide workflows:

```rust
process_command_result(...)
apply_projection_state(...)
reconcile_everything_for_workspace(...)
```

## Hard Rules

- Store APIs stay table-shaped and recovery-oriented.
- Store does not call Cloud or AnyHarness.
- Store does not own command lifecycle or event uplink workflow.
- SQLite rows are Worker bridge durability, not Cloud or AnyHarness product
  truth.
- Rename misleading store files only with a migration plan for code references;
  do not preserve `sync` vocabulary in new code.
