# Worker Clients

Status: authoritative for `anyharness/crates/proliferate-worker/src/clients/**`.

`clients/` owns raw HTTP access boundaries. Clients are not services. They do
not own product workflows.

## Target Shape

```text
clients/
  mod.rs
  cloud/
  anyharness/
```

## Cloud Client

`clients/cloud/` owns Worker-facing Cloud HTTP endpoints and wire types.

Examples:

- enrollment
- heartbeat
- inventory upload
- command lease/delivery/result
- exposure listing
- event batch upload
- backfill upload
- target config materialization fetch
- target Git identity materialization fetch
- agent auth materialization fetch/status
- revoked-token listing
- update status

## AnyHarness Client

`clients/anyharness/` owns local AnyHarness HTTP endpoints and wire types.

Examples:

- health/version probe
- workspace resolve/worktree/retire APIs
- session start/prompt/config/cancel/close APIs
- interaction resolution APIs
- event listing
- backfill snapshot
- runtime config apply
- agent auth config apply

## Allowed

Clients may own:

- base URL handling
- auth headers
- request/response structs
- endpoint paths
- HTTP method calls
- HTTP status parsing
- small wire compatibility shims

## Banned

Clients must not own:

- command lifecycle
- event cursor reconciliation
- retry loops beyond focused request mechanics
- filesystem effects
- store writes
- Cloud product policy
- AnyHarness execution semantics
- target materialization workflows

## Hard Rules

- If code decides what a command means, it belongs in `command_downlink`, not a
  client.
- If code decides what an event cursor means, it belongs in `event_uplink`, not
  a client.
- If code writes target-local files or runs Git, it belongs in `target`, not a
  client.
- If code persists Worker-local recovery state, it belongs in `store`, not a
  client.
- Generated wire types may be used when available, but the Worker client
  remains a narrow explicit access layer.
