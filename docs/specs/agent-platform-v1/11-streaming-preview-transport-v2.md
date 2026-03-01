# Streaming & Preview Transport — System Spec (V2 "AnyRun" Architecture)

**Status:** `ACTIVE_IMPLEMENTATION_SPEC`

**Objective:** A unified, event-driven, zero-trust transport architecture for real-time agent devboxes. This replaces HTTP polling, embedded IDE servers, and direct browser-to-provider routing with a gateway-controlled daemon transport.

## 0. Clean-Slate Mandate

- **VS Code server is removed** from the target architecture.
- **HTTP polling is banned** for runtime freshness surfaces (terminal, changes, services, preview readiness).
- **Browser never sees provider tunnel URLs** (`*.e2b.dev` or equivalent).
- **`sandbox-daemon` replaces `sandbox-mcp` and in-sandbox Caddy** as the runtime transport/control component.

## 1. Transport Topology Decision (Single Source of Truth)

This spec uses one network model for runtime transport:

1. **Browser -> Gateway (Hop 1):**
- Browser uses stable Gateway endpoints only:
- `WSS /v1/sessions/:sessionId/stream`
- `HTTPS /v1/sessions/:sessionId/fs/*`
- `HTTPS :previewPort-:sessionId--preview.<gateway-domain>/*` (wildcard preview host)

2. **Gateway -> Sandbox (Hop 2):**
- Gateway dials sandbox ingress via provider tunnel host.
- For E2B, host is resolved by port using `sandbox.getHost(port)`.
- Gateway signs each request with `X-Proliferate-Sandbox-Signature` (`HMAC(method + path + body_hash + exp + nonce)`).
- `sandbox-daemon` validates signature + expiry + nonce replay cache.

Important:
- This V2 transport **does not** depend on a sandbox-initiated outbound control websocket for runtime readiness.
- Readiness is based on successful signed health check over provider ingress.
- V1 runtime compute assumes E2B ingress semantics; non-E2B provider networking is future extension work.

## 2. `sandbox-daemon` Responsibilities

`/sandbox-daemon` runs as PID 1 and owns runtime transport.

Process supervision requirement:
- Sandbox runtime must correctly reap child processes and forward signals.
- Acceptable patterns:
  - `tini`/`dumb-init` as PID 1 launching `sandbox-daemon`, or
  - daemon implementation explicitly handling init-style reaping/signal duties.

### 2.1 Unified in-sandbox router (no Caddy)
`/sandbox-daemon` binds to one exposed sandbox port and routes in memory:
- `/_proliferate/pty/*` -> PTY attach/input/replay APIs
- `/_proliferate/fs/*` -> file tree/read/write APIs
- `/_proliferate/events` -> unified event stream feed
- `/*` -> dynamic reverse proxy to active preview app port

No runtime Caddyfile rewrite/reload loop in target architecture.

Preview proxy compatibility requirements:
- Daemon reverse proxy must preserve `Host` and forwarding headers needed by modern dev servers.
- Daemon reverse proxy must support HTTP upgrade and bidirectional websocket proxying for HMR (Vite/Next.js/Fast Refresh).

### 2.2 PTY replay contract
- Per-process ring buffer: max `10,000` lines OR `8MB`.
- Max line length: `16KB` (truncate over limit).
- Reconnect uses `last_seq` for delta replay.
- Cold restart resets daemon buffer; client falls back to durable DB history surfaces.

### 2.3 FS jail contract
- Workspace root is canonicalized by `realpath`.
- Reject null byte paths.
- Resolve target via workspace-relative path.
- Reject traversal (`..`) and absolute escapes.
- Re-check resolved symlink targets under workspace before read/write.
- `/fs/write` max payload: `10MB`.

### 2.4 Dynamic preview port discovery
- Preferred path: harness/runner explicitly registers preview intent with daemon (port + intent metadata).
- Fallback path: daemon polls `ss -tln` every `500ms` when explicit registration is unavailable.
- Track safe candidate ports and select active preview target with stability gating.
- Only proxy allowlisted preview port ranges by policy (default `3000-9999`).
- Never proxy denylisted infra/internal ports (`22`, `2375`, `2376`, `4096`, `26500`) even if in range.
- Emit `port_opened` only after stability window/health check to avoid short-lived test-port flicker.
- Emit `port_closed` on durable closure.
- Gateway maps preview requests by host pattern (`:previewPort-:sessionId--preview`) to target session and safe port.

### 2.5 Daemon runtime modes
- `sandbox-daemon --mode=worker`:
  - Full PTY + FS + preview port watchers + agent stream ingestion.
- `sandbox-daemon --mode=manager`:
  - Minimal transport/control mode for lean manager sandboxes.
  - No FS watcher and no preview port watcher loops by default.

## 3. Unified Event Protocol

All runtime streams are multiplexed through one versioned envelope:

```json
{
  "v": "1",
  "stream": "pty_out | fs_change | agent_event | port_opened | sys_event",
  "seq": 1045,
  "event": "data | close | error",
  "payload": { "text": "npm install complete\\n" },
  "ts": 1708123456789
}
```

Backpressure:
- Per-client queue cap in Gateway: `1000` messages OR `2MB`.
- On overflow, disconnect slow consumer (`1011`) without affecting other viewers.

Gateway horizontal scale contract:
- Separate control-plane and data-plane streaming:
  - Control-plane events (invocation status, approvals, session state) may use shared backplane.
  - Data-plane events (`pty_out` and other high-frequency runtime streams) stay on session owner gateway path.
- Multiple gateway replicas require a shared control backplane (Redis Pub/Sub or equivalent).
- Session owner gateway maintains primary daemon data stream attachment.
- Browser connections must resolve to session owner gateway (owner lookup + redirect/proxy/consistent-hash strategy).
- Sticky sessions can improve locality but are not a complete correctness mechanism.
- On owner loss, ownership transfers and new owner reattaches using replay/reconciliation contracts.

Initial hydration requirement:
- Before applying websocket deltas, UI must fetch baseline runtime state:
  - `GET /v1/sessions/:id/fs/tree`
  - `GET /v1/sessions/:id/preview/ports`
- Websocket events are deltas layered on top of this baseline.

Reconnect reconciliation requirement:
- On daemon/harness reconnect after pause/resume, runtime must fetch pending invocation outcomes from gateway (for example approvals resolved while sandbox slept).
- Resume correctness must not depend solely on in-flight websocket push events.

## 4. E2B-Specific Contracts (from docs)

### 4.1 Ingress host resolution
- E2B requires explicit port host resolution (`getHost(port)`).
- Gateway resolves host by daemon ingress port for runtime transport.
- Preview traffic is routed through daemon reverse-proxy path on the same ingress endpoint.

### 4.2 Pause/resume behavior
- `betaPause()` persists filesystem + memory state.
- Reconnect via `connect()` resumes paused sandbox.
- While paused, in-sandbox services are unreachable and client connections are dropped.
- After resume, clients must re-establish stream/proxy connections.

### 4.3 Auto-pause
- Auto-pause may be enabled for idle cost control.
- Default idle timeout for this spec pack is `10m`.
- Gateway/runtime must treat paused sandboxes as expected reconnect events, not hard failures.

## 5. Provider Contract

V1 provider contract:
- Sandbox compute provider is E2B only.

Future provider extension contract:
- Any additional provider used with this architecture must support:
- inbound HTTP/WS tunnel to sandbox daemon port,
- websocket upgrades,
- low-latency request/response for interactive transport.

- If provider cannot satisfy these transport primitives, it is out of contract.

## 6. Billing and Telemetry Intercept Requirements

Gateway is not a dumb pipe. `event-processor` must extract runtime telemetry from `agent_event` frames for UX/observability and compute lifecycle accounting.

Metering contract:
- LLM token billing truth is owned by LiteLLM spend ingestion (`15-llm-proxy-architecture.md`).
- Gateway stream frames must not be the source-of-truth for billable token usage.
- Gateway records compute lifecycle cut points and correlation metadata.

On terminal/final state, Gateway writes compute-side billing outbox/event rows for worker reconciliation.

## 7. Success Metrics (SLOs)

Measured at Gateway with OpenTelemetry, aggregated in Datadog/Prometheus (rolling 5-minute windows):

1. Attach time (`p95`) < `150ms`
2. PTY replay recovery (`p95`) < `100ms`
3. FS read roundtrip (`p95`) < `150ms`
4. FS change -> UI event delivery (`p95`) < `50ms`
5. Idle memory reduction vs old code-server baseline > `150MB`

## 8. Implementation File Map (Target-State Owners)

```text
apps/gateway/src/
  api/proliferate/ws/           # unified stream endpoint
  api/proxy/                    # fs/preview/terminal proxy surfaces
  api/proliferate/http/         # runtime reconciliation endpoints
  hub/session-runtime.ts        # runtime ensure + reconnect
  hub/event-processor.ts        # event normalization + metering intercept
  hub/backplane.ts              # cross-replica stream fanout

packages/shared/src/providers/
  e2b.ts                        # provider tunnel host resolution
  modal-libmodal.ts             # alternate provider parity

packages/sandbox-daemon/        # new daemon package (replaces sandbox-mcp)
  src/server.ts
  src/pty.ts
  src/fs.ts
  src/ports.ts
  src/router.ts
```

## 9. Core Data Model Surfaces

| Model | Why transport cares | File |
|---|---|---|
| `sessions` | runtime tunnel/daemon metadata, status, reconnect context | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | streamed approval/completion transitions | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `automation_runs` | streamed long-running run updates | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `billing_events` | transport-level usage metering persistence | `packages/db/src/schema/billing.ts` |
