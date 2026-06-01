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

## Transactions

When a workflow needs multiple store writes to succeed together, keep the
transaction ownership explicit.

Rules:

- low-level transaction helpers live with the relevant store when they are
  tightly tied to that store's SQL
- cross-domain transaction workflows belong in the owning domain runtime or
  service
- stores should not hide product workflow decisions inside a transaction helper

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
