# Agent Run Config

Centralized cloud agent configuration. One named row selects an agent kind, a
model, and a subset of non-model controls; every surface that starts cloud
agent work resolves through it. Owning code:
`server/proliferate/server/cloud/agent_run_config/` (service, api,
`domain/resolve.py`), models in
`server/proliferate/db/models/cloud/agent_run_config.py`, store in
`server/proliferate/db/store/cloud_agent_run_config.py`.

## The catalog is the source of truth

`catalogs/agents/v1/catalog.json` defines which agent kinds exist, which
models each kind accepts (`session.models[]`), and which controls each kind
accepts (`session.controls[]`). A `cloud_agent_run_config` row stores one
`model_id` plus non-model `control_values_json` under a human-readable name.
There is no separate options or validity subsystem: validity is always a
function of the current catalog.

Deliberate anti-decisions: no `validation_status`, no
`catalog_version_pinned_at`, no `is_starter_preset` column, no `revision`, no
background reconciler. A row key the catalog no longer recognizes is ignored
at render time and at run time — never repaired in the background.

## Three-phase validation

- **Write time** (create/patch): reject a `model_id` that is not an active
  catalog model for the agent kind; reject control keys outside the catalog's
  allowed set (the catalog `model` control is excluded — `model_id` owns that
  value); inline values must match `control.values[]`; dynamic values validate
  through the owning catalog helper, never hard-coded rules.
- **Read time** (selector render): intersect the row with the current catalog
  and render only the intersection; stale keys are ignored, surfaced only as
  an informational "unused settings" badge.
- **Run time**: intersect again — the catalog may have moved between render
  and dispatch. A missing kind/model fails with typed
  `agent_run_config_model_unavailable`; a required control with no value and
  no catalog default fails with `agent_run_config_missing_required`.

The selector and the run-time check share one pure helper:
`domain/resolve.py::resolve_runtime_values(catalog, config_row)` →
`ResolvedAgentRunConfig` (no I/O; `ignored_keys` reports dropped stale keys).

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

Every consumer that starts a run captures the resolved, post-intersection
values at trigger time as `agent_run_config_snapshot_json` (including
`ignored_keys`). The snapshot is the audit record: later edits to the config
row never affect in-flight or completed runs.

## Authorization

Personal configs and personal default pins: the owning user only.
Organization configs and organization default pins: an active organization
role in `organization_admin_roles()`. System rows: deploy-time seeds only.
