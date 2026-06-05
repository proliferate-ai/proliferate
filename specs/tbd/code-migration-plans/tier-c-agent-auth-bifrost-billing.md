# Tier C: Agent Auth / Bifrost / Billing Feature Follow-Through

Status: feature follow-through planning target. Requires clarify-to-plan slices.

## Starting Baseline

Start after PR 529 merges. PR 529 rebinds agent-auth/runtime applicability to
target identity and removes slot fences. It does not implement the non-identity
feature work in the merged agent-auth, Bifrost BYOK, billing, and settings/admin
IA specs.

This track should not race server structural hygiene in the same file families.
If command preflight, worker command surfaces, or agent-auth service files are
still unsplit, run the relevant server-hygiene boundary extraction first, then
land Tier C behavior inside those boundaries.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/primitives/agent-auth.md`
- `specs/codebase/primitives/agent-auth-bifrost-byok.md`
- `specs/codebase/primitives/billing.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/primitives/sandbox-provisioning.md`
- `specs/codebase/features/settings-admin-ia.md`
- `specs/codebase/structures/server/README.md`
- frontend docs if touching settings/billing UI
- worker docs if touching materialization/reporting

## Intended End State

Non-identity feature work is implemented on top of target-scoped auth state:

- gateway/BYOK behavior is complete and target-safe
- provider secrets do not enter sandboxes in gateway mode
- virtual key budgeting/reconciliation is implemented and observable
- managed-credit plan wiring is tied to billing/subscription state
- command preconditions and worker materialization reflect current selected auth
  and runtime config
- settings/admin IA exposes the intended surfaces without raw endpoint leakage
- billing state is visible where the product specs require it

## Owned Files / Surfaces

- `server/proliferate/server/cloud/agent_auth/**`
- `server/proliferate/db/store/cloud_agent_auth/**`
- billing services/stores/models for managed credits and entitlements
- command precondition/building surfaces
- worker materialization/reporting paths
- settings/admin frontend surfaces and SDK types as needed
- tests for gateway/BYOK/billing/preflight behavior

## Out Of Scope

- Slot-collapse identity work already owned by PR 529.
- Celery job substrate except if a reconciler task is explicitly part of a
  billing/gateway feature slice.
- Server structural hygiene in shared command/auth files, except for a
  prerequisite boundary-extraction slice that is explicitly owned and reviewed
  as hygiene.
- Broad settings redesign unrelated to the specs.

## Migration Slices

1. **Clarify feature matrix**
   - Inventory each merged spec requirement and mark shipped, identity-only,
     unimplemented, or ambiguous.
2. **Gateway/BYOK core**
   - Implement provider key, virtual key, routing, and sandbox materialization
     behavior not already shipped.
3. **Budget reconciliation**
   - Implement virtual-key budget reconciliation and managed-credit accounting.
4. **Command preflight/materialization**
   - Ensure commands block or reconcile based on current target-scoped auth and
     runtime config.
5. **Billing plan wiring**
   - Tie managed-credit budgets and free/paid allocation to subscription state.
6. **Settings/admin IA**
   - Add or align UI/API surfaces for selected credentials, billing state, and
     admin controls.
7. **Observability and support**
   - Add diagnostics for auth source, target applied state, budget status, and
     last materialization failure.

## Data / Contract Changes

Likely additions or changes:

- gateway/BYOK model/store fields
- billing entitlement/allocation/budget fields
- API/SDK fields for settings/admin/billing state
- worker materialization command payload fields, if not already present

## Backward Compatibility And Deletion Plan

Avoid keeping legacy auth behavior beside gateway/BYOK behavior unless a feature
flag is explicitly required. Delete old provider-secret materialization paths
that violate gateway-mode invariants.

## Verification

- Server unit/integration tests for agent-auth source selection and gateway mode
- Billing tests for managed credits, budget reconciliation, and subscription
  transitions
- Worker materialization tests for auth modes
- Frontend typecheck and targeted tests for settings/billing UI
- SDK generation/build if APIs change

## Risks And Open Questions

- The specs span primitives and features. Start with a requirement matrix before
  coding.
- Billing behavior is high stakes; isolate accounting changes and test edge
  cases.
- Provider-secret handling requires careful security review.
- Command/auth behavior changes should not be implemented in parallel with
  structural moves of the same server files.

## Critique Prompts

Plan critique:

```text
Review the agent-auth/Bifrost/billing plan. Does it separate identity rebind
already done in PR 529 from remaining feature work? Are security, billing, UI,
and worker materialization responsibilities clear? Return findings first.
```

Implementation critique:

```text
Review the agent-auth/Bifrost/billing implementation. Look for provider secrets
leaking into sandboxes, incorrect budget/accounting behavior, stale command
preconditions, UI raw endpoint access, and missing high-stakes tests. Return
findings first.
```
