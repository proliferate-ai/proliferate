# Coding Agent Harnesses

## Goal
Support strong coding execution today with OpenCode, while keeping the system harness-agnostic so teams can use other coding agents later.

## Product requirement
Users should be able to:
- Run coding tasks with a default harness (OpenCode)
- Keep long-running orchestration independent of harness choice
- Eventually switch harness per agent/profile without replacing control plane

## Clear responsibility split

### Control plane + gateway
Owns:
- Session lifecycle
- Policy and approvals
- Credential resolution
- Audit and live events

### Coding harness inside sandbox
Owns:
- Code reasoning loop
- File edits
- Command/test execution
- Producing patch/commit output

This keeps orchestration stable even if harness changes.

## V1 harness mode
Default only:
- OpenCode as coding harness

Relevant code paths:
- [opencode config helpers](/Users/pablo/proliferate/packages/shared/src/sandbox/opencode.ts)
- [opencode tools package](/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts)
- [gateway tool route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)

## Future harness-agnostic contract
Plan for simple adapter surface:
- start(task, context)
- stream events
- stop
- collect outputs

Each harness adapter should map to common run output format:
- summary
- changed files
- checks run + results
- PR metadata links
- artifacts

## Worker profiles (recommended)
Two profiles long-term:
- Coding worker (full code tooling)
- Lean worker (non-coding analysis/orchestration)

V1 can keep one coding profile but should avoid hardcoding harness-specific assumptions into gateway/worker orchestration.

## Security constraints for harnesses
- Harness never receives privileged org tokens by default
- External side effects use gateway action invocation path
- Harness may request actions; gateway decides and executes

## UX implications
Users should not need to know harness internals.
They should configure:
- Agent purpose
- Allowed tools/capabilities
- Output/review expectations

Harness choice is advanced setting.

## Non-goals (V1)
- Perfect abstraction over all coding tools now
- Full bring-your-own harness support in first release
- Deep harness-specific UI customizations

## Definition of done checklist
- [ ] OpenCode-based coding runs are stable in E2B
- [ ] Harness logic does not bypass gateway action boundary
- [ ] Run outputs are normalized for UI and audits
- [ ] Codebase is structured to add new harness adapters later
