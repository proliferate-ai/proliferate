# Phase 3: Gateway & Agent Boundary

**Branch:** `vnext/phase-3-gateway-agent`
**Base:** `main` (after Phase 2 is merged)
**PR Title:** `feat: vNext Phase 3 — gateway & agent boundary`

**Role:** You are a Staff Principal Engineer working on Proliferate.

**Context:** You are executing Phase 3. We are changing how the agent communicates with the platform by moving from SSE-intercepted tools to synchronous HTTP callbacks, hardening the Gateway for multi-instance deployments, and implementing Idle Snapshotting.

## Instructions

1. Create branch `vnext/phase-3-gateway-agent` from `main`.
2. Read the old and vNext specs for `sessions-gateway.md`, `agent-contract.md`, and `sandbox-providers.md`.
3. Rip the old SSE tool interception out of the Gateway's `EventProcessor`.
4. Build the `POST /internal/tools/:toolName` Express routes. Use `session_tool_invocations.tool_call_id` for idempotency.
5. Rewrite the sandbox tool definitions in `packages/shared/src/opencode-tools/*.ts` to make synchronous `fetch()` calls to the new Gateway route.
6. Implement `session-leases.ts` (Redis `owner:{sessionId}` and `runtime:{sessionId}` locks).
7. Implement the Idle Snapshot timer and logic inside `SessionHub` and `MigrationController` (using `mem:` prefixes for Modal).
8. Run `pnpm typecheck` and `pnpm lint` to verify everything compiles.
9. Commit, push, and open a PR against `main`.

## Critical Trap Patches (MUST IMPLEMENT)

- **The Snapshot TCP Drop:** Taking a memory snapshot freezes the container and destroys active TCP sockets. The sandbox-side tool wrapper scripts MUST catch network errors (`ECONNRESET`, `fetch failed`) and sleep/retry with the EXACT same `tool_call_id` to fetch the cached result from the Gateway when they thaw.
- **Git Freshness Post-Thaw:** In `restoreFromMemorySnapshot()`, immediately after restore succeeds, execute a stateless command against the sandbox to run `git pull --ff-only` (if enabled) before returning control to the gateway.
- **The In-Flight Executing Race Condition:** The `SessionHub` MUST keep an in-memory `Map<tool_call_id, Promise<Result>>`. If a retry arrives, `await` the existing promise instead of executing the tool twice.
- **Split-Brain Suicide:** Implement clock-drift detection in `SessionHub`. If the event loop lags (`Date.now() - lastRenewAt > LEASE_TTL`), the hub MUST synchronously self-terminate (abort in-flight work, drop WS clients, disconnect SSE).
- **False Idle Blindspot:** Track `activeHttpToolCalls` in `SessionHub`. `shouldIdleSnapshot()` MUST return false if `activeHttpToolCalls > 0` so we don't snapshot a sandbox mid-tool-execution.
- **Hub Eviction Collision:** In `runIdleSnapshot()`, after the DB is marked `paused` and the lease is released, you MUST explicitly call `HubManager.remove(sessionId)`. Do not leave the hub in memory.
- **The Automation Fast-Path:** In the `automation.complete` HTTP handler, bypass the snapshot entirely. Automations are terminal. Terminate the sandbox, update the DB, and evict the hub immediately.
