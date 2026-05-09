# Server Phase 7K: Remainder Audit

Status: complete.

This audit closes the Phase 7 boundary pass. It classifies every remaining
entry in `scripts/server_boundaries_allowlist.txt` after the Phase 7
implementation lanes.

The goal is not to declare the server clean. The goal is to separate ordinary
missed cleanup from systems that need Phase 8 design before implementation.
Cleanup PRs should remove fixed rows from the active classifications and note
the resolved follow-up below.

## Classification Key

- **Phase 8 deferred** — coupled billing, runtime, cloud workspace, cloud
  mobility, or worker-claim behavior. These need an invariant map and staged
  implementation plan before code movement.
- **Small follow-up** — ownership cleanup that can be assigned independently
  with narrow path ownership.
- **Intentional isolated wrapper** — a transitional wrapper kept because a
  deferred caller still needs an isolated transaction or read boundary. Do not
  expand these wrappers; delete them when the owning deferred caller migrates.

## Boundary Allowlist Classification

| Path | Remaining rule families | Classification | Next step |
|---|---|---|---|
| `server/proliferate/integrations/anonymous_telemetry.py` | integration imports product/db | Small follow-up | Move persistence and product decisions out of the integration; keep the integration as transport/payload code. |
| `server/proliferate/integrations/billing/stripe.py` | integration imports product | Phase 8 deferred | Handle with the billing/Stripe redesign so integration types and billing product types are separated deliberately. |
| `server/proliferate/server/ai_magic/service.py` | service imports ORM/auth model | Small follow-up | Pass user IDs or small snapshots instead of auth ORM objects. |
| `server/proliferate/server/billing/service.py` | service imports ORM/auth model | Phase 8 deferred | Billing service remains coupled to accounting, subscription, webhook, and usage semantics. |
| `server/proliferate/server/cloud/repos/service.py` | service imports ORM/auth model | Small follow-up | Replace auth/ORM coupling with explicit user or owner snapshots. |
| `server/proliferate/server/cloud/runtime/service.py` | service imports ORM/auth model | Phase 8 deferred | Runtime service cleanup belongs with runtime lifecycle/provisioning work. |
| `server/proliferate/server/cloud/workspaces/service.py` | service imports ORM/auth model | Phase 8 deferred | Workspace service cleanup belongs with cloud workspace lifecycle/materialization work. |
| `server/proliferate/db/store/anonymous_telemetry.py` | store opens/commits session | Small follow-up | Thread the DB session from the caller once telemetry ownership is moved out of the integration. |
| `server/proliferate/db/store/automation_cloud_workspace_claims.py` | store opens/commits session | Phase 8 deferred | Claim transaction timing is worker/cloud-workspace scheduler behavior. |
| `server/proliferate/db/store/automation_run_claims.py` | store opens/commits session | Phase 8 deferred | Run-claim locking, heartbeat, and retry semantics need a worker design pass. |
| `server/proliferate/db/store/automations.py` | store opens/commits session | Phase 8 deferred | Remaining wrappers are worker/scheduler-facing rather than API CRUD cleanup. |
| `server/proliferate/db/store/billing.py` | store opens/commits session, forbidden imports | Phase 8 deferred | Billing store cleanup must preserve accounting, subscription, usage, and Stripe invariants. |
| `server/proliferate/db/store/cloud_mobility.py` | store opens/commits session | Phase 8 deferred | Mobility handoff/checkpoint semantics need their own design pass. |
| `server/proliferate/db/store/cloud_runtime_environments.py` | store opens/commits session | Phase 8 deferred | Covered by `reference/server_phase7_runtime_environments_audit.md`. |
| `server/proliferate/db/store/cloud_workspace_setup_runs.py` | store opens/commits session | Phase 8 deferred | Setup-run checkpoints are part of cloud workspace materialization. |
| `server/proliferate/db/store/cloud_workspaces.py` | store opens/commits session | Phase 8 deferred | Workspace state transitions and setup monitor behavior need a lifecycle design. |
| `server/proliferate/db/store/organizations.py` | store opens/commits session | Intentional isolated wrapper | Remaining wrappers serve deferred billing/cloud callers; remove when those callers migrate. |
| `server/proliferate/db/store/cloud_mcp/auth.py` | store opens session | Intentional isolated wrapper | Materialization/OAuth refresh wrappers keep isolated refresh boundaries until the refresh flow is redesigned. |
| `server/proliferate/db/store/cloud_mcp/oauth_clients.py` | store opens session | Intentional isolated wrapper | Same materialization/OAuth refresh boundary. |
| `server/proliferate/db/store/cloud_repo_config.py` | store opens session | Intentional isolated wrapper | Remaining reads serve deferred runtime/workspace flows. |
| `server/proliferate/db/store/cloud_worktree_policy.py` | store opens session | Intentional isolated wrapper | Remaining policy read serves deferred runtime policy sync. |
| `server/proliferate/db/store/organization_invitations.py` | store opens session | Intentional isolated wrapper | Create/rotate must commit the invitation before external email delivery; replace only with an explicit delivery checkpoint or outbox design. |
| `server/proliferate/db/store/users.py` | store opens session | Intentional isolated wrapper | Unused wrappers are removed; the remaining OAuth-account user load serves deferred runtime, mobility, and worker callers. |

## File-Size Debt

The current hard-line checker only blocks non-allowlisted files over the repo
limit. The files below remain high-value cleanup targets, but Phase 7 should
not keep spawning broad agents for them without a system owner.

### Phase 8 deferred large files

- `server/proliferate/db/store/billing.py`
- `server/proliferate/server/billing/service.py`
- `server/proliferate/server/billing/stripe_webhooks.py`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/server/cloud/workspaces/service.py`
- `server/proliferate/db/store/cloud_mobility.py`
- `server/proliferate/server/cloud/mobility/service.py`
- `server/proliferate/server/cloud/runtime/provision.py`
- `server/proliferate/server/cloud/runtime/credential_freshness.py`
- `server/proliferate/server/cloud/runtime/bootstrap.py`
- `server/proliferate/server/cloud/runtime/ensure_running.py`
- `server/proliferate/server/cloud/runtime/anyharness_api.py`
- `server/proliferate/server/cloud/runtime/repo_config_apply.py`
- `server/proliferate/db/store/automation_run_claims.py`
- `server/proliferate/db/store/automations.py`

### Small follow-up medium files

These are not blockers for Phase 7 completion. Assign them only with narrow
path ownership and behavior-preserving goals.

- `server/proliferate/server/organizations/service.py`
- `server/proliferate/auth/desktop/service.py`
- `server/proliferate/server/cloud/mcp_oauth/service.py`
- `server/proliferate/server/cloud/mcp_connections/service.py`
- `server/proliferate/server/cloud/mcp_catalog/catalog.py`
- `server/proliferate/server/cloud/mcp_catalog/domain/rendering.py`
- `server/proliferate/server/cloud/mcp_catalog/models.py`
- `server/proliferate/server/cloud/webhooks/service.py`
- `server/proliferate/server/automations/service.py`
- `server/proliferate/server/automations/local_executor_service.py`
- `server/proliferate/server/automations/models.py`

### Intentional wrappers, not size targets

These files should not be split just to reduce line count. Remove the wrappers
only when the deferred caller owning the transaction boundary migrates.

- `server/proliferate/db/store/cloud_repo_config.py`
- `server/proliferate/db/store/cloud_runtime_environments.py`
- `server/proliferate/db/store/cloud_mcp/auth.py`
- `server/proliferate/db/store/cloud_mcp/oauth_clients.py`
- `server/proliferate/db/store/cloud_worktree_policy.py`
- `server/proliferate/db/store/organizations.py`
- `server/proliferate/db/store/organization_invitations.py`
- `server/proliferate/db/store/users.py`

## Resolved Follow-ups After Phase 7K

- `server/proliferate/integrations/sandbox/daytona.py`
- `server/proliferate/integrations/sandbox/e2b.py`

  Removed the product-domain timestamp import from the provider integrations.
  Both providers now use `proliferate.utils.time.utcnow`, so their
  `INTEGRATION_PRODUCT_IMPORT` allowlist entries were deleted.

## Phase 7 Result

Phase 7 can be treated as complete once this audit is merged:

- normal medium cleanup lanes have either landed or been reclassified
- remaining boundary allowlist entries are no longer ambiguous
- Phase 8 has clear deferred systems
- small follow-ups can be assigned independently without pretending the whole
  server cleanup is still open

## Recommended Phase 8 Systems

Start Phase 8 as system-design lanes, not direct implementation lanes:

1. Billing/accounting/Stripe.
2. Cloud workspace lifecycle and setup runs.
3. Cloud runtime lifecycle: provisioning, reconnect, credential freshness,
   webhooks, and billing reconciler checkpoints.
4. Cloud mobility lifecycle.
5. Automation worker claim/executor semantics.
