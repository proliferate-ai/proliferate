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

## Required responsibilities

### 1) Session runtime control
- Ensure sandbox runtime is ready
- Maintain stream lifecycle and reconnect behavior
- Expose runtime status to clients
- Enforce immutable run/session `boot_snapshot` during runtime and policy checks

### 2) Action invocation boundary
- List available actions
- Invoke action
- Approve/deny invocation
- Emit invocation status updates

### 3) Policy/identity checkpoint
Before side effects:
- Validate action params
- Resolve mode (`allow`, `require_approval`, `deny`)
- Resolve execution identity/credential owner
- Revalidate delayed invocations after approval and before execution

### 4) Durable persistence
- Persist invocation rows and status transitions
- Persist tool/action outputs needed for audit and UI replay

### 5) Live fanout
- Broadcast runtime and invocation updates over websocket
- Allow multi-viewer visibility for same session

## DB-first + stream-attach UX split

### Org and inbox pages
- Read durable tables first
- No streaming dependency for basic visibility

### Session detail page
- Load persisted state first
- Attach websocket stream for live detail

This prevents dashboards from breaking when streams reconnect.

## Failure behavior
Gateway must be explicit about:
- Disconnected runtime
- Invocation pending approval
- Invocation denied
- Provider/integration execution error

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
- [ ] Gateway evaluates runtime permissions against immutable `boot_snapshot`
- [ ] Post-approval revalidation is enforced before executing pending actions
