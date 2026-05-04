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

`HealthResponse.agentSeed` is a public packaging/readiness diagnostic. It must
stay low-cardinality: status, source, ownership, action, counts, target, seeded
agent names, and coarse failure kind are allowed; absolute paths, raw errors,
archive names, checksums, and install logs are not.

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

Workspace and session `origin` fields are advisory provenance read models only.
They must not be used as authority for authorization, billing, mutability,
sandbox ownership, MCP inheritance, or policy selection.

### `sessions.rs`

Owns session-facing transport types:

- session summary
- create and reconfigure requests
- optional resume request body
- redacted MCP binding summary read models
- prompt request and response
- interaction resolution request

`PromptInputBlock` is the client-to-runtime prompt shape. Plan handoff uses
`PromptInputBlock::PlanReference` with only `planId` and `snapshotHash`; the
runtime must resolve the trusted plan snapshot from its own store before any
agent input is produced. Clients must not send plan markdown as authority.
Image and embedded resource prompt blocks may carry optional attachment
`source` metadata (`upload` or `paste`). Source is display metadata only and
must not be used as an authorization, trust, or storage boundary.

Prompt provenance is a read-only display model on transcript user-message
payloads and pending-prompt summaries/events. Public prompt request bodies must
not accept provenance as trusted input. The public variants are deliberately
bounded to display-safe `agentSession`, `subagentWake`, and `system` shapes;
internal automation provenance is redacted or omitted rather than exposed
directly.

`Session.mcpBindingSummaries` is a non-secret launch-time read model. It may
describe which MCP bindings were applied or not applied, but it must not carry
URLs, headers, env vars, command args, absolute paths, tokens, or raw error
strings. `null` means the session predates this read model or the state is
unknown; it does not mean the session had no MCP bindings.

`ResumeSessionRequest` must remain backwards-compatible with no body and `{}`.
When present, it may carry refreshed secret-bearing `mcpServers` plus matching
redacted `mcpBindingSummaries`; runtime liveness remains authoritative for
whether those refreshed bindings are persisted.

`CreateSessionRequest.subagentsEnabled` is a create-time session policy.
Omitted values default to enabled for compatibility. Resume requests do not
carry this flag; resumed sessions use their persisted policy.

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

`SessionEvent::SubagentTurnCompleted` is a metadata notification, not a
transcript item. SDK reducers and UI consumers should not render it as assistant
or user content by default. It tells a parent session that one owned child
session completed a turn and carries the durable `completionId`, `sessionLinkId`,
child identifiers, child last event seq, outcome, and optional label.

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

`ContentPart::ProposedPlan` and `ContentPart::PlanReference` intentionally
represent different workflows even though they carry the same immutable plan
snapshot fields. `ProposedPlan` is agent-emitted transcript content with
decision UI. `PlanReference` is a user-prompt echo showing that a stored plan
snapshot was attached to a prompt.
`ContentPart::Image` and `ContentPart::Resource` may echo attachment `source`
metadata so clients can render uploaded and pasted resources differently
without inferring behavior from names or URIs.

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

## Mobility Archive Rule

Workspace mobility archives are public transport. If a workspace contains a
subagent graph, the archive must preserve `session_links` and
`session_link_completions` plus pending `session_link_wake_schedules` when both
linked sessions are included. Export must block with a clear preflight error
when only one side of a subagent link would be moved, because importing a
partial graph would break child ownership and parent wake behavior.
