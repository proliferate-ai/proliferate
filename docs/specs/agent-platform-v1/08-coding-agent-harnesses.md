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
- Sandbox-native git push and PR creation for repo tasks (with short-lived repo-scoped auth)

This keeps orchestration stable even if harness changes.

## V1 harness mode
Default only:
- OpenCode as coding harness
- PR ownership mode defaults to `sandbox_pr` (sandbox pushes + creates PR)

Relevant code paths:
- [opencode config helpers](/Users/pablo/proliferate/packages/shared/src/sandbox/opencode.ts)
- [opencode tools package](/Users/pablo/proliferate/packages/shared/src/opencode-tools/index.ts)
- [gateway tool route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts)
- [agent contract spec](/Users/pablo/proliferate/docs/specs/agent-contract.md)
- [sandbox provider spec](/Users/pablo/proliferate/docs/specs/sandbox-providers.md)
- [tool contract spec](/Users/pablo/proliferate/docs/specs/agent-platform-v1/16-agent-tool-contract.md)

## Harness file tree (V1)

```text
packages/shared/src/sandbox/
  opencode.ts                 # OpenCode runtime config and launch helpers
  config.ts                   # sandbox bootstrap files + defaults

packages/shared/src/opencode-tools/
  index.ts                    # tool injection contracts for coding runs

apps/gateway/src/api/proliferate/http/
  tools.ts                    # tool callback boundary into control plane

packages/services/src/actions/
  service.ts                  # side-effect path for tool-requested actions
```

## Core data models used by harness flows

| Model | Harness relevance | File |
|---|---|---|
| `sessions` | Run identity, prompt context, runtime status | `packages/db/src/schema/sessions.ts` |
| `action_invocations` | Actions requested by harness and approval outcomes | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` / `org_connectors` | Source auth lookup done by gateway/services | `packages/db/src/schema/integrations.ts`, `packages/db/src/schema/schema.ts` |
| `outbox` | Notifications from terminal run state changes | `packages/db/src/schema/schema.ts` (`outbox`) |

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
Two profiles are required:
- **Worker harness (fat sandbox):** OpenCode for coding tasks (edit/test/git flows)
- **Manager harness (lean sandbox):** lightweight orchestration loop for inbox triage, status queries, and spawning child coding runs

Manager harness responsibilities:
- read coworker inbox/events
- summarize progress and answer \"what happened\" queries
- call control-plane tools to spawn coding child runs
- avoid heavy code-editing loops

Worker harness responsibilities:
- execute concrete coding task
- run checks/tests
- produce deterministic output bundle (summary, diff, artifacts, PR metadata)
- handle git fetch/commit/push/PR using ephemeral repo credentials

PR ownership mode support:
- `sandbox_pr` (default now): worker harness creates PR from sandbox.
- `gateway_pr` (future strict mode): worker harness pushes branch; gateway creates PR.

## Async approval handoff contract

When harness requests a gateway action and receives `status=pending_approval`:
- Harness must treat it as "waiting", not failure.
- Harness must persist checkpoint state (`waiting_for_approval`, `invocationId`) and yield/exit loop cleanly.
- Harness must not busy poll.
- Session follows normal idle policy (default `10m`) and may pause.
- Gateway resume push event (`sys_event.tool_resume`) is best-effort only.
- On reconnect/resume, harness/daemon must reconcile invocation states from gateway before next reasoning step.
- Reconciliation outcomes include `approved/executed`, `denied`, `failed`, and `expired`.

Resume source-of-truth:
- Harness continuation is driven by durable worker-owned resume orchestration, not by websocket push delivery guarantees.
- Harness must assume it can wake in:
  - same resumed origin session, or
  - continuation session created after resume fallback.
- Harness must dedupe already-applied reconciliation outcomes by `invocationId`.

OpenCode continuation baseline (V1):
- Default to stateless continuation mode (no required native in-process checkpoint primitive).
- After reconciliation, restart a new reasoning turn with:
  - prior run summary
  - resolved invocation outcome
  - explicit continue instruction from control plane
- Use stateful checkpoint resume only if explicitly supported and verified in harness implementation docs.

Continuation identity contract:
- If running in continuation session, control plane must include `continuedFromSessionId` context.
- Harness must treat this as the same logical task lineage and continue from durable state, not from stale in-memory assumptions.

Invocation response handling (required):
- Harness tool adapter must consume one structured envelope:
  - `success`: inject result payload to reasoning loop
  - `failed`: inject structured error (`code`, `message`, `retryable`)
  - `pending_approval`: checkpoint + yield flow above

## Security constraints for harnesses
- Harness never receives privileged org tokens by default
- Harness may receive short-lived repo-scoped git auth for coding session lifecycle
- External side effects use gateway action invocation path
- Harness may request actions; gateway decides and executes
- OAuth and MCP credentials are resolved in control-plane services, not inside sandbox

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
