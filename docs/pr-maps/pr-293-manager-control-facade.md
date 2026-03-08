# PR #293 — Manager Control Facade & Durable Facts

**Branch:** `feat/unified-harness-pr2-manager-compat-stabilization`
**Status:** Open | **Base:** #292
**Stats:** +1970 / -103 (32 files)

## What it does

Decouples manager orchestration from localhost HTTP loopback. Manager tool calls (spawn child, invoke action, etc.) now go through an in-process facade when co-located in the gateway. Also introduces durable runtime fact persistence for session reconnect.

## Mental model

```
Before:
  Manager tools ──HTTP localhost:8787── Gateway API ── SessionHub

After:
  Manager tools ──direct call── ManagerControlFacade ── SessionHub
                                (in-process, no network)
```

## Key changes

- **Added**: `manager-control-facade.ts` (239 lines) — in-process boundary for child-session + action operations
- **Added**: `manager-runtime-service.ts` (40 lines) — bridges manager sandbox lifecycle with ACP
- **Added**: `sandbox-agent-v1/adapter.ts` + `client.ts` — V1 agent coding adapter (transitional)
- **SessionHub**: persists durable facts (`tool_start`, `tool_end`, approvals, errors) to `session_events`
- **Init workflow**: falls back to replaying durable facts when live runtime unavailable (+ 99 lines of tests)
- **Web**: `coding-message-normalizer.ts` maps daemon events → workspace_state messages (+ unit tests)
- **Manager memory**: injects `$MANAGER_MEMORY_DIR` and memory.md guidance into wake-cycle prompts

## Why it matters

Eliminates network overhead for manager tool calls. Durable facts enable reliable reconnect without making Postgres the transcript authority.
