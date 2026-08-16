# Codex App Server JSON schema (pinned ground truth)

Pinned from the **exact shipped native Codex binary**, per the Forks ADR rung 1
obligation to "regenerate and pin the App Server JSON schema from the exact
shipped native binary" so the Codex fork bridge (rung 3) builds on a verified
`thread/fork` shape rather than second-hand notes.

These files are generated evidence. Do not hand-edit; regenerate instead.

## Provenance

| Field | Value |
| --- | --- |
| Tool | `codex app-server generate-json-schema --out <DIR>` |
| Native binary | `codex-cli 0.147.0` (matches canonical adapter's declared `@openai/codex ^0.147.0`) |
| Binary path | `~/.codex/packages/standalone/releases/0.147.0-aarch64-apple-darwin/bin/codex` |
| Binary sha256 | `19c4f144c5226a9f17c58e6f0fa854843b0f77a6eb420f40e2745a12f10f5d37` |
| Generated | 2026-08-16 |
| Reproducibility | `ThreadForkParams` byte-identical across two consecutive generations |

## Files

- `codex_app_server_protocol.v2.schemas.json` — the authoritative aggregate v2
  App Server protocol schema (contains every request/response/notification type,
  including `ThreadForkParams`).
- `ThreadForkParams.v2.json` — the fork request shape, extracted for review focus.
- `ThreadForkResponse.v2.json` — the fork response shape.

## Regenerate

```sh
codex app-server generate-json-schema --out /tmp/codex-schema-out
cp /tmp/codex-schema-out/codex_app_server_protocol.v2.schemas.json fixtures/contracts/codex-app-server-schema/
cp /tmp/codex-schema-out/v2/ThreadForkParams.json  fixtures/contracts/codex-app-server-schema/ThreadForkParams.v2.json
cp /tmp/codex-schema-out/v2/ThreadForkResponse.json fixtures/contracts/codex-app-server-schema/ThreadForkResponse.v2.json
```

## Ground-truth shape of `ThreadForkParams` (rung 3 anchor contract)

`ThreadForkParams` has **14 properties**, one required (`threadId`):

```
approvalPolicy, approvalsReviewer, baseInstructions, config, cwd,
developerInstructions, ephemeral, lastTurnId, model, modelProvider,
sandbox, serviceTier, threadId, threadSource
```

The **fork anchor is `lastTurnId`** — documented in the schema as:

> "Optional last turn id to fork through, inclusive. When specified, turns after
> `last_turn_id` are omitted from the fork. The referenced turn cannot be in
> progress."

This is exactly the inclusive fork-through-a-turn semantics the ADR's boundary
model needs. `ephemeral`, `threadSource`, and `threadId` are also present.

## Contradiction with the frozen ADR (raised, not silently rescoped)

The frozen Forks ADR (§3.1, §3.2, §4.1(b), §4.3) asserts the App Server ships a
"complete `thread/fork` (20-field `ThreadForkParams` including `beforeTurnId`,
`excludeTurns`, `ephemeral`, `threadSource`)" and lists the Codex anchor as
`beforeTurnId`. Regeneration from the exact shipped native binary
(`codex-cli 0.147.0`) shows:

- **14 properties, not 20.**
- **No `beforeTurnId`** anywhere in the generated schema (0 matches across all
  248+ generated files).
- **No `excludeTurns`** anywhere.
- The inclusive anchor is **`lastTurnId`**.

This matches the ADR's own Aug-9 evidence and contradicts its Aug-11 "live probe
found the full 20-field shape including beforeTurnId" note (§3.2). The ADR's
fallback wording already anticipates this — §4.3 says the Codex anchor is the
"preceding turn id (inclusive `lastTurnId`/`beforeTurnId` per the qualified
schema)". Per that clause the qualified schema settles it: **rung 3's Codex
fork bridge must anchor on `lastTurnId` (inclusive), not `beforeTurnId`.** No
`excludeTurns` capability exists, so any design leaning on it must be revisited.
