# AnyHarness Persistence

Status: authoritative for SQLite and store ownership in AnyHarness.

## Layer Split

There are two persistence concerns:

```text
persistence/
  database infrastructure

domains/<domain>/store.rs or store/
  product-specific queries
```

`persistence/` owns:

- opening SQLite
- migrations
- low-level DB wrapper types
- custom migration runners

Domain stores own:

- SQL for their product rows
- mapping rows into domain records
- durable query APIs used by services/runtimes

## Store Rules

Stores should:

- be synchronous when using the current SQLite access pattern
- own SQL query construction
- return domain records, not contract responses
- avoid business workflows
- avoid live runtime calls

Stores should not:

- call API handlers
- construct contract response payloads
- start actors or subprocesses
- perform multi-domain orchestration

## The Two-Tier Store Pattern

Stores have two tiers, and the split is what makes transactions composable:

```text
TIER 1 (public)   store fns speak domain and own the connection:
                    pub fn insert(&self, record) -> with_conn(...)
                    pub fn delete_session(&self, id) -> with_tx(...)

TIER 2 (private)  row fns take &Connection so several can compose
                  inside ONE transaction:
                    pub(super) fn insert_session_row(conn, record)
                    pub(super) fn insert_event_row(conn, ...)
```

The transaction boundary is the use-case boundary: when a use case needs
atomicity across row families (fork = session + link + event snapshot), one
tier-1 fn opens one `with_tx` and calls several tier-2 fns inside it.
Connections never escape upward; row types and SQL never escape the store.
In-repo exemplar: `domains/sessions/store/**`; cross-domain atomic deletes use
the participant-trait pattern (`domains/sessions/deletion.rs`).

Rules:

- low-level transaction helpers live with the relevant store when they are
  tightly tied to that store's SQL
- cross-domain transaction workflows belong in the owning domain runtime or
  service
- stores should not hide product workflow decisions inside a transaction helper

## Time, Identity, And Errors

- **Domain-meaningful times are passed in** (`created_at`, `closed_at`,
  `last_prompt_at` are minted by the use case's record phase);
  **`updated_at` is store-owned bookkeeping**. A store file using both
  conventions for the same kind of field is a bug farm — pick per the rule
  above. Identity (`Uuid::new_v4()`) is never minted inside a store.
- **Expected conditions live in the `Ok` type**: not-found is
  `Option`, empty is an empty `Vec`. Errors are reserved for infrastructure
  failure (disk, corruption, lock contention) — and for that, `anyhow` at the
  store surface is acceptable; services wrap it as their internal variant.
  Never encode an expected condition as an error string a caller must parse.

## Store Decomposition

A store file should split when it owns multiple independent row families or
exceeds the repo-shape thresholds.

For sessions, a clean target is:

```text
domains/sessions/store/
  mod.rs
  sessions.rs
  events.rs
  raw_notifications.rs
  live_config.rs
  pending_prompts.rs
  background_work.rs
```

Each file should own one table family or one closely related query family.
