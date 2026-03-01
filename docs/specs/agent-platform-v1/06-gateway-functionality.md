# Gateway Functionality (Runtime Bus)

## Goal
Make gateway the single runtime execution layer for agent actions and session streaming.

## Product-level role
Gateway is where "work" happens at runtime:
- Accept tool/action requests from running sessions
- Resolve policy and approvals
- Execute integrations server-side
- Persist invocation results
- Push live status to connected viewers

Current code anchors:
- [HTTP actions surface](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts)
- [tools route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)
- [session runtime](/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts)
- [session hub](/Users/pablo/proliferate/apps/gateway/src/hub/session-hub.ts)
- [event processor](/Users/pablo/proliferate/apps/gateway/src/hub/event-processor.ts)

## Gateway file tree (runtime-critical paths)

```text
apps/gateway/src/
  api/proliferate/http/
    actions.ts                # action invoke/approve/deny + reconcile read endpoint
    sessions.ts               # session lifecycle endpoints used by clients
    tools.ts                  # tool surface and callback handling
  api/proxy/
    devtools.ts               # runtime proxy surfaces
    terminal.ts               # terminal websocket proxy
  hub/
    session-hub.ts            # per-session fanout and client coordination
    session-runtime.ts        # provider runtime ensure/reconnect
    event-processor.ts        # stream normalization + telemetry/compute metering intercept
    backplane.ts              # cross-replica pub/sub fanout bridge
```

## Core data models gateway reads/writes

| Model | Gateway usage | File |
|---|---|---|
| `sessions` | status transitions, runtime metadata (`sandboxId`, tunnel urls, telemetry) | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | side-effect lifecycle and approvals | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` / `org_connectors` | action source resolution and auth lookup context | `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` |
| `outbox` | downstream async notifications/events after runtime transitions | `packages/db/src/schema/schema.ts` (`outbox`) |

## Required responsibilities

### 1) Session runtime control
- Ensure sandbox runtime is ready
- Maintain stream lifecycle and reconnect behavior
- Expose runtime status to clients
- Enforce immutable session core + capability bindings during runtime and policy checks

### 2) Action invocation boundary
- List available actions
- Invoke action
- Approve/deny invocation
- Emit invocation status updates
- Applies to non-git side effects; sandbox-native git push/PR path follows coding harness contract
- If PR ownership mode is `gateway_pr` (future strict mode), gateway also owns PR creation side effect
- Enforce tool contract envelopes defined in `16-agent-tool-contract.md`

### 3) Policy/identity checkpoint
Before side effects:
- Validate action params
- Resolve mode (`allow`, `require_approval`, `deny`)
- Resolve execution identity/credential owner
- Revalidate delayed invocations after approval and before execution

Approval resume ownership contract:
- Gateway owns live runtime signaling and invocation persistence.
- Worker owns durable approval-triggered resume orchestration via claimed `resume_intent` rows/outbox.
- Gateway push (`sys_event.tool_resume`) is best-effort and never the source-of-truth resume mechanism.
- Resume intent is emitted only for final invocation outcomes tied to waiting origin executions (`completed|failed|denied|expired`).
- Intermediate `approved` does not emit resume intent.

Approval-wait response contract:
- On `require_approval`, gateway persists pending state and returns immediate suspended response (`202` semantic).
- Response payload must be structured as `status=pending_approval` + `invocationId` + summary context.
- Harness writes checkpoint and yields; gateway must not require long-held open request sockets.
- Session may remain running until idle timeout; standard idle pause (`10m`) handles hibernation.
- On approval/deny, gateway emits a deterministic resume event (`sys_event.tool_resume`) with invocation outcome for harness continuation.
- Because paused sandboxes drop connections, harness/daemon must reconcile pending invocation states on reconnect (pull-based sync), not rely only on pushed resume events.
- Pending approval rows auto-expire after `24h`; expiration outcome must be included in reconciliation responses.

Reconciliation read contract:
- Gateway exposes deterministic reconciliation endpoint (see `16-agent-tool-contract.md`):
  - `GET /api/proliferate/http/actions/reconcile?sessionId=:id&after=:cursor`
- Response ordering is stable (`updatedAt`, `invocationId`) and idempotent for repeated reads.
- Harness reconciliation is mandatory before continuing reasoning after reconnect/resume from waiting state.

Resume orchestration contract (worker-owned):
1. Worker claims durable `resume_intent` (unique on `(origin_session_id, invocation_id)`).
2. Worker attempts to resume the same paused origin session first.
3. On transient provider/runtime failures, retry with bounded exponential backoff (default 3 attempts).
4. On permanent failure (for example sandbox missing) or exhausted retries, create one continuation session and inject reconciliation outcome.
5. If continuation bootstrap fails, mark `resume_failed` durably and emit notifications.

Resume timeout contract:
- No separate expiry for resume intents in V1.
- Resume orchestration terminates in `satisfied`, `continued`, or `resume_failed`, bounded by run/session deadline policy.

### 4) Durable persistence
- Persist invocation rows and status transitions
- Persist tool/action outputs needed for audit and UI replay

### 5) Live fanout
- Broadcast runtime and invocation updates over websocket
- Allow multi-viewer visibility for same session

Horizontal scale contract:
- Split runtime traffic into:
  - Control stream: low-volume lifecycle/invocation events (approval state, status changes, coordination).
  - Data stream: high-volume PTY/FS/runtime byte streams.
- Use shared backplane (Redis Pub/Sub or equivalent) for control stream only.
- Do not publish raw PTY/FS high-throughput frames to Redis backplane by default.
- Each session has an owner gateway replica for daemon data-plane connection.
- Browser stream attachment must route to owner gateway (consistent hash, owner lookup + redirect/proxy, or equivalent).
- Sticky sessions may be used as optimization but are not sufficient as sole correctness mechanism.
- On owner failover, new owner reattaches runtime and resumes using replay/reconciliation semantics.

### 6) Metering and telemetry intercept
- Parse runtime `agent_event` frames for observability and realtime UX telemetry
- Persist deterministic compute lifecycle cut points (`start`, `pause`, `resume`, `end`) for billing
- Do not create billable LLM token events from stream frames
- LLM token billing truth comes from LiteLLM spend ingestion (`15-llm-proxy-architecture.md`)

## DB-first + stream-attach UX split

### Org and inbox pages
- Read durable tables first
- No streaming dependency for basic visibility

### Session detail page
- Load persisted state first
- Attach websocket stream for live detail

This prevents dashboards from breaking when streams reconnect.

Streaming contracts for terminal/code/preview transport are detailed in:
- [11-streaming-preview-transport-v2.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/11-streaming-preview-transport-v2.md)
- [canonical streaming spec](/Users/pablo/proliferate/docs/specs/streaming-preview.md)
- [16-agent-tool-contract.md](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)

## Failure behavior
Gateway must be explicit about:
- Disconnected runtime
- Invocation pending approval
- Invocation denied
- Provider/integration execution error
- Suspended-waiting-for-approval status with deterministic resume path
- Reconnect reconciliation failures (for pending invocation/status pull)
- Resume orchestration state transitions (`resume_queued`, `resuming`, `continued`, `resume_failed`) from durable DB state

Each must have clear status and retry path.

## Non-goals (V1)
- Turn gateway into main CRUD API surface
- Embed business policy in frontend code
- Direct sandbox-to-external integration calls

## Definition of done checklist
- [ ] Gateway is the only runtime action bus
- [ ] Side effects require policy resolution before execution
- [ ] Invocation rows persist all status transitions
- [ ] Websocket broadcasts include pending/completed/failed states
- [ ] DB-first org dashboard + live session detail split is implemented
- [ ] Gateway evaluates runtime permissions against immutable session contract
- [ ] Post-approval revalidation is enforced before executing pending actions
- [ ] Gateway route handlers remain transport-only and do not import Drizzle models directly
- [ ] Gateway stream telemetry does not directly write billable LLM token events
