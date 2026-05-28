# Cloud Command Contract / Deliverability

Status: quick-reference study packet for the Cloud command queue, worker
delivery, lease behavior, and failure semantics.

Canonical sources:

- `docs/current/specs/04-cloud-running-alignment.md`
- `docs/architecture/cloud-worker-workspace-command-spec.md`
- `docs/server/README.md`

## Executive Shape

Cloud commands are a DB-backed downlink queue:

```text
user/API/Slack/automation
  -> POST /v1/cloud/commands
  -> cloud_commands row
  -> worker lease
  -> delivery ack
  -> AnyHarness or local materialization dispatch
  -> terminal result
```

Session output is not a command result. Session output flows through:

```text
AnyHarness events -> worker event upload -> Cloud projection -> SSE/read models
```

## Core Paths

Public command API:

```text
cloud/sdk/src/client/commands.ts
cloud/sdk-react/src/hooks/commands.ts
server/proliferate/server/cloud/commands/api.py
server/proliferate/server/cloud/commands/models.py
server/proliferate/server/cloud/commands/service.py
server/proliferate/server/cloud/commands/domain/rules.py
```

DB command store:

```text
server/proliferate/db/models/cloud/commands.py
server/proliferate/db/store/cloud_sync/commands.py
```

Worker command API:

```text
server/proliferate/server/cloud/worker/api.py
server/proliferate/server/cloud/worker/service.py
```

Worker dispatch:

```text
anyharness/crates/proliferate-worker/src/cloud_client/commands.rs
anyharness/crates/proliferate-worker/src/commands/dispatcher.rs
anyharness/crates/proliferate-worker/src/commands/mapping.rs
```

AnyHarness route root:

```text
anyharness/crates/anyharness-lib/src/api/router.rs
```

## Command DB State

Model:

```text
server/proliferate/db/models/cloud/commands.py
  CloudCommand
```

Important fields:

- `id`
- `idempotency_key`
- `target_id`
- `workspace_id`: AnyHarness workspace id
- `cloud_workspace_id`: Cloud product workspace id
- `session_id`
- `kind`
- `payload_json`
- `observed_event_seq`
- `preconditions_json`
- `source`
- `actor_kind`, `actor_user_id`, auth context
- `status`
- `lease_id`
- `leased_by_worker_id`
- `leased_cloud_sandbox_id`
- `leased_slot_generation`
- `attempt_count`
- `lease_expires_at`
- delivery/result timestamps
- `error_code`, `error_message`
- `result_json`

## Public Command Shape

Endpoint:

```text
POST /v1/cloud/commands
GET  /v1/cloud/commands/{command_id}
```

Request fields:

```text
idempotencyKey
targetId
workspaceId          AnyHarness workspace id when known.
cloudWorkspaceId     Cloud product workspace row.
sessionId
kind
payload
observedEventSeq
preconditions        currently rejected by shape rules.
source
```

Response includes command id/scope/status/timestamps/errors/result. Public
result is selective; `send_prompt` does not expose transcript output.

## Kinds / Statuses / Sources

Active command kinds:

```text
start_session
configure_git_identity
ensure_repo_checkout
materialize_workspace
prune_workspace_worktree
materialize_environment
refresh_agent_auth_config
send_prompt
resolve_interaction
update_session_config
cancel_turn
close_session
backfill_exposed_workspace
```

Statuses:

```text
queued
leased
delivered
accepted
accepted_but_queued
rejected
expired
superseded
failed_delivery
```

Sources:

```text
web
mobile
slack
api
automation
desktop_cloud_view
```

Constants:

```text
server/proliferate/constants/cloud.py
```

## Enqueue Lifecycle

Path:

```text
server/proliferate/server/cloud/commands/service.py
```

Enqueue does:

1. Load visible target.
2. Validate command kind and source.
3. Validate shape and payload size.
4. Resolve workspace/exposure/projection scope.
5. Stamp agent auth preflight for launch-capable commands.
6. Stamp runtime config preflight for managed launch-capable commands.
7. Validate readiness where possible.
8. Compute idempotency scope.
9. Insert `cloud_commands` row as `queued`.
10. Publish `command_status` after commit.
11. Wake managed slot if the command needs it.

Shape rules:

- Target-only commands reject workspace/session scope.
- Session commands require `sessionId`.
- `start_session`, `backfill_exposed_workspace`, and
  `prune_workspace_worktree` require workspace scope.
- `preconditions` are currently rejected.
- Payload cap is 262,144 bytes.
- Managed `start_session` requires a ready Cloud workspace, active exposure,
  AnyHarness workspace id, owner/profile/target match, and current slot.

## Lease / Delivery / Result

Worker endpoints:

```text
POST /v1/cloud/worker/commands/lease
POST /v1/cloud/worker/commands/{command_id}/delivery
POST /v1/cloud/worker/commands/{command_id}/result
```

Lease envelope adds:

```text
commandId
idempotencyKey
targetId
workspaceId
cloudWorkspaceId
sandboxProfileId
slotGeneration
sessionId
kind
payload
observedEventSeq
preconditions
leaseId
leaseExpiresAt
```

Delivery ack accepts:

```text
delivered
failed_delivery
```

Terminal result accepts:

```text
accepted
accepted_but_queued
rejected
failed_delivery
```

Result can echo:

```text
cloudWorkspaceId
slotGeneration
anyharnessWorkspaceId
result body
error code/message
```

## Lease Guarantees

Store:

```text
server/proliferate/db/store/cloud_sync/commands.py
```

Behavior:

- Lease is FIFO-ish with row locking and `SKIP LOCKED`.
- Lease considers `queued` and expired `leased` commands.
- Lease assigns `lease_id`, worker id, sandbox id, slot generation, and expiry.
- Managed leases require worker slot identity to match the active slot.
- Lease blockers can supersede/reject stale commands before worker dispatch.
- Default lease is 30s.
- Max lease is 300s.
- Worker requests 300s.
- Empty lease poll sleeps about 2s.
- Lease errors sleep about 5s.

Delivery/retry model:

- Before delivery: effectively at-least-once. If a worker dies while `leased`,
  the expired lease can be picked up again.
- After delivery: the row is not normally re-leased after expiry.
- A later result with the same lease can still complete a delivered command.
- Worker saves `pending_command_results` locally before posting result to Cloud.
- If result POST fails, worker retries from local SQLite next loop.
- Crash after delivery but before local result preparation can strand a command
  in `delivered`.
- Web-sourced `start_session`, `send_prompt`, and `update_session_config`
  expire after roughly 4 minutes if still queued/nonterminal.

## Preflight

Agent auth:

- `start_session` and `send_prompt` carry/stamp `sandboxProfileId`.
- They carry/stamp `requiredAgentAuthRevision`.
- `start_session` includes `agentAuthScope`.
- `send_prompt` should not invent/override agent auth scope.
- Missing/stale auth blocks launch before AnyHarness starts.

Runtime config:

- Managed launch-capable commands require current runtime config.
- Cloud stamps required runtime config revision/sequence/content hash.
- Worker maps that into AnyHarness runtime config expectation.
- Stale or blocked target state blocks/rejects lease.

Exposure/lifecycle:

- Workspace must exist.
- Workspace must not be archived.
- Target/profile/owner must match.
- Exposure must be active.
- Exposure/projection must be commandable for command-capable actions.
- `materialize_workspace` has a pruned-workspace rematerialization allowance.
- Old sandbox/slot result becomes `superseded`.

## Command Mapping To AnyHarness

Worker mapping:

```text
anyharness/crates/proliferate-worker/src/commands/mapping.rs
```

Examples:

```text
materialize_workspace(existing_path) -> POST /v1/workspaces/resolve
materialize_workspace(worktree)      -> POST /v1/workspaces/worktrees
start_session                        -> POST /v1/sessions
send_prompt                          -> POST /v1/sessions/{session_id}/prompt
update_session_config                -> POST /v1/sessions/{session_id}/config-options
cancel_turn                          -> POST /v1/sessions/{session_id}/cancel
close_session                        -> POST /v1/sessions/{session_id}/close
resolve_interaction                  -> interaction resolution route
```

Local materialization handlers:

```text
configure_git_identity
ensure_repo_checkout
materialize_environment
backfill_exposed_workspace
prune_workspace_worktree
refresh_agent_auth_config
```

## Deliverability Edge Cases

`queued`:

- Worker has not leased it.
- Target may be offline.
- Command may later expire if web-sourced and queue timeout applies.

`leased`:

- Worker has a lease but has not reported delivery.
- If lease expires before delivery, another lease can pick it up.

`delivered`:

- Worker has acknowledged receiving it.
- The command is not normally re-leased.
- A result with the same lease can still finish it.
- Crash after delivery but before result prep is the main stranded state.

`accepted`:

- Dispatch/materialization was accepted.
- For sessions/prompts, actual output still comes through event projection.

`accepted_but_queued`:

- AnyHarness accepted but queued internally.
- UI should keep polling/projection state.

`rejected`:

- Command was valid enough to handle but failed domain/runtime precondition.

`failed_delivery`:

- Worker or dispatch path could not deliver.

`superseded`:

- State changed before command could safely run, commonly stale slot/workspace.

`expired`:

- Server expired a stale queued/nonterminal command.

## Debugging

Start with `cloud_commands`:

```text
id
target_id
cloud_workspace_id
workspace_id
session_id
kind
status
lease_id
leased_by_worker_id
leased_cloud_sandbox_id
leased_slot_generation
lease_expires_at
attempt_count
error_code
error_message
result_json
```

Then inspect:

```text
cloud_targets
cloud_workers
cloud_target_status
cloud_workspace
cloud_workspace_exposure
cloud_sessions
cloud_event_ingest_state
worker local pending_command_results
worker local worker_projection_cursor
```

Useful log strings:

```text
cloud command queued
cloud worker command leased
processing cloud command
cloud worker command delivery recorded
cloud worker command result recorded
uploaded worker event batch
cloud worker event batch ingested
```

Useful tests:

```text
server/tests/integration/test_cloud_commands_api.py
server/tests/integration/test_cloud_event_sync_api.py
server/tests/integration/test_cloud_event_streams_api.py
server/tests/unit/test_cloud_executor_worker_commands.py
```

## Review Questions

- What is the difference between `cloudWorkspaceId` and `workspaceId`?
- What does delivery mean versus result?
- When can a command be re-leased?
- Why can a command get stuck in `delivered`?
- Which statuses are terminal?
- What preflight fields get stamped for managed launch commands?
- Why does `send_prompt` acceptance not mean the answer has arrived?

