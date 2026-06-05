# Worker Store

Status: authoritative for `anyharness/crates/proliferate-worker/src/store/**`.

`store/` owns worker-local SQLite — the only durable worker state. It is not
product truth; it exists so the bridge can recover from restarts and transient
Cloud failures.

## Target Shape

```text
store/
  mod.rs
  connection.rs
  migrations.rs
  identity.rs
  applied_revisions.rs
  up_cursor.rs
  exposure_cache.rs
  pending_command_results.rs
```

## What Goes Where

| File | Owns | Must Not Own |
| --- | --- | --- |
| `mod.rs` | Store facade and narrow construction surface. | Workflow methods. |
| `connection.rs` | SQLite connection setup, pragmas, busy timeout. | Table-specific queries. |
| `migrations.rs` | Worker DB schema creation and migration helpers. | Runtime workflow decisions. |
| `identity.rs` | Persisted worker identity row (`target_id`, `worker_id`, `worker_token`). | Enrollment workflow; slot fields. |
| `applied_revisions.rs` | Per-domain `applied` revision + backoff state for `control/reconcile`. | The reconcile scheduling decision (that is the manager's). |
| `up_cursor.rs` | The event tail up-cursor (`last_uploaded_seq`), ack state, and gap state. | Event tailing or Cloud upload. |
| `exposure_cache.rs` | The exposure set delivered via `control/reconcile`, cached for the tail. | Deciding exposure policy. |
| `pending_command_results.rs` | Command result save-before-send retry records. | Command processing lifecycle. |

## Allowed

Store code may own table-shaped CRUD, row mapping, local transactions,
migration helpers, and narrow recovery queries used by loops.

## Banned

Store code must not own Cloud or AnyHarness HTTP calls, command/reconcile/tail
workflows, product authorization, or broad "reconcile everything" service
methods.

## API Shape

Good store APIs are boring:

```rust
save_pending_command_result(...)
list_pending_command_results(...)
delete_pending_command_result(...)
get_applied_revision(domain)
set_applied_revision(domain, revision)
get_up_cursor()
advance_up_cursor(seq)
upsert_exposure_cache(...)
```

Bad store APIs hide workflows:

```rust
process_command_result(...)
apply_reconcile_state(...)
reconcile_everything_for_workspace(...)
```

## Hard Rules

- Store APIs stay table-shaped and recovery-oriented.
- Store does not call Cloud or AnyHarness.
- Store does not own command lifecycle, reconcile convergence, or event tailing.
- SQLite rows are worker bridge durability, not Cloud or AnyHarness product
  truth.
- No slot or fence columns — identity is `target_id` + `worker_id` +
  `worker_token` only.
- Do not preserve `sync` or `projection_cursor` vocabulary in new code; the up
  path is `tail` and its cursor is the `up_cursor`.
