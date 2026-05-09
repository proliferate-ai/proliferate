# AnyHarness Phase 1 Gatekeeper Report

Status: blocked pending implementation lane diffs.

Date: 2026-05-08

Gatekeeper branch:

```text
proliferate/anyharness-phase1-gatekeeper
```

Gatekeeper worktree:

```text
/Users/pablo/.proliferate/worktrees/proliferate/ah-phase1-gatekeeper
```

## Scope

This lane reviews AnyHarness Phase 1 work for ownership correctness and merge
readiness. It should not implement broad migrations. Small import, doc, or
check fixes are acceptable only when they are clearly safe.

Phase 1 is limited to low-risk topology moves:

- adapter topology: `files`, `git`, `hosting`, `processes` toward
  `adapters/**`
- generic MCP JSON-RPC/protocol helper extraction toward `integrations/mcp/**`
- generic MCP capability-token helper extraction toward `integrations/mcp/**`
- isolated agent CLI/provider mechanics toward `integrations/agent_cli/**`

Explicit exclusions:

- `anyharness/crates/anyharness-lib/src/sessions/runtime.rs`
- `anyharness/crates/anyharness-lib/src/sessions/store.rs`
- `anyharness/crates/anyharness-lib/src/acp/session_actor.rs`
- `anyharness/crates/anyharness-lib/src/acp/event_sink.rs`
- session MCP assembly redesign
- MCP elicitation redesign
- public contract shape changes
- behavior changes

## Current Lane Status

The implementation lane branches currently contain no Phase 1 diffs relative to
the old docs base, and are behind current `origin/main`.

```text
proliferate/anyharness-phase1-adapters      a67d9a44  no diff present
proliferate/anyharness-phase1-mcp-helpers   a67d9a44  no diff present
proliferate/anyharness-phase1-mcp-auth      a67d9a44  no diff present
proliferate/anyharness-phase1-agent-cli     a67d9a44  no diff present
```

Phase 1 cannot be marked ready until those lanes are rebased onto current
`origin/main`, implemented, and reviewed.

## Gate Checks To Run After Lane Diffs Exist

Run these from the merge/review worktree after applying or checking each lane:

```bash
cargo check -p anyharness-lib
git diff --check
rg "crate::(files|git|hosting|processes)::" anyharness/crates/anyharness-lib/src
rg "crate::integrations::mcp" anyharness/crates/anyharness-lib/src
git diff --name-only origin/main...HEAD -- \
  anyharness/crates/anyharness-lib/src/sessions/runtime.rs \
  anyharness/crates/anyharness-lib/src/sessions/store.rs \
  anyharness/crates/anyharness-lib/src/acp/session_actor.rs \
  anyharness/crates/anyharness-lib/src/acp/event_sink.rs
```

Expected interpretation:

- `cargo check -p anyharness-lib` must pass.
- `git diff --check` must pass.
- Old top-level adapter imports must disappear after the adapter lane, unless a
  reviewer explicitly accepts a temporary exception.
- `integrations/mcp/**` must not import product domains.
- Excluded core session files should have no diffs in Phase 1.

## Review Checklist

For every lane, classify status as pass, needs fix, or blocked.

Adapter lane:

- moved folders use final `adapters/**` paths
- no compatibility barrels remain at old top-level paths
- adapters do not import product domains, API handlers, AppState, stores, or
  live actors
- behavior-facing types and APIs stay compatible

MCP protocol helper lane:

- generic JSON-RPC parsing/response/tool formatting lives in
  `integrations/mcp/**`
- product tool handlers remain in owning product domains
- `integrations/mcp/**` imports no product domains
- `sessions/mcp.rs` and MCP elicitation are not redesigned

MCP capability-token lane:

- token format and TTL behavior remain compatible
- generic signing/validation mechanics live in `integrations/mcp/**`
- product auth wrappers keep feature-specific headers, secret names, and
  product authorization decisions
- no product MCP tool behavior moves into integrations

Agent CLI/provider lane:

- only isolated provider mechanics move into `integrations/agent_cli/**`
- catalog/readiness/install policy meaning remains in the agent domain
- credential-discovery crate is not touched
- provider behavior is unchanged

## Baseline Checks Run

These checks ran on the gatekeeper branch before lane implementation diffs were
available:

```text
cargo check -p anyharness-lib  PASS
git diff --check               PASS
```

Baseline old adapter imports still exist on current `main`; that is expected
before the adapter topology lane lands.

## Gatekeeper Decision

Current decision: blocked.

Reason: implementation lanes are not present yet. Re-run this gate after lanes
A through D produce actual diffs.
