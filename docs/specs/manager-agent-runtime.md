# Manager Agent Runtime — System Spec

## 1. Scope & Purpose

### In Scope
- Pi-based manager runtime identity (`engine="pi"`, `profile="manager"`).
- Manager runtime placement inside `sandbox-agent /v1`.
- Gateway-owned exact provider/model binding for manager runs.
- Hidden runtime-private transcript/session-manager state versus the agent-managed `$MANAGER_MEMORY_DIR` working-memory root.
- Manager inbox kinds, wake semantics, and preemption rules.
- Independent child coding-session topology and manager orchestration behavior.
- Manager-specific tool surface, gateway policy boundary, and action/capability mediation.
- Manager code-quality and repository-rule expectations when the manager edits code directly or delegates to child coding sessions.
- Canonical stream, replay, and restart expectations that manager must share with coding sessions.

### Out of Scope
- Generic session lifecycle, hub ownership, runtime leasing, WebSocket transport, and session migration behavior — see `sessions-gateway.md`.
- Sandbox boot mechanics, provider storage implementation details, and sandbox-agent deployment behavior — see `sandbox-providers.md`.
- Tool schemas and sandbox injection mechanics — see `agent-contract.md`.
- Approval state machine, grants, and external action execution semantics — see `actions.md`.
- Repo/configuration CRUD, snapshot build policy, and service-command persistence — see `repos-prebuilds.md`.

### Mental Models
- **Manager is an orchestrator, not a coding-engine variant:** the frozen v1 identity is Pi manager, while current main still runs a gateway-local Claude manager harness. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `docs/specs/sessions-gateway.md`.
- **Gateway owns policy; runtime owns transcript continuity:** gateway remains the control plane for auth, approvals, child-session linkage, and DB projections, while the manager runtime owns hidden transcript/session-manager state. References: `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`, `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.
- **Working memory is not transcript storage:** `$MANAGER_MEMORY_DIR` is the manager-visible working-memory root for durable artifacts such as `memory.md`, while transcript/session-manager state remains hidden and runtime-private. References: `apps/gateway/src/harness/manager/wake-cycle/prompts.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `docs/specs/sandbox-providers.md`.
- **Postgres is a mirror, not transcript authority:** DB-backed messages/events/inbox rows exist for query/projection/control-plane purposes, but the v1 manager transcript source of truth does not live in Postgres. References: `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.
- **One active run per manager session in v1:** direct user input may interrupt; scheduler wakes may not. References: `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.
- **Child work means independent coding sessions:** manager supervision is explicit session-to-session orchestration, not hidden manager-owned subthreads. References: `apps/gateway/src/harness/manager/tools/handlers/child-sessions.ts`, `apps/gateway/src/harness/manager/tools/registry.ts`, `docs/specs/boundary-brief.md`.

### Things Agents Get Wrong
- Assuming manager is just another coding engine or a variant of OpenCode. The v1 identity is fixed to Pi manager; current gateway-local Claude harness is transitional only. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `docs/specs/sessions-gateway.md`.
- Assuming gateway remains the provider-specific manager loop. The freeze locks manager execution inside `sandbox-agent /v1`; gateway only chooses binding and mediates policy. References: `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `docs/specs/sessions-gateway.md`.
- Assuming `$MANAGER_MEMORY_DIR` can hold authoritative transcript/runtime state. It cannot; that directory is the public working-memory surface. References: `apps/gateway/src/harness/manager/wake-cycle/prompts.ts`, `docs/specs/sandbox-providers.md`.
- Assuming Postgres should own the authoritative manager thread. It should not; DB is a mirror/projection store. References: `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.
- Assuming `approval_result` or `child_update` are manager inbox kinds in v1. They are intentionally excluded. References: `apps/gateway/src/api/proliferate/http/session/actions/routes.ts`, `apps/gateway/src/hub/session-hub.ts`, `docs/specs/sessions-gateway.md`.
- Assuming scheduler wakes may interrupt an active manager run. Only `user_prompt` may preempt in v1. References: `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.
- Assuming manager may spawn manager children. V1 allows coding child sessions only. References: `apps/gateway/src/harness/manager/tools/handlers/child-sessions.ts`, `docs/specs/boundary-brief.md`.
- Assuming orchestration work relaxes repository-quality rules. Direct edits and delegated child work must still obey repo-local instructions and relevant subsystem specs. References: `CLAUDE.md`, `AGENTS.md`, `docs/specs/boundary-brief.md`.

---

> ### Current State vs. V1 Target
>
> The **current implementation** uses `ManagerRuntimeDriver` + `ManagerRuntimeService` running in-process in the gateway with a Claude-based harness adapter (`driverKind: "manager-claude"`). This is transitional.
>
> The **v1 target contract** described in this spec covers the Pi-based sandbox runtime placement (`engine="pi"`, `profile="manager"` inside `sandbox-agent /v1`), where the gateway selects the provider/model binding but execution moves out of the gateway process.
>
> Sections marked with status indicators (`Planned`, `Partial`, `Implemented`) in the deep dives (section 4) show which parts are implemented vs. planned.

---

## 2. Core Concepts

### Runtime Identity
The manager runtime is the manager-only runtime contract:

- `engine="pi"`
- `profile="manager"`

This identity is normative for v1 and distinct from coding engines. Current main is not there yet: `ManagerRuntimeDriver` still reports `driverKind: "manager-claude"`, and `ManagerRuntimeService` still boots a gateway-local `ClaudeManagerHarnessAdapter`. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `docs/specs/sessions-gateway.md`.

### Runtime Placement + Binding
The frozen v1 placement contract is:

- manager execution runs inside `sandbox-agent /v1`
- gateway chooses the exact provider/model binding
- gateway passes that binding into the runtime via runtime configuration and llm-proxy-compatible credentials
- Pi must not silently pick a different provider/model in v1

Current code is transitional: the gateway still constructs manager API-key/proxy inputs and a localhost gateway URL before calling the local harness adapter. References: `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.

### Storage Split
Manager runtime state is intentionally split into three layers:

1. Hidden runtime-private transcript/session-manager state.
2. Agent-managed working-memory root at `$MANAGER_MEMORY_DIR` with a root `memory.md` index.
3. Postgres mirrored projections for messages, events, inbox, and child/session status.

Contract rules:

- hidden transcript/session-manager state is runtime-owned and must not be exposed as a normal file-tool surface
- `$MANAGER_MEMORY_DIR` is for durable notes, plans, ledgers, checkpoints, and summaries that the manager intentionally maintains
- Postgres is query/projection/control-plane storage, not transcript authority

Current main only implements part of this split: the gateway passes `managerMemoryDir` and `managerMemoryIndexPath` into the harness, and wake-cycle prompts already enforce memory-root behavior, but hidden transcript authority is not implemented in tracked runtime code yet. References: `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `apps/gateway/src/harness/manager/wake-cycle/prompts.ts`, `docs/specs/sessions-gateway.md`, `docs/specs/sandbox-providers.md`.

### Inbox Model
The v1 manager inbox is typed. Supported input kinds are:

- `user_prompt`
- `scheduler_wake`

Unsupported as manager inbox kinds in v1:

- `approval_result`
- `child_update`

Implications:

- approvals stay on gateway/action surfaces rather than waking manager as a special inbox kind
- child completion/progress is checked through manager supervision tools rather than automatic child-update wakes

Current gateway code already has approval-result messaging surfaces outside the manager inbox contract, which is why the frozen manager spec keeps those concerns separate. References: `apps/gateway/src/api/proliferate/http/session/actions/routes.ts`, `apps/gateway/src/hub/session-hub.ts`, `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.

### Preemption + Concurrency
V1 manager concurrency rules are strict:

- only one active manager run may exist per manager session
- `user_prompt` may preempt an active manager run
- `scheduler_wake` may not preempt and should queue or coalesce while work is active

This keeps user follow-ups first-class without allowing scheduler noise to interrupt active orchestration. References: `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.

### Child Session Topology
The manager may spawn coding child sessions only in v1.

Current child-session tooling already reflects the intended topology:

- `handleSpawnChildTask()` creates independent child sessions via `sessions.createUnifiedTaskSession(...)`
- children are linked through `parentSessionId`, `workerId`, and `workerRunId`
- manager tools explicitly list, inspect, message, and cancel those child sessions
- in-process control-facade calls are primary when available; gateway HTTP loopback remains transitional fallback only

The manager does not collapse child execution into the manager's own identity or transcript. References: `apps/gateway/src/harness/manager/tools/handlers/child-sessions.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`, `apps/gateway/src/harness/manager/tools/registry.ts`, `docs/specs/sessions-gateway.md`.

### Tool Surface + Policy Boundary
The frozen v1 manager tool contract is:

- manager has coding-class general workspace tools
- manager also has explicit orchestration tools for child sessions, sources, capabilities, actions, notifications, and run completion
- gateway remains the authority for capability filtering, action approval, and durable control-plane mutations

Current main is partial:

- orchestration/source/action tools already exist in `MANAGER_TOOLS`
- `manager-control-facade.ts` already routes capability filtering and action invocation through gateway services
- full coding-class general-tool parity is part of the locked v1 target, not proven by the current tracked manager tool list

References: `apps/gateway/src/harness/manager/tools/registry.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`, `docs/specs/agent-contract.md`, `docs/specs/actions.md`.

### Code Quality Contract
When the manager edits code directly or delegates to a coding child, it must behave like a disciplined repository operator:

- prefer delegation for non-trivial implementation work
- obey repo-local instructions such as `CLAUDE.md`, `AGENTS.md`, and relevant subsystem specs
- keep diffs minimal and task-scoped
- preserve user and unrelated local changes
- avoid destructive git operations unless explicitly authorized
- run relevant verification when possible and report what was and was not verified
- never commit secrets or bypass approval/policy boundaries

This contract applies equally to direct edits and to the instructions the manager gives child coding sessions. References: `CLAUDE.md`, `AGENTS.md`, `docs/specs/boundary-brief.md`.

### Canonical Stream Compatibility
Manager runtime must use the same interface class as coding runtime for:

- attach
- replay
- catch-up after cursor
- live tail continuation

Canonical manager event semantics must include the same binding/dedupe fields used elsewhere in the runtime program (`bindingId`, `sourceSeq`, `sourceEventKey`, `eventSeq`). Current main is not there yet: `ManagerRuntimeDriver.activate()` sets no event-stream handle and no runtime binding ID. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `apps/gateway/src/hub/session/runtime/contracts/runtime-driver.ts`, `docs/specs/sessions-gateway.md`.

---

## 3. Conventions & Patterns

### Do
- Treat manager as orchestration-first and prefer child coding sessions for non-trivial implementation work.
- Keep hidden runtime-private transcript/session-manager state separate from `$MANAGER_MEMORY_DIR`.
- Let gateway choose and pass the exact provider/model binding.
- Queue or coalesce `scheduler_wake` while a manager run is active.
- Use explicit child-session orchestration surfaces (`spawn`, `inspect`, `message`, `cancel`) rather than implicit in-manager subthreads.
- Route actions, approvals, and capability discovery through gateway-controlled surfaces.
- Read repo-local instructions and relevant subsystem specs before direct edits or before delegating child work.

### Don't
- Do not store authoritative transcript/runtime state in Postgres or in `$MANAGER_MEMORY_DIR`.
- Do not let Pi auto-switch providers/models in v1.
- Do not treat `approval_result` or `child_update` as manager inbox kinds in v1.
- Do not allow `scheduler_wake` to interrupt an active manager run.
- Do not spawn manager children in v1.
- Do not bypass gateway policy with hidden credentials, direct DB writes, or private backchannels.
- Do not use direct manager code edits for broad speculative rewrites when an auditable child coding session is the safer choice.

### Reliability Notes
- Current manager execution is still gateway-local/transitional, so replay/binding guarantees are not yet equivalent to the coding runtime path. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`.
- Hidden transcript authority, binding-aware replay, and `sandbox-agent /v1` placement become hard requirements at Pi cutover. References: `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.
- Child-session control should prefer the in-process facade; HTTP loopback exists only as fallback for transitional execution. References: `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`, `apps/gateway/src/harness/manager/tools/handlers/child-sessions.ts`.

---

## 4. Subsystem Deep Dives

### 4.1 Runtime Identity + Placement Invariants — `Planned`
- Manager runtime identity is fixed to `engine="pi"` and `profile="manager"`.
- Manager execution must run inside `sandbox-agent /v1`, not as a gateway-hosted provider loop.
- Gateway must choose the exact provider/model binding and pass it into the runtime.
- Current main still runs a gateway-local Claude harness, so the frozen v1 contract is not implemented yet. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `docs/specs/sessions-gateway.md`.

### 4.2 Storage Authority + Memory Root Invariants — `Partial`
- `$MANAGER_MEMORY_DIR` and the `memory.md` root-index contract already exist in current harness inputs/prompts.
- Hidden runtime-private transcript/session-manager state remains distinct from `$MANAGER_MEMORY_DIR`.
- Postgres remains a mirror/projection store, not transcript authority.
- Hidden transcript authority is not implemented in tracked runtime code yet. References: `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `apps/gateway/src/harness/manager/wake-cycle/prompts.ts`, `docs/specs/sessions-gateway.md`, `docs/specs/sandbox-providers.md`.

### 4.3 Inbox + Preemption Invariants — `Planned`
- V1 inbox kinds are `user_prompt` and `scheduler_wake` only.
- Only `user_prompt` may preempt an active manager run.
- `scheduler_wake` must queue or coalesce instead of interrupting.
- `approval_result` and `child_update` are intentionally outside the v1 manager inbox contract. References: `apps/gateway/src/api/proliferate/http/session/actions/routes.ts`, `apps/gateway/src/hub/session-hub.ts`, `docs/specs/sessions-gateway.md`, `docs/specs/boundary-brief.md`.

### 4.4 Child Coding-Session Topology Invariants — `Partial`
- Manager child work must run as independent coding sessions linked back to the manager session/run.
- Current tooling already supports spawn, list, inspect, message, and cancel for child sessions.
- Manager-spawned manager children are disallowed in v1.
- Control-facade orchestration is preferred over HTTP loopback fallback. References: `apps/gateway/src/harness/manager/tools/handlers/child-sessions.ts`, `apps/gateway/src/harness/manager/tools/registry.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`.

### 4.5 Tool Surface + Policy Boundary Invariants — `Partial`
- Manager must retain explicit orchestration tools and gain coding-class general workspace tools in v1.
- Gateway remains the authority for capability filtering, approval checks, and durable action-side effects.
- Current tracked tool registry proves orchestration/source/action coverage but not full general-tool parity yet. References: `apps/gateway/src/harness/manager/tools/registry.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`, `docs/specs/actions.md`, `docs/specs/agent-contract.md`.

### 4.6 Code-Editing + Delegation Quality Invariants — `Planned`
- Manager should prefer delegation for non-trivial implementation work.
- Direct manager edits must obey repo-local instruction files and relevant subsystem specs.
- Child handoffs should include precise scope, constraints, success criteria, and verification expectations.
- Verification status must be reported honestly; unrelated local changes must be preserved. References: `CLAUDE.md`, `AGENTS.md`, `docs/specs/boundary-brief.md`.

### 4.7 Canonical Stream + Restart Invariants — `Planned`
- Manager must share the same attach/replay/catch-up/live-tail interface class as coding sessions.
- Canonical event fencing/dedupe fields (`bindingId`, `sourceSeq`, `sourceEventKey`, `eventSeq`) are required.
- Transcript continuity must survive reconnect/restart without making Postgres the transcript authority.
- Current manager driver does not yet wire an event stream handle or runtime binding ID. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `apps/gateway/src/hub/session/runtime/contracts/runtime-driver.ts`, `docs/specs/sessions-gateway.md`.

---

## 5. Cross-Cutting Concerns

| Dependency | Direction | Interface | Notes |
|---|---|---|---|
| `sessions-gateway.md` | Manager -> Gateway | runtime-driver selection, hub ownership, child-session control, session projections | Generic session/hub/runtime lifecycle belongs there; this spec owns manager-only semantics. |
| `sandbox-providers.md` | Manager -> Provider | `sandbox-agent /v1`, hidden runtime storage mechanics, memory-root env wiring | This spec owns the transcript-versus-memory contract; provider spec owns how the sandbox implements it. |
| `agent-contract.md` | Manager -> Tool contract | manager tool schemas, sandbox injection, capability surfaces | Tool definitions/injection belong there; manager usage and policy expectations belong here. |
| `actions.md` | Manager -> Actions | capability discovery, action invocation, approval flow | Manager may invoke actions, but approval/grant lifecycle stays in the actions spec. |
| `llm-proxy.md` | Gateway -> Manager | provider/model binding credentials, proxy-compatible runtime config | Gateway chooses binding; manager runtime consumes it. |
| `repos-prebuilds.md` | Manager -> Sessions/Configs | inherited repo/configuration state for child sessions | Child coding sessions inherit repo/configuration baseline through session creation paths rather than manager-owned repo state. |

### Security & Auth
- Gateway remains the authority for auth, capability filtering, approvals, and child-session mutations. References: `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`, `docs/specs/actions.md`.
- Hidden transcript/session-manager state must not be exposed as normal workspace files or ordinary tool targets. References: `docs/specs/sandbox-providers.md`, `docs/specs/boundary-brief.md`.
- Manager code work must honor repo-local safety instructions and avoid destructive git/policy bypass. References: `CLAUDE.md`, `AGENTS.md`.

### Observability
- Manager and coding should converge on the same canonical runtime stream shape so existing workspace/session surfaces do not need a parallel transport stack. References: `docs/specs/feature-registry.md`, `docs/specs/sessions-gateway.md`.
- Child-session linkage should remain explicit in durable projections (`parentSessionId`, `workerId`, `workerRunId`) for auditability and UI inspection. References: `apps/gateway/src/harness/manager/tools/handlers/child-sessions.ts`, `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`.

---

## 6. Acceptance Gates

- [x] `docs/specs/manager-agent-runtime.md` exists and resolves the existing references from `sessions-gateway.md` and `sandbox-providers.md`.
- [x] The spec clearly distinguishes current gateway-local manager harness behavior from the frozen v1 Pi runtime contract.
- [x] The spec explicitly locks engine/profile, runtime placement, exact gateway-chosen provider/model binding, storage authority split, inbox kinds, preemption, and child topology.
- [x] The spec states that manager gets coding-class general tools plus orchestration tools, with gateway retaining policy authority.
- [x] The spec records manager code-quality and repository-rule expectations for both direct edits and delegated child work.

---

## 7. Known Limitations & Tech Debt

- [ ] **Current manager runtime is still gateway-local Claude harness** — `ManagerRuntimeService` still starts/resumes `ClaudeManagerHarnessAdapter`, and `ManagerRuntimeDriver` still reports `driverKind: "manager-claude"` instead of Pi manager identity. References: `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`.
- [ ] **Manager driver has no canonical event-stream binding yet** — `ManagerRuntimeDriver.activate()` sets both event-stream handle and runtime binding ID to `null`, so manager does not yet meet the frozen replay/attach contract. References: `apps/gateway/src/hub/session/runtime/drivers/manager-runtime-driver.ts`, `apps/gateway/src/hub/session/runtime/contracts/runtime-driver.ts`.
- [ ] **Hidden runtime-private transcript authority is not implemented in tracked code** — current tracked manager runtime only proves memory-root injection, not the hidden transcript/session-manager store required by the spec. References: `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `apps/gateway/src/harness/manager/wake-cycle/prompts.ts`, `docs/specs/sandbox-providers.md`.
- [ ] **Current manager tool registry is orchestration-heavy** — tracked tools cover child sessions, sources, actions, notifications, and run completion, but do not yet prove full coding-class general-tool parity. References: `apps/gateway/src/harness/manager/tools/registry.ts`, `docs/specs/agent-contract.md`.
- [ ] **Some child-session control paths still retain HTTP loopback fallback** — in-process facade is present, but fallback fetches to gateway routes still exist for transitional execution. References: `apps/gateway/src/hub/session/runtime/manager/manager-control-facade.ts`, `apps/gateway/src/harness/manager/tools/handlers/child-sessions.ts`.
- [ ] **Exact gateway-chosen Pi provider/model binding is frozen in docs before code cutover** — current tracked code still passes API-key/proxy data into the local Claude harness path rather than a Pi runtime inside `sandbox-agent /v1`. References: `apps/gateway/src/hub/session/runtime/manager/manager-runtime-service.ts`, `docs/specs/sessions-gateway.md`.
