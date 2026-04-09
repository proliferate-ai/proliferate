# Persistence

`anyharness-lib/src/persistence/**` owns SQLite bootstrap, migrations, and the
shared database handle used by domain stores.

## Core Concepts

Persistence is intentionally small and central.

It owns:

- opening the runtime SQLite database
- enabling required pragmas
- running migrations
- exposing the shared `Db` handle used by stores

It does not own domain-specific SQL. That stays in the owning domain store such
as `sessions/store.rs` or `workspaces/store.rs`.

## Core Models

Core persistence files:

- `anyharness/crates/anyharness-lib/src/persistence/sqlite.rs`
- `anyharness/crates/anyharness-lib/src/persistence/migrations.rs`
- `anyharness/crates/anyharness-lib/src/persistence/mod.rs`

### `Db` (`anyharness/crates/anyharness-lib/src/persistence/sqlite.rs`)

`Db` is the shared SQLite handle wrapper.

It owns:

- one `rusqlite::Connection`
- mutex-protected access
- helper entrypoints for normal and transactional work

The important methods are:

- `open(...)`
- `open_in_memory(...)`
- `with_conn(...)`
- `with_tx(...)`

### Migrations (`anyharness/crates/anyharness-lib/src/persistence/migrations.rs`)

`migrations.rs` owns the ordered migration list and the `_migrations` tracking
table.

Each migration:

- has a stable name
- is applied once
- runs inside its own transaction

## Main Flow

### Startup

Database startup is:

1. determine the runtime DB path under runtime home
2. open the SQLite connection
3. enable required pragmas such as WAL and foreign keys
4. run migrations
5. return a shared `Db` handle

`AppState::new(...)`
(`anyharness/crates/anyharness-lib/src/app/mod.rs`)
then injects that shared handle into domain stores.

### Store Boundary

Persistence should be thought of as a two-layer boundary:

- `persistence/**`
  - DB bootstrap and shared DB access
- domain `store.rs`
  - actual SQL for that domain

That means:

- `sessions/store.rs` owns session/event/config SQL
- `workspaces/store.rs` owns workspace SQL
- `persistence/**` does not become a giant shared query bucket

## Durable Models

AnyHarness does not centralize all durable records in one global models module.

Instead:

- each durable domain owns its own record structs in `model.rs`
- each durable domain owns its own SQL in `store.rs`

Examples:

- `anyharness/crates/anyharness-lib/src/sessions/model.rs`
  - `SessionRecord`
  - `SessionEventRecord`
  - live-config and pending-change records
- `anyharness/crates/anyharness-lib/src/workspaces/model.rs`
  - `WorkspaceRecord`
  - git-context discovery records

This keeps durable state definitions close to the domain that owns them.

## Boundaries

### Persistence Owns

- opening SQLite
- migration sequencing
- shared DB access helpers

### Persistence Does Not Own

- session-domain rules
- workspace-domain rules
- agent install state
- live ACP or terminal state
- transport-layer schemas

## Important Invariants

- Migrations are the schema source of truth.
- Domain stores should use the shared `Db` handle rather than opening their own
  connections.
- Durable domain SQL stays with the owning domain store, not in
  `persistence/**`.
- Live in-memory runtime state must not be treated as if it were durable DB
  state.

## Extension Points

Add behavior here when it changes DB bootstrap or migration mechanics, for
example:

- new startup pragmas
- migration runner behavior
- DB-handle helper APIs

Do not add domain-specific query logic here unless it is truly cross-domain DB
infrastructure.
