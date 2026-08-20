# Agent Run Config

Centralized cloud agent configuration. One named row selects an agent kind, a
model, and a subset of non-model controls; every surface that starts cloud
agent work resolves through it. Owning code:
`server/proliferate/server/cloud/agent_run_config/` (service, api,
`domain/resolve.py`), models in
`server/proliferate/db/models/cloud/agent_run_config.py`, store in
`server/proliferate/db/store/cloud_agent_run_config.py`.

## Target-observed launch options are the source of truth

A `cloud_agent_run_config` row stores an opaque agent kind, exact `model_id`,
and exact non-model `control_values_json` under a human-readable name. The row
does not claim that those values are executable. Executable model and control
IDs come only from the selected target runtime's
`GET /v1/agents/{kind}/launch-options` response.

Deliberate anti-decisions: no `validation_status`, no
`catalog_version_pinned_at`, no `is_starter_preset` column, no `revision`, no
background reconciler. Stale values remain visible and editable, but execution
never silently drops, aliases, intersects, or repairs them.

## Three-phase validation

- **Write time** (create/patch): validate only the durable structure: non-empty
  exact IDs and JSON value shape. Saving is target-independent and therefore
  cannot assert launchability.
- **Read time** (selector render): when a target is selected, render its current
  target-observed models and controls. Preserve a stale saved value as stale;
  do not substitute a catalog alias or first-row fallback.
- **Run time**: refresh the same target runtime's options and validate the
  complete stored selection against one returned revision. Missing, omitted,
  or mismatched values fail with typed launch-option errors before execution.

The structural resolver is
`domain/resolve.py::resolve_runtime_values(config_row)` →
`ResolvedAgentRunConfig` (no I/O). Target validation remains at the runtime
boundary that owns the observation.

## Defaults

`cloud_agent_run_config_default` pins one config per `(owner, agent_kind)`,
at personal or organization scope. Service invariants:

- personal defaults may point only at system rows or the user's own rows with
  `usable_in_personal_sandboxes=true`
- organization defaults may point only at system rows or that organization's
  rows with `usable_in_shared_sandboxes=true`
- archived configs cannot be pinned as new defaults
- archiving a pinned config must either reject or atomically move the default
  to the deterministic system fallback

Resolution order when starting without an explicit `config_id`: the owner's
pinned default (personal or organization, by target mode) → the active system
row for that agent kind ordered by `system_default_rank` asc then `seed_key`
asc → typed `agent_run_config_missing_default`.

## Starter presets are system rows

All active `owner_scope='system'` rows are starter presets — there is no flag
column. `seed_key` gives each preset a stable deploy-time identity;
`system_default_rank` selects the deterministic fallback. Self-hosted
operators can edit the seed list; hosted deployments change it as part of a
release. System rows are not writable through the API.

## Snapshot pattern

Every consumer that starts a run captures the complete exact intended values at
trigger time as `agent_run_config_snapshot_json`. The snapshot is the audit
record: later edits to the config row never affect in-flight or completed runs.
At execution, that snapshot is validated without filtering against the chosen
target's current launch-options revision.

## Authorization

Personal configs and personal default pins: the owning user only.
Organization configs and organization default pins: an active organization
role in `organization_admin_roles()`. System rows: deploy-time seeds only.
