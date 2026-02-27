# Action Registry and Org Usage

## Goal
Create one consistent way for agents to perform side effects (GitHub, Slack, Linear, Sentry, connectors), with policy, approvals, identity, and audit handled in one place.

## Core rule
Every side-effect action goes through gateway action invocation.

Current core files:
- [gateway actions route](/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts)
- [actions service](/Users/pablo/proliferate/packages/services/src/actions/service.ts)
- [actions modes](/Users/pablo/proliferate/packages/services/src/actions/modes.ts)
- [actions db](/Users/pablo/proliferate/packages/services/src/actions/db.ts)

## Action registry model
Each action definition needs:
- `sourceId` (for example `github`, `linear`, `connector:xyz`)
- `actionId` (for example `create_pr`, `add_comment`)
- Input schema (validate params)
- Risk/mode default (`allow`, `require_approval`, `deny`)
- Execution handler (server-side)

Native and connector actions use same invocation pipeline.

## Invocation contract (V1)
Required fields:
- sessionId
- organizationId
- sourceId
- actionId
- params

Identity/control fields:
- actorUserId (nullable)
- automationId (nullable)
- requestedRunAs (`actor_user`, `org_system`, `explicit_user`)
- idempotencyKey
- reason (human-readable)

## Policy resolution model
Resolution order for V1:
1. Hard deny (org policy) always wins
2. Explicit route-level override (org/admin settings)
3. Action default mode
4. Optional per-agent/per-automation stricter override

Risk is a hint for default mode, not full policy engine.

### Parameter-aware policy checks (PBAC-lite)
Policy should evaluate both:
- action type (`sourceId` + `actionId`)
- selected high-risk parameters (for example target branch, environment, destructive flags)

This prevents treating all calls to the same action as equally safe.

## Org vs user credential usage
Separate two questions:
1. Which identity is the run using? (`run_as`)
2. Which credential owner provides the token? (`user` or `org`)

Default behavior:
- Interactive user requests prefer user credential
- Background agents prefer org credential
- Fallback from user -> org only if explicitly allowed

## Audit requirements
Every invocation must persist:
- Who requested
- Effective run-as identity
- Credential owner type used
- Source/action/params summary
- Result status and timestamps
- Approval actor (if required)

Audit row is the source of truth for approvals UI and postmortems.

### Post-approval revalidation (TOCTOU safety)
If an invocation waits for approval, Gateway must re-check before execution:
- token is still valid
- target resource still exists and is in expected state
- policy mode is still allowed for this exact request

If revalidation fails, invocation should move to failed/revalidation-required instead of executing stale parameters.

## Planned credential broker layer
Add runtime layer:
```text
/packages/services/src/credentials
  broker.ts
  access.ts
  types.ts
  providers/
```
This layer resolves and validates credentials before execution. Gateway should call broker, not integration token internals directly.

## Non-goals (V1)
- Full policy language engine
- Fine-grained parameter policy DSL
- Enterprise shared credential pools UI

## Definition of done checklist
- [ ] Single invocation path for native and connector actions
- [ ] Schema validation for action params
- [ ] Mode resolution supports allow/approval/deny
- [ ] run-as and credential-owner are resolved and persisted
- [ ] Approval/deny flows work from durable invocation rows
- [ ] Parameter-aware policy checks exist for key risky action families
- [ ] Approved invocations are revalidated before delayed execution
