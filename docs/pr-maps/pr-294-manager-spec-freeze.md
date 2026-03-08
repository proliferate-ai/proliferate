# PR #294 — Pi Manager Runtime Spec Freeze

**Branch:** `feat/unified-harness-pr3-pi-manager-spec-freeze` (same branch as #302)
**Status:** Open | **Base:** #293
**Stats:** +4467 / -1950 (122 files)

## What it does

Freezes the v1 Pi manager runtime contract as a system spec. Deletes the old gateway-local wake-cycle engine. Implements the sandbox-agent v2 event mapper for Pi's ACP event format. Large web app cleanup pass.

## Mental model

```
Spec freeze:
  Pi manager identity: engine="pi", profile="manager"
  Runs inside sandbox-agent /v1 (not gateway-local)
  Gateway owns policy/binding; Pi owns execution
  Inbox: user_prompt + scheduler_wake only
  Children: coding sessions only (no manager children)
  Storage: hidden transcript + $MANAGER_MEMORY_DIR + Postgres mirror
```

## Key changes

- **New spec**: `docs/specs/manager-agent-runtime.md` (278 lines) — frozen v1 contract
- **Deleted**: entire `wake-cycle/` directory (engine, phases, prompts, types — ~780 lines)
- **Deleted**: old `manager/adapter.ts` (484 lines), `manager/client.ts` (65 lines)
- **Added**: `event-mapper.ts` (608 lines) — handles Pi's two-phase tool events (`tool_call` with empty args, `tool_call_update` with real args), `rawOutput.output` string format
- **Added**: manager HTTP API routes (`routes.ts` 257 lines, `helpers.ts` 353 lines)
- **Web cleanup**: extracted ~10 config files from `.tsx`, replaced raw `<button>`/`alert()` with shadcn/toast, extracted URL + scope helpers

## Why it matters

Locks the normative contract so subsequent work has clear boundaries. Deletes ~1500 lines of legacy gateway-local orchestration. V2 event mapper handles Pi's quirky event format.
