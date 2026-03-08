# PR #302 — Pi Manager Implementation & Fixes

**Branch:** `feat/unified-harness-pr3-pi-manager-spec-freeze`
**Status:** Open | **Base:** #294
**Stats:** +4467 / -1950 (same branch, incremental fixes on top of #294)

## What it does

Implementation fixes and review feedback on top of #294. Addresses PR review comments, fixes Pi event mapping bugs (tool args extraction, output handling), adds direct manager prompts, fixes ACP timeouts, and various stabilization work.

## Key commits (on top of #294)

1. `feat: wire manager control facade and workspace compatibility mapping`
2. `feat: persist runtime facts and use durable init fallback`
3. `test: cover durable init fallback transcript behavior`
4. `docs: freeze Pi manager runtime contract`
5. `fix: address PR #294 review comments` (x2)
6. `fix: Pi event mapping, direct manager prompts, and ACP timeout`
7. `fix: persist message history in-memory for page reload`
8. `fix: eager-start manager session after sending directive`
9. `fix: consume pending directives when wake cycle completes`
10. `fix: extract tool args and output from Pi ACP events`
11. `chore: codebase cleanup pass against coding standards`

## Key fixes

- **Tool args**: Pi sends `rawInput: {}` in initial `tool_call`, then populated `rawInput` in `tool_call_update` — mapper now handles this two-phase pattern
- **Tool output**: Pi puts output in `rawOutput.output` (string), not `rawOutput.content[]` — added `extractToolOutput()` helper
- **Direct prompts**: manager sessions can now receive prompts directly via ACP (removed throw)
- **Directive consumption**: pending directives are consumed when wake cycle completes
- **Eager start**: manager session eager-starts after user sends a directive

## Why it matters

Makes the Pi manager actually work end-to-end. Fixes the impedance mismatch between Pi's ACP event format and the gateway's expected event shape.
