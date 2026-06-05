# Worker Clients

Status: authoritative for
`anyharness/crates/proliferate-worker/src/cloud_client/**` and
`anyharness/crates/proliferate-worker/src/anyharness_client/**`.

The two clients own raw HTTP access boundaries. Clients are not services. They
send and receive; callers decide. They are split into two top-level folders so
the path tells you which side a call talks to.

## Target Shape

```text
cloud_client/        # transport TO cloud — one file per endpoint
  mod.rs

anyharness_client/   # the local runtime substrate
  mod.rs
```

## Cloud Client

`cloud_client/` owns worker-facing Cloud HTTP endpoints and wire types — one
file per endpoint, with typed DTOs generated from the shared contract.

Endpoints:

- enrollment
- heartbeat (carries desired versions in the response)
- inventory upload (once, at startup)
- the control long-poll (`/worker/control/wait`) — returns commands **and**
  revision signals
- command delivery/result report
- reconcile bundle fetch (per domain, on demand)
- applied-revisions report
- event batch upload
- backfill upload

There is no separate exposures poll, revoked-jti poll, or command-lease poll:
those all ride the control long-poll. There is no slot-fence field on any
request or report.

## AnyHarness Client

`anyharness_client/` is the **only** path to local AnyHarness. Everything that
touches the runtime goes through here.

Endpoints:

- health/version probe
- workspace resolve/worktree/retire APIs
- session start/prompt/config/cancel/close APIs
- interaction resolution APIs
- event listing (for the tail)
- backfill snapshot
- runtime-config apply (`PUT /runtime-config`)
- agent-auth config apply (`/agents/auth-config`)

## Allowed

- base URL handling, auth headers, endpoint paths
- request/response structs and HTTP method calls
- HTTP status parsing and small wire-compatibility shims

## Banned

- command or reconcile lifecycle
- event cursor reconciliation
- retry loops beyond focused request mechanics
- filesystem effects or store writes
- Cloud product policy or AnyHarness execution semantics

## Hard Rules

- If code decides what a command means, it belongs in `control/commands`, not a
  client.
- If code decides what a revision or event cursor means, it belongs in
  `control/reconcile` or `tail`, not a client.
- If code writes target-local files or runs Git, it belongs in
  `materialization`, not a client.
- If code persists worker-local recovery state, it belongs in `store`, not a
  client.
- Generated wire types may be used when available, but each client stays a
  narrow explicit access layer.
