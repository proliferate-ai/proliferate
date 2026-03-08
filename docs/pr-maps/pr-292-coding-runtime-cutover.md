# PR #292 — Coding Runtime Cutover to Sandbox Agent

**Branch:** `feat/unified-harness-pr1-core-runtime-cutover`
**Status:** Open | **Base:** main
**Stats:** +1406 / -1304 (37 files)

## What it does

Replaces the custom OpenCode SSE bridge with Rivet's Sandbox Agent binary (v0.2.2, Apache 2.0). The daemon becomes pure platform transport (PTY, FS, ports). Agent lifecycle moves to the sandbox-agent process via ACP (Agent Communication Protocol).

## Mental model

```
Before:
  Gateway ──SSE── Daemon (OpenCode bridge + platform) ──── OpenCode process

After:
  Gateway ──SSE── Sandbox Agent (ACP, port 2468)   ← agent lifecycle
          ──SSE── Daemon (platform only)            ← PTY, FS, ports
```

## Key changes

- **Deleted**: `opencode-bridge.ts` (298 lines), `opencode/client.ts` (588 lines), `opencode/adapter.ts`, daemon `--mode` flag
- **Added**: `sandbox-agent-v2/adapter.ts` (dual-SSE), `sandbox-agent-v2/client.ts` (ACP HTTP), `sandbox-agent-v2/event-mapper.ts` (ACP JSON-RPC → RuntimeDaemonEvent)
- **Added**: `EventSequencer` class — monotonic ordering, stale-binding filtering, dedup via `sourceEventKey` (13 tests)
- **E2B template**: installs sandbox-agent binary, Caddy proxies `/v1/*` to port 2468
- **Contracts**: `HarnessEngine` gains `"pi"` value; `RuntimeDaemonEvent` gains `bindingId`, `sourceEventKey`

## Why it matters

Single protocol (ACP) for both coding and manager runtimes. Daemon is simplified. Event sequencing makes reconnects safe.
