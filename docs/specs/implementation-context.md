# Shared Implementation Context (Agent Briefing)

> **Purpose:** This file gives coding agents the shared product and architecture context for the current implementation program.  
> **How to use:** Read this file before starting any PR prompt in this program, then follow the PR-specific instructions.

## 1. Current Baseline

- Repository: `/Users/pablo/proliferate`
- Branch/state assumption: `main` (recently updated)
- Recent verified anchor commit in planning discussions: `cc1ce37`
- Existing system is **close to target** but has explicit remaining gaps listed below.

## 2. Product and Architecture Model

### 2.1 Core entities and runtime model

- **Repo**: Single repository record.
- **Prebuild/Configuration**: Effective configuration unit that can include one or multiple repos (via `prebuild_repos`).
- **Session**: Running instance of a configuration/prebuild.
- **Setup session**: Specialized session to prepare environment and produce reusable snapshot state.
- **Snapshots**:
	- Base snapshot layer
	- Repo snapshot layer (where applicable)
	- Prebuild/user snapshot layer

### 2.2 Runtime transport model

- Real-time coding stream path: Client `<->` Gateway `<->` Sandbox.
- API routes are lifecycle/control plane, not the real-time token streaming path.
- Devtools/sandbox utilities are proxied through Gateway to sandbox-side API/routes.

### 2.3 Actions model

- Agent invokes actions through `proliferate actions ...` commands.
- Gateway routes actions, enforces policy, and tracks invocations.
- Risk classes:
	- `read` auto-approved
	- `write` approval/policy gated
	- `danger` denied by default
- Intercepted tools remain for product-native capabilities.

### 2.4 Automation model

- Canonical path: trigger ingest -> outbox enqueue -> enrich -> execute -> completion/finalization -> artifact write.
- Finalizer/reconciler exists and is expected to self-heal stuck or stale runs.

## 3. What Is Already Done (Do Not Re-implement)

- Outbox atomic claim + stuck-row recovery hardening is already landed.
- Slack notification timeout + core error handling is already landed.
- Slack channel/installation wiring has recent fixes landed.
- Actions timeline/session panel and org-level actions inbox exist.
- `proliferate services *` exists and sandbox-mcp stdio mode retirement path is already in place.
- Terminal/VSCode/changes/services side panels and devtools proxy stack are already present.
- Session/snapshot layering and setup/finalize core flows are already present.

## 4. Remaining Program Gaps

1. Actions grants and richer policy controls:
	- reusable scoped grants
	- approval mode support (approve once vs approve with grant)
	- CLI grant commands
2. Actions guide/bootstrap:
	- provider guide assets
	- CLI guide command
	- session bootstrap discoverability
3. Provider expansion beyond Sentry/Linear.
4. Automation enrich worker:
	- replace placeholder with real enrichment output and selection support
5. Secrets UX parity:
	- named bundles/groups
	- `.env.local` bulk paste flow
	- explicit file path targeting and clean apply/scrub behavior
6. Git freshness parity:
	- extend restore freshness behavior to E2B
	- configurable cadence to avoid over-pulling

## 5. Constraints and Coding Rules

- Work in existing patterns and architecture; avoid introducing competing abstractions.
- Keep behavior backward compatible unless PR explicitly changes contract.
- Keep route/service/DB layering consistent with repo conventions:
	- DB access in services package DB modules
	- route handlers remain thin where possible
- Maintain deterministic error handling and timeout behavior for external calls.
- Preserve authz boundaries (especially for approvals/admin-only actions).
- Avoid silent behavior changes in policy, billing-affecting flows, and lifecycle states.

## 6. Validation Expectations for Every PR

Each PR in this program should:

1. Add or update focused tests for new behavior.
2. Run relevant test suites for touched apps/packages.
3. Run typecheck for touched scopes.
4. Summarize:
	- what changed
	- what is backward compatible vs changed
	- residual risks/follow-ups

## 7. Program PR IDs (Reference Map)

- Track A (Actions): `A1`, `A2`, `A3`, `A4`, `A5x`
- Track B (Automation): `B1`, `B2`, `B3`
- Track C (Secrets/Runtime): `C1`, `C2`, `C3`, `C4`
- Final hardening: `Z1`

## 8. Start-of-PR Checklist for Agents

Before coding:

1. Read this file completely.
2. Read only the files directly relevant to the assigned PR.
3. Identify existing tests nearest to changed behavior.
4. Implement minimally and incrementally.
5. Validate and report exactly what was run.
