# Server Phase 7 Lanes

Status: completed implementation reference.

Use this file when assigning Phase 7 server cleanup work. The goal is to finish
normal medium store/model/file cleanup and prove that the remaining debt belongs
to explicitly deferred complex systems.

The final remainder classification lives in
`reference/server_phase7_remainder_audit.md`.

Phase 7 is not "clean every large server file." It is the pass that makes
medium, ownership-obvious areas conform to `docs/server/**` after the DB,
error, integration, domain, and worker foundations have landed.

## Required Reading

Every Phase 7 lane starts with:

- `AGENTS.md`
- `docs/server/README.md`
- `docs/server/guides/database.md`
- `docs/server/guides/domains.md`
- `docs/server/guides/auth.md` when touching access/authorization
- `docs/server/guides/errors.md` when touching service errors
- `docs/server/guides/integrations.md` when touching integration boundaries
- `docs/server/guides/config.md` when moving constants
- this file

## Phase 7 Goal

Finish cleanup for non-deferred medium areas:

- stores accept `db` and stop opening sessions where transaction behavior is
  clear
- stores return frozen dataclasses, not ORM objects
- Pydantic response builders take dataclasses, not ORM objects
- medium files split only when the receiving ownership is obvious
- product constants move to owning `constants/<area>.py` or domain-local
  constants
- boundary allowlists shrink for owned paths

Preserve behavior. Do not mix behavior changes with ownership migration.

## Done Criteria

Phase 7 is complete when:

- every implementation-now lane below is merged or explicitly reclassified
- every audit-first lane has a short map and a recommendation
- remaining server boundary allowlist entries are either fixed or marked as
  Phase 8 deferred
- no "normal" medium store still opens its own session merely because it was
  missed
- deferred systems have clear owners, invariants, and reasons for exclusion

## Stop Rules

Stop and report instead of editing when a lane requires:

- billing accounting, subscription, webhook, or usage semantics
- cloud workspace lifecycle semantics
- cloud mobility semantics
- cloud runtime provisioning/materialization behavior
- large automation executor or run-claim semantics
- changing transaction timing when tests do not already pin the behavior
- touching another active lane's owned paths

## Common Acceptance Checks

Each implementation PR should run the most relevant subset plus the repo-shape
checks:

```bash
python3 scripts/check_server_boundaries.py
python3 scripts/check_max_lines.py
uv run pytest -q <targeted server tests>
git diff --check
```

If an implementation shrinks an allowlist count, update
`scripts/server_boundaries_allowlist.txt` in the same PR.

## Implementation Now

These lanes are suitable for parallel implementation when each agent owns only
the listed paths.

### 7A. Organizations And Invitations

Owns:

- `server/proliferate/server/organizations/**`
- `server/proliferate/db/store/organizations.py`
- `server/proliferate/db/store/organization_invitations.py`
- organization/invitation tests

Goals:

- split medium organization service/store code only along existing concepts
- thread request `db` through remaining safe store calls
- keep stores transaction-free
- return frozen dataclasses from stores where touched
- shrink organization allowlist entries

Do not touch billing, cloud workspaces, or auth internals except through
documented authorization helpers.

### 7B. Cloud Repo Config And Worktree Policy

Owns:

- `server/proliferate/server/cloud/repo_config/**`
- `server/proliferate/db/store/cloud_repo_config.py`
- `server/proliferate/db/store/cloud_worktree_policy.py`
- related repo config / worktree policy tests

Goals:

- thread `db` through safe store paths
- split store/service helpers by repo config versus worktree policy only when
  the current code already has that conceptual split
- remove ORM inputs from Pydantic constructors when safe
- shrink repo config / worktree policy allowlist entries

Do not touch runtime provisioning, cloud workspace lifecycle, or AnyHarness
materialization behavior.

### 7C. Cloud MCP Connections And OAuth

Owns:

- `server/proliferate/server/cloud/mcp_connections/**`
- `server/proliferate/server/cloud/mcp_oauth/**`
- `server/proliferate/db/store/cloud_mcp_connections.py`
- `server/proliferate/db/store/cloud_mcp/**`
- related MCP connection/OAuth tests

Goals:

- remove remaining safe self-opening store wrappers
- keep materialization-specific isolated wrappers documented if they cannot
  safely move yet
- keep integration calls behind `integrations/mcp_oauth/**`
- shrink cloud MCP allowlist entries where behavior is clear

Do not touch `server/proliferate/server/cloud/mcp_materialization/**` except to
record an audit finding.

### 7D. Cloud Credentials Final DB Threading

Owns:

- `server/proliferate/server/cloud/credentials/**`
- `server/proliferate/db/store/cloud_credentials.py`
- cloud credential tests

Goals:

- remove the remaining safe store session factory usage
- keep credential sync behavior unchanged
- shrink cloud credential allowlist entries

Do not redesign credential sync, runtime credential freshness, or provider
credential semantics.

### 7E. Automations API CRUD

Owns:

- `server/proliferate/server/automations/api.py`
- `server/proliferate/server/automations/service.py`
- `server/proliferate/server/automations/models.py`
- `server/proliferate/db/store/automations.py`
- API-facing automation tests

Goals:

- split API-facing CRUD/policy helpers where ownership is obvious
- thread `db` through safe store paths
- keep worker/executor semantics unchanged
- shrink `automations.py` store allowlist entries where safe

Do not touch:

- `server/proliferate/db/store/automation_run_claims.py`
- `server/proliferate/db/store/automation_cloud_workspace_claims.py`
- `server/proliferate/server/automations/worker/**`
- cloud/local executor behavior

### 7F. Constants And Transport Model Cleanup

Owns only explicitly assigned small paths from the implementation PR prompt.

Goals:

- move scattered shared policy literals to `constants/<area>.py`
- keep file-local constants file-local when they have one consumer
- move pure status/label/policy mappings to domain modules
- remove safe ORM constructor usage from Pydantic models already owned by
  another Phase 7 lane

This lane is a support lane. It must not sweep across unrelated domains without
explicit path ownership.

## Audit First

These lanes are not implementation-first. Assign an audit agent to produce a
short map, invariants, recommended split, and implementation/defer decision.

### 7G. Cloud Runtime Environments Store

Status: completed as audit-only in
`reference/server_phase7_runtime_environments_audit.md`. The remaining
runtime-environment store debt is Phase 8 runtime-lifecycle work, not a safe
Phase 7 implementation lane.

Audit:

- `server/proliferate/db/store/cloud_runtime_environments.py`
- `server/proliferate/server/cloud/runtime/credential_freshness.py`
- `server/proliferate/server/cloud/runtime/bootstrap.py`
- `server/proliferate/server/cloud/runtime/ensure_running.py`

Question: which store operations can be converted without touching runtime
provisioning/materialization timing?

### 7H. Automation Run Claims

Audit:

- `server/proliferate/db/store/automation_run_claims.py`
- `server/proliferate/db/store/automation_cloud_workspace_claims.py`
- `server/proliferate/server/automations/worker/**`

Question: are run-claim transaction boundaries worker semantics that should
defer to Phase 8, or are there small independent store splits that can land in
Phase 7?

### 7I. Cloud ORM Model Split

Audit:

- `server/proliferate/db/models/cloud.py`

Question: can the ORM model file be split by table cluster without broad import
churn or alembic risk?

### 7J. MCP Materialization Service

Audit:

- `server/proliferate/server/cloud/mcp_materialization/service.py`

Question: does any cleanup stand alone, or is this tied to cloud runtime
materialization and therefore Phase 8?

### 7K. Boundary Allowlist Remainder

Status: completed as audit-only in
`reference/server_phase7_remainder_audit.md`.

Audit:

- `scripts/server_boundaries_allowlist.txt`

Question: after implementation-now lanes merge, classify each remaining entry
as fixed, Phase 7 follow-up, or Phase 8 deferred. Do not edit product code in
this lane.

## Deferred To Phase 8

Do not assign broad implementation agents here during Phase 7:

- `server/proliferate/db/store/billing.py`
- `server/proliferate/server/billing/service.py`
- `server/proliferate/server/billing/stripe_webhooks.py`
- `server/proliferate/db/store/cloud_workspaces.py`
- `server/proliferate/server/cloud/workspaces/service.py`
- `server/proliferate/db/store/cloud_mobility.py`
- `server/proliferate/server/cloud/mobility/service.py`
- `server/proliferate/server/cloud/runtime/provision.py`
- cloud runtime provisioning/materialization/reconnect/liveness loops
- cross-domain billing/cloud usage accounting

Each Phase 8 system needs a current-state map, invariants, staged target shape,
test plan, and human review before implementation.

## Agent Prompt Template

Use this structure for each Phase 7 implementation agent:

```text
Read AGENTS.md, docs/server/README.md, the relevant docs/server/guides/* files,
and reference/server_phase7_lanes.md.

You own exactly:
- <paths>

You must not touch:
- <forbidden paths>

Goal:
- <lane-specific goal>

This is behavior-preserving cleanup. Do not change API responses, transaction
timing, cloud/runtime semantics, billing/accounting semantics, worker executor
semantics, or auth policy semantics.

Shrink these allowlist entries if your change removes the violation:
- <entries>

Stop and report if the correct fix requires a deferred system or another
active lane's paths.

Verify with:
- python3 scripts/check_server_boundaries.py
- python3 scripts/check_max_lines.py
- uv run pytest -q <targeted tests>
- git diff --check
```
