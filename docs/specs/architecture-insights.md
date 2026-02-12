# Proliferate Architecture And Logic Insights

Consolidated from all files in `docs/specs/` on 2026-02-12.

## What This Document Is

This is a single-system map of how Proliferate works end to end.
It summarizes subsystem ownership, runtime flows, core invariants, and important current gaps.

## Sources Covered

Runtime subsystem specs:
- `docs/specs/agent-contract.md`
- `docs/specs/sandbox-providers.md`
- `docs/specs/sessions-gateway.md`
- `docs/specs/automations-runs.md`
- `docs/specs/triggers.md`
- `docs/specs/actions.md`
- `docs/specs/llm-proxy.md`
- `docs/specs/cli.md`
- `docs/specs/repos-prebuilds.md`
- `docs/specs/secrets-environment.md`
- `docs/specs/integrations.md`
- `docs/specs/auth-orgs.md`
- `docs/specs/billing-metering.md`

Meta/governance specs:
- `docs/specs/boundary-brief.md`
- `docs/specs/feature-registry.md`
- `docs/specs/consistency-review.md`
- `docs/specs/implementation-context.md`
- `docs/specs/agent-prompts.md`
- `docs/specs/template.md`

## 1. System-Level Mental Model

Proliferate has two major planes:
- Control plane: Next.js/oRPC/API routes, DB metadata, OAuth/auth, billing policy, repo/prebuild management.
- Runtime plane: Client `<->` Gateway `<->` Sandbox streaming and execution.

Core architectural rule:
- Real-time message streaming does not go through Next.js API routes.
- Streaming path is always Client `<->` Gateway `<->` Sandbox (OpenCode via SSE + WebSocket).

High-level stack by responsibility:
- Identity and org tenancy: `auth-orgs.md`
- External connection credentials: `integrations.md`
- Repo and prebuild state: `repos-prebuilds.md`
- Secret encryption and env shaping: `secrets-environment.md`
- Session runtime orchestration: `sessions-gateway.md`
- Sandbox boot/provider runtime: `sandbox-providers.md`
- Agent behavior contract/tools: `agent-contract.md`
- Trigger ingestion: `triggers.md`
- Automation execution pipeline: `automations-runs.md`
- Action approval and grants: `actions.md`
- Cost/metering/enforcement: `billing-metering.md`
- CLI local-to-remote workflow: `cli.md`
- LLM proxy keying and spend attribution: `llm-proxy.md`

## 2. Ownership Boundaries (Canonical)

From `docs/specs/boundary-brief.md`:
- `agent-contract.md` owns prompts and tool schemas.
- `sandbox-providers.md` owns provider interface and sandbox boot mechanics.
- `sessions-gateway.md` owns session lifecycle and gateway hub/event pipeline.
- `automations-runs.md` owns automation definitions and run execution lifecycle.
- `triggers.md` owns inbound event ingestion and trigger dispatch.
- `actions.md` owns approval policy, invocation state, and grants.
- `llm-proxy.md` owns LiteLLM keying/routing contract (not billing policy).
- `cli.md` owns CLI auth/config/sync/open flow.
- `repos-prebuilds.md` owns repo and prebuild records plus snapshot build workers.
- `secrets-environment.md` owns secret CRUD, bundles, encryption model.
- `integrations.md` owns OAuth lifecycle and connection bindings.
- `auth-orgs.md` owns user/org/member/session identity model.
- `billing-metering.md` owns charging, gating policy, state transitions, enforcement.

Cross-boundary reality:
- Several files are intentionally cross-referenced across specs.
- `docs/specs/consistency-review.md` documents current overlaps/ambiguities to clean up.

## 3. Core End-To-End Flows

### 3.1 Interactive Session (Web)

1. User creates session via web control plane route.
2. Session record is created with prebuild/snapshot context.
3. Gateway hub is created lazily on first WebSocket connect.
4. Hub runtime provisions or recovers sandbox via provider interface.
5. Gateway holds SSE stream from OpenCode and emits WS events to client.
6. Tool calls may be intercepted by gateway handlers and patched back into OpenCode.
7. Session migrates/snapshots/stops through gateway lifecycle logic.

Specs involved:
- `sessions-gateway.md`
- `sandbox-providers.md`
- `agent-contract.md`
- `repos-prebuilds.md`
- `secrets-environment.md`
- `integrations.md`
- `billing-metering.md`

### 3.2 Setup Session -> Prebuild Finalization

1. Setup session prepares environment and agent can save service/env configuration.
2. Finalization snapshots filesystem state.
3. Prebuild record is created/updated and linked to repo(s).
4. Future sessions can start from prebuild snapshot, faster and more deterministic.

Specs involved:
- `repos-prebuilds.md`
- `sessions-gateway.md`
- `sandbox-providers.md`
- `secrets-environment.md`

### 3.3 Trigger -> Automation Run Pipeline

1. Trigger event arrives (webhook, polling, or schedule).
2. Event is filtered/deduped and converted to `trigger_event`.
3. Run is created transactionally and outbox row enqueues enrich stage.
4. Worker enriches context, resolves target repo/prebuild, creates session via gateway.
5. Worker sends prompt; automation completes via `automation.complete` tool.
6. Finalization writes artifacts and notifications.

Specs involved:
- `triggers.md`
- `automations-runs.md`
- `sessions-gateway.md`
- `agent-contract.md`

### 3.4 Action Invocation And Approval

1. Agent invokes action through `proliferate actions ...`.
2. Gateway evaluates risk level (`read`/`write`/`danger`).
3. Grant match can auto-approve writes; otherwise pending approval flow.
4. Approved invocation executes adapter against external service.
5. Results are redacted/truncated before persistence.

Specs involved:
- `actions.md`
- `integrations.md`
- `sessions-gateway.md`

### 3.5 Billing And Metering

1. Compute metering runs on intervals for active sessions.
2. LLM spend is cursor-synced from LiteLLM spend logs.
3. Both streams create billing events and atomically adjust shadow balance.
4. Billing state machine enforces grace/exhausted behavior.
5. Outbox worker posts pending events to Autumn asynchronously.

Specs involved:
- `billing-metering.md`
- `llm-proxy.md`
- `sessions-gateway.md`

### 3.6 CLI Local Workflow

1. CLI device auth gets API key via device code flow.
2. CLI ensures SSH keypair and registers public key.
3. CLI resolves/creates repo and session context.
4. Files sync local -> sandbox via rsync over SSH.
5. CLI launches OpenCode attached to gateway session.

Specs involved:
- `cli.md`
- `auth-orgs.md`
- `sessions-gateway.md`
- `repos-prebuilds.md`

## 4. Data Model And State Machine Highlights

Session lifecycle (runtime):
- `pending -> starting -> running -> paused -> stopped/failed`

Automation run lifecycle (DB reality):
- `queued -> enriching -> ready -> running -> succeeded/failed/needs_human/timed_out`

Trigger event lifecycle:
- `queued -> processing -> completed/failed/skipped`

Action invocation lifecycle:
- `pending -> approved -> executing -> completed`
- Alternate terminals: `denied/expired/failed`

Billing state lifecycle:
- `unconfigured -> trial/active -> grace -> exhausted -> suspended`
- With explicit transitions for credits added, grace expiry, manual overrides.

Key structural tables by concern:
- Sessions and runtime metadata: `sessions`, `session_connections`
- Repo/prebuild graph: `repos`, `prebuilds`, `prebuild_repos`, base/repo snapshot tracking
- Triggers/runs: `triggers`, `trigger_events`, `automation_runs`, `automation_run_events`, `outbox`
- Actions: `action_invocations`, `action_grants`
- Integrations: `integrations`, `repo_connections`, `automation_connections`, `session_connections`, `slack_installations`
- Billing: `billing_events`, `llm_spend_cursors`, `billing_reconciliations`, billing fields on `organization`
- Secrets: `secrets`, `secret_bundles`
- Auth/org: better-auth tables for `user`, `session`, `organization`, `member`, `invitation`, `apikey`

## 5. Invariants That Keep The System Correct

Reliability and correctness patterns repeated across subsystems:
- Idempotency keys for expensive side effects (sessions, billing events, completions).
- Lease-based claiming for concurrent worker safety.
- Outbox for durable handoffs between pipeline stages.
- `FOR UPDATE` row locks where atomic balance changes or claims are required.
- Unique constraints for dedupe semantics (trigger dedup keys, one run per trigger event).
- Provider abstraction for runtime backend portability (Modal/E2B).

Security patterns:
- OAuth tokens resolved at execution time; not exposed broadly.
- Secrets encrypted at rest (AES-256-GCM) and never returned via list APIs.
- Service-to-service auth and scoped token checks in gateway and workers.
- Tool interception for privileged operations (snapshot, verify, run completion).

## 6. Architecture Insights By Subsystem

`agent-contract.md`:
- Clean split between tool declaration and tool execution.
- Tool files are filesystem-discovered by OpenCode, not registry-declared in config.
- Most platform tools are gateway-intercepted; one (`request_env_variables`) intentionally runs in sandbox.

`sandbox-providers.md`:
- Providers are contract-first and mostly interchangeable at call sites.
- Boot sequence is dense and deterministic: dependencies, plugin, tools, OpenCode, sidecar services.
- Snapshot layering is an optimization hierarchy, not a single artifact.

`sessions-gateway.md`:
- Hub model centralizes runtime ownership per session.
- Runtime is resilient but currently memory-local to gateway process.
- Migration path is explicit and lock-protected, avoiding overlapping migrations.

`automations-runs.md`:
- Clear stage-based run orchestration with outbox-backed transitions.
- Enrichment is deterministic today (no LLM dependency in enrichment stage).
- Finalizer acts as safety net for stale or incomplete runs.

`triggers.md`:
- Ingestion supports push, pull, and schedule models.
- Handoff to automations is transactional and durable.
- Provider abstraction exists in two layers today (functional + class-based), adding complexity.

`actions.md`:
- Approval flow is strongly modeled with risk classes and grants.
- Grants include wildcard matching and CAS consumption for concurrency safety.
- Adapter registry is static by design for controlled expansion.

`llm-proxy.md`:
- Per-session virtual keys enforce cost attribution boundaries.
- Team/user mapping aligns LLM spend to org/session dimensions.
- Spend sync is intentionally eventual and cursor-driven.

`cli.md`:
- Treat CLI as a local transport/orchestration client over gateway + web APIs.
- Device auth + API key persistence avoids local OAuth complexity.
- File sync model is intentionally one-way to prevent hidden merge semantics.

`repos-prebuilds.md`:
- Prebuild is the effective reusable runtime artifact and configuration boundary.
- Snapshot build workers optimize startup but do not replace runtime snapshot resolution logic.
- Service/env file persistence keeps startup configuration declarative.

`secrets-environment.md`:
- Secrets model favors strict non-disclosure and straightforward deployment-time injection.
- Bundle target paths bridge secret storage and deterministic file generation.
- Repo/org scope merging is explicit at session boot.

`integrations.md`:
- Acts as credential substrate for the rest of the platform.
- Runtime consumers should not own OAuth lifecycle details.
- Token resolution abstracts provider differences (GitHub App, Nango, Slack install tokens).

`auth-orgs.md`:
- Org context is the tenancy axis for almost every other subsystem.
- better-auth plugin endpoints own most writes for org/member lifecycle.
- Impersonation is overlay-based, not session-duplicating.

`billing-metering.md`:
- Fast local gating relies on shadow balance, not synchronous external billing calls.
- Event ledger and atomic balance mutation are foundational invariants.
- Billing FSM drives operational enforcement (grace, exhausted, suspension).

## 7. Current Partial Areas And Architectural Debt

Cross-spec high-signal partial/debt items:
- Billing gate bypass exists on some session creation paths (notably automation/gateway path).
- Snapshot quota functions exist but are not wired into active runtime paths.
- Automation manual run resolution API is incomplete (`needs_human` closure gap).
- Trigger ingestion and provider abstraction are duplicated across two paths/layers.
- Gateway hub cleanup is not fully wired; memory growth risk over long uptime.
- LLM proxy key revocation on session end is not implemented.
- Several ownership/cross-reference inconsistencies are tracked in `consistency-review.md`.

## 8. Meta-Spec Program Insights

`boundary-brief.md`:
- Defines the canonical spec registry, glossary, and cross-reference rules.
- Most useful for avoiding ownership drift during new changes.

`feature-registry.md`:
- Gives fast status/evidence lookup for each feature.
- Useful as implementation inventory, but should be read with `consistency-review.md` for drift awareness.

`consistency-review.md`:
- Captures known disagreements across status, ownership, and terminology.
- Should be treated as backlog for spec hygiene, not just editorial notes.

`implementation-context.md`:
- Provides prior-program context and explicitly calls out remaining implementation tracks.
- Helpful for understanding why certain partial patterns exist today.

`agent-prompts.md` and `template.md`:
- Process assets for generating/updating specs consistently.
- Not runtime architecture themselves, but key to keeping architecture docs coherent.

## 9. Practical Reading Order For Engineers

If you need to understand production runtime first:
1. `docs/specs/sessions-gateway.md`
2. `docs/specs/sandbox-providers.md`
3. `docs/specs/agent-contract.md`
4. `docs/specs/repos-prebuilds.md`
5. `docs/specs/secrets-environment.md`
6. `docs/specs/integrations.md`
7. `docs/specs/billing-metering.md`

If you need to understand automation/event systems:
1. `docs/specs/triggers.md`
2. `docs/specs/automations-runs.md`
3. `docs/specs/actions.md`
4. `docs/specs/llm-proxy.md`

If you need tenancy/access model:
1. `docs/specs/auth-orgs.md`
2. `docs/specs/integrations.md`
3. `docs/specs/billing-metering.md`

If you need local developer entry path:
1. `docs/specs/cli.md`
2. `docs/specs/sessions-gateway.md`
3. `docs/specs/repos-prebuilds.md`

## 10. One-Sentence Architecture Summary

Proliferate is a multi-tenant agent platform where identity, credentials, repos, prebuilds, and billing live in a control plane, while all real-time agent execution flows through a gateway-managed session hub into provider-backed sandboxes with durable outbox-based automation and billing side pipelines.
