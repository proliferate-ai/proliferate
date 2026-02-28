# Streaming & Preview Transport — System Spec (V2 "AnyRun" Architecture)

**Status:** `ACTIVE_IMPLEMENTATION_SPEC`

**Objective:** Unify runtime transport through Gateway and `sandbox-daemon`, remove polling/code-server-era surfaces, and enforce zero-trust hop-2 signatures.

## 1. Topology Decision

### Client -> Gateway
- Browser attaches only to Gateway endpoints (`/v1/sessions/:id/stream`, `/fs/*`) plus wildcard preview hosts (`:previewPort-:sessionId--preview.<domain>`).

### Gateway -> Sandbox
- Gateway dials provider ingress host per sandbox port.
- E2B host resolution uses `getHost(port)` with explicit port.
- Gateway strips inbound auth/cookies and injects `X-Proliferate-Sandbox-Signature`.
- `sandbox-daemon` validates HMAC, expiry, and nonce replay.
- For Kubernetes self-host, gateway routes over internal cluster networking (service DNS/pod IP), not dynamic external ingress per session.

This spec intentionally chooses ingress proxy topology (Gateway-initiated), not sandbox-initiated runtime transport.

## 2. Daemon Contract

`sandbox-daemon` (PID 1) owns:
- PTY attach/input/replay
- FS read/tree/write APIs with workspace jail
- Dynamic preview port discovery
- Unified runtime event emission
- In-memory reverse proxy to selected preview port

Preview routing contract:
- Preview requests are host-routed (wildcard subdomain), not path-prefixed.
- Daemon reverse proxy must support websocket upgrade for HMR.

Daemon modes:
- `--mode=worker`: full PTY/FS/preview watchers
- `--mode=manager`: lean transport mode without FS/preview watcher loops

Target-state removal:
- no in-sandbox Caddy runtime dependency
- no `openvscode-server`
- no `sandbox-mcp` ownership for primary runtime path

## 3. Replay and Reconnect

- PTY ring buffer cap: `10k lines` OR `8MB` + `16KB` max line.
- Reconnect uses `last_seq`.
- If sandbox/daemon restarts, replay buffer resets; UI falls back to DB-backed history.

E2B pause/resume behavior:
- `betaPause()` persists memory/filesystem.
- `connect()` resumes.
- Active network connections drop while paused; clients reattach on resume.
- Default idle timeout for this spec pack is `10m`.

## 4. Event Envelope and Backpressure

```json
{
  "v": "1",
  "stream": "pty_out | fs_change | agent_event | port_opened | sys_event",
  "seq": 1045,
  "event": "data | close | error",
  "payload": {},
  "ts": 1708123456789
}
```

Backpressure:
- Gateway per-client queue cap (`1000` msgs or `2MB`).
- Slow consumer disconnected (`1011`) without global fanout impact.

Hydration:
- UI must fetch initial fs tree and preview ports before applying websocket deltas.

## 5. Billing/Metering Intercept

`apps/gateway/src/hub/event-processor.ts` parses runtime usage frames for observability/realtime UX and records compute lifecycle boundaries.

LLM token billing source-of-truth:
- LiteLLM spend ingestion pipeline is authoritative for billable token usage.
- Stream frame usage hints are non-authoritative and must not be used to generate billable token events.

## 6. Security Requirements

- No browser direct access to provider tunnel URLs.
- No forwarding client `Authorization` headers to sandbox.
- No long-lived privileged org credentials inside sandbox by default.
- FS APIs enforce workspace jail and symlink escape protection.
- Preview proxy uses allowlisted port ranges (default `3000-9999`) with explicit internal denylist.

## 7. File Ownership

- Gateway runtime/transport:
  - `apps/gateway/src/hub/session-runtime.ts`
  - `apps/gateway/src/hub/event-processor.ts`
  - `apps/gateway/src/api/proxy/*`
- Provider ingress host resolution:
  - `packages/shared/src/providers/e2b.ts`
- Daemon implementation target:
  - `packages/sandbox-daemon/*`

## 8. Core Data Surfaces

- `sessions` (`packages/db/src/schema/sessions.ts`)
- `actionInvocations` (`packages/db/src/schema/schema.ts`)
- `automationRuns` (`packages/db/src/schema/schema.ts`)
- `billingEvents` (`packages/db/src/schema/billing.ts`)
