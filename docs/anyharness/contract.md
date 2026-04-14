# Contract Crate

`anyharness-contract` is the transport schema crate for AnyHarness.

## Allowed Location

- `anyharness/crates/anyharness-contract/src/**`

## Owns

- HTTP request bodies
- HTTP response bodies
- SSE payload schemas
- WebSocket payload schemas
- public enums visible to SDK consumers
- OpenAPI-visible struct and enum definitions
- API version folders such as `v1/`

## Must Not Own

- runtime services
- database records
- process handles
- filesystem and environment discovery
- business orchestration
- persistence helpers
- `axum` handlers
- `anyhow`-style workflow logic

## Versioning Rule

Transport schemas must live under an explicit version folder:

- `v1/common.rs`
- `v1/errors.rs`
- `v1/health.rs`
- `v1/models.rs`
- `v1/agents.rs`
- `v1/workspaces.rs`
- `v1/sessions.rs`
- `v1/files.rs`
- `v1/git.rs`
- `v1/terminals.rs`
- `v1/processes.rs`
- `v1/hosting.rs`
- `v1/events.rs`

Future breaking versions should become sibling folders such as `v2/`, not
unstructured replacements.

## Module Map

### `common.rs`

Owns shared identifier aliases used by the public API surface.

### `errors.rs`

Owns `ProblemDetails`, the canonical wire error shape returned by HTTP
endpoints.

### `health.rs`

Owns health-check response types.

### `models.rs`

Owns provider configuration metadata:

- model catalog
- thinking levels
- permission modes
- mutability flags

### `agents.rs`

Owns agent-facing transport types:

- readiness/install/credential state enums
- artifact status
- agent summary
- install/login/reconcile request and response shapes

### `workspaces.rs`

Owns workspace-facing transport types:

- workspace summary
- create and resolve requests
- worktree creation request and response
- setup-script execution payload

### `sessions.rs`

Owns session-facing transport types:

- session summary
- create and reconfigure requests
- prompt request and response
- interaction resolution request

### `files.rs`

Owns workspace file listing, read, write, and stat wire formats.

### `git.rs`

Owns normalized git response types:

- status snapshots
- changed files
- diff response
- branches
- stage/unstage/commit/push requests and responses

### `terminals.rs`

Owns terminal record and create/resize requests.

### `processes.rs`

Owns one-shot command execution request and response types.

### `hosting.rs`

Owns pull-request request and response types.

### `events.rs`

Owns the normalized session event stream:

- `SessionEventEnvelope`
- `SessionEvent`
- lifecycle events
- transcript item payloads
- config updates
- interaction events
- error events

This file is the public transcript/event contract and must remain stable and
well-structured.

Interaction payloads should expose only typed, UI-safe fields. Adapter-specific
metadata that becomes stable UI behavior must be promoted into a typed contract
field, such as `PermissionInteractionContext`, instead of being read from raw
ACP `_meta` or raw tool input/output blobs.

Adapter permission producers may provide display-safe context in vendor-scoped
ACP metadata, currently `_meta.claudeCode.permissionContext` and
`_meta.gemini.permissionContext`. `anyharness-lib/src/acp` is the only layer
that should read those keys; SDK and Desktop consumers must use the normalized
typed `PermissionInteractionContext` carried by interaction events and pending
interaction summaries.

## Transport-Only Rule

The contract crate is for wire shapes, not internal domain flow.

That means:

- if a service needs an internal result type, define it in `anyharness-lib`
- if a store needs an internal record, define it in `anyharness-lib`
- if a handler needs to return a public shape, convert to a contract type there

Using contract types as internal service results should be treated as a
transitional compromise, not the default pattern for new code.

## Serialization Rules

- use explicit serde casing
- prefer stable public names over mirroring internal field names
- keep transport enums descriptive and bounded
- avoid leaking backend-only implementation details onto the wire

## OpenAPI Rule

If a type must appear in OpenAPI or the generated SDK, it belongs here.

If a type is only needed for runtime execution, persistence, or adapter
behavior, it does not belong here.
