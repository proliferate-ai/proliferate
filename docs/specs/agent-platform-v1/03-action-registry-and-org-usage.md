# Action Registry and Org Usage

## Goal
Create one execution boundary for all side effects (GitHub, Sentry, Linear, Slack, MCP tools) where policy, identity, OAuth resolution, approval, and audit are handled consistently.

This is the main difference between "agent can think" and "agent can safely do work".

## Scope
In scope:
- Action catalog listing for a session/coworker
- Action invocation + mode resolution (`allow`, `require_approval`, `deny`)
- OAuth token resolution and MCP connector auth resolution
- Sandbox-native git credential policy (short-lived, repo-scoped)
- GitHub PR ownership mode policy (`sandbox_pr` vs `gateway_pr`)
- Org-wide vs personal integration behavior
- Approval and post-approval revalidation
- Audit and status visibility

Out of scope:
- Trigger ingestion mechanics (see `05-trigger-services.md`)
- Session boot/runtime internals (see `06-gateway-functionality.md` and `11-streaming-preview-transport-v2.md`)

## Implementation file tree (must-read)

```text
apps/gateway/src/api/proliferate/http/
  actions.ts                 # invoke/approve/deny/status surfaces

packages/services/src/actions/
  service.ts                 # mode resolution + invocation lifecycle
  db.ts                      # action invocation persistence
  modes.ts                   # policy source resolution
  connectors/                # MCP connector action source adapters

packages/services/src/integrations/
  service.ts                 # integration lifecycle
  tokens.ts                  # OAuth token resolution boundary
  github-app.ts              # GitHub App installation token path

packages/services/src/connectors/
  service.ts                 # org connector CRUD and validation
  db.ts                      # org connector persistence

packages/services/src/secrets/
  service.ts                 # secret resolution for connector auth
```

Reference docs:
- `docs/specs/actions.md`
- `docs/specs/integrations.md`
- `docs/sim-architecture-spec.md` (for control-plane credential handling pattern)

## Core data models

| Model | Purpose | File |
|---|---|---|
| `action_invocations` | Durable record of requested/executed/approved/denied side effects | `packages/db/src/schema/schema.ts` (`actionInvocations`) |
| `integrations` | OAuth/GitHub-App references by org | `packages/db/src/schema/integrations.ts` |
| `org_connectors` | Org-scoped MCP connector definitions | `packages/db/src/schema/schema.ts` (`orgConnectors`) |
| `organization.action_modes` | Org policy overrides for `sourceId:actionId` keys | `packages/db/src/schema/schema.ts` |
| `automations.action_modes` | Coworker-level stricter policy overrides | `packages/db/src/schema/schema.ts` |
| `outbox` | Async notifications for approval/state transitions | `packages/db/src/schema/schema.ts` (`outbox`) |

Minimum invocation fields to persist:
- `organizationId`, `sessionId`, `sourceId`, `actionId`, `params`
- `mode`, `modeSource`
- `actorUserId`, `requestedRunAs`, `credentialOwnerType`
- `status`, `approvedBy`, `approvedAt`, `executedAt`, `error`

## Action source architecture

### One catalog, two source types
1. Provider actions:
- Built-in adapters for GitHub/Linear/Sentry/Slack class operations
- Definitions and schemas owned in provider/action modules

2. Connector actions (MCP):
- Discovered from org connector tools list (`tools/list`)
- Wrapped into the same `sourceId/actionId` runtime contract
- Executed through server-side connector client, never direct sandbox secret use

The runtime pipeline is unified after source resolution.

## OAuth and MCP credential path (required behavior)

### OAuth-backed actions
- Integration rows store connection references, not raw token material for Nango-managed providers.
- Runtime obtains fresh token server-side via `packages/services/src/integrations/tokens.ts:getToken`.
- GitHub App path mints short-lived installation tokens server-side (`github-app.ts`).
- Sandbox never receives long-lived OAuth secrets.

### MCP connector-backed actions
- Connector config is org-owned (`org_connectors`).
- Auth material resolves from server-side secret storage (`packages/services/src/secrets/service.ts`).
- Gateway/service opens MCP client session and executes tool call.
- Sandbox only receives action results, not connector credentials.

This follows the same control-plane secret boundary that strong enterprise systems use.

## Sandbox-native git operations (explicit V1 exception)

Allowed in sandbox:
- `git fetch/pull/commit/push`
- PR creation from sandbox tooling (default mode)

Required constraints:
- Credentials must be short-lived and repo-scoped.
- Credentials are minted server-side and injected only for session runtime.
- No long-lived org action secrets are injected for this path.
- Non-git side effects (for example ticket changes, deploy actions, analytics writes) stay in gateway action execution path.
- Audit must still record actor, run identity, repo, and resulting PR metadata.

## GitHub PR ownership mode (policy toggle)

`sandbox_pr` (V1 default):
- Sandbox creates PR directly after push using short-lived repo-scoped credential.
- Fastest path; minimal control-plane orchestration.

`gateway_pr` (future strict mode):
- Sandbox pushes branch only.
- Sandbox emits PR-create request to gateway action boundary.
- Gateway creates PR server-side with policy-controlled identity.

Mode requirements:
- PR ownership mode is explicit and must be frozen in run/session `boot_snapshot`.
- Mid-run mode changes do not affect in-flight run behavior.

## Invocation flow (end to end)

### 1) List available actions
1. Resolve session org + identity
2. Load built-in provider actions
3. Load enabled org connectors and discover tools
4. Apply source/user visibility and policy hints
5. Return normalized list with schema + mode hints

### 2) Invoke action
1. Validate input schema
2. Resolve mode in deterministic order:
- automation override
- org override
- default risk mode
3. Create invocation row
4. If `deny`: persist denied + return
5. If `require_approval`: persist pending + emit notification + return suspended response immediately
6. If `allow`: execute immediately via provider/connector adapter
7. Persist final status and output summary

### 3) Approve/deny pending invocation
1. Validate approver role
2. Transition pending row
3. Revalidate before execution (TOCTOU)
- token still valid
- target state still valid
- policy still permits this exact request
4. Execute or fail with revalidation error
5. Persist final state + broadcast update

Revalidation precedence contract (required):
- Frozen `boot_snapshot` remains source-of-truth for run intent (prompt/tooling/run identity defaults).
- Live org security state is source-of-truth at execution time:
  - integration/token revocations
  - org kill switches / connector disablement
  - credential validity/expiry
- If live security state is stricter than frozen snapshot, execution must fail closed.

## Invocation state machine and idempotency

Allowed transitions:
- `pending` -> `approved` -> `executing` -> `completed|failed`
- `pending` -> `denied`
- `pending` -> `expired`
- `approved` -> `failed` (revalidation or execution failure)
Idempotency requirements:
- Every invocation must carry an `idempotencyKey` unique per org + action intent.
- Retry of the same request must return existing invocation/result instead of duplicating side effects.
- External provider request IDs should be stored when available for reconciliation.

## Org-wide vs personal integration behavior

Two separate decisions must always be explicit:
1. `run_as`: who the coworker is acting as
2. `credential_owner`: whose token/connector auth will be used

Default policy for V1:
- Interactive runs: prefer personal credential when available
- Long-running coworkers: prefer org/system credential
- Personal -> org fallback only when explicitly allowed by policy

Fail-safe rule:
- If required personal credential is missing, fail with actionable message.
- Do not silently escalate to org admin credentials.

## Sharing behavior for coworkers/templates

Required UX semantics:
- Coworkers can be shared, but integrations must declare ownership type (`org` vs `personal-required`).
- On import/share, personal-required integrations prompt the recipient to bind their own account.
- Warning banner must explain when a coworker currently depends on personal credentials.

## Security invariants

- Every non-git external side effect runs through gateway/service invocation path.
- Sandbox git push/PR path is the only V1 exception and is constrained to short-lived repo-scoped credentials.
- V1 default PR mode is `sandbox_pr`; strict `gateway_pr` is reserved for policy hardening without architecture rewrite.
- No direct sandbox -> third-party privileged writes with raw org credentials.
- All invocations are auditable and queryable by session/coworker/org.
- Approval-required actions must be durable and recoverable across restarts.
- Connector and OAuth auth materials are resolved server-side only.

## Definition of done checklist
- [ ] Single invocation lifecycle covers provider and MCP connector actions
- [ ] Input schemas validated before execution
- [ ] Mode resolution and source attribution persisted on each invocation
- [ ] OAuth and connector auth resolved server-side only
- [ ] Org vs personal credential behavior is explicit and visible
- [ ] Approval/deny + revalidation paths are implemented and auditable
- [ ] Sharing UX warns and remaps personal integrations on import
- [ ] PR ownership mode is explicit per run (`sandbox_pr` default, `gateway_pr` available for future strict mode)
