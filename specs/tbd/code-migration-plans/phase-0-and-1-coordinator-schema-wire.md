# Phase 0/1: Coordinator Package And Shared Wire Spine

## Docs Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/workers.md`
- `specs/codebase/structures/proliferate-worker/README.md`
- `specs/codebase/primitives/sandbox-provisioning.md`
- `specs/codebase/primitives/cloud-commands.md`
- `specs/codebase/primitives/agent-auth.md`
- `specs/tbd/code-migration/orchestration.md`

## Code Survey

Initial survey found the branch already had several target/profile-era tables and fields:

- `CloudTarget.sandbox_profile_id`, `profile_target_role`
- `CloudSandbox.sandbox_profile_id`, `target_id`, `billing_subject_id`
- `CloudWorkspace.sandbox_profile_id`, `target_id`, `cloud_workspace_id` command threading
- `SandboxProfileTargetState`
- `CloudTargetRuntimeAccess`
- worker control-state and exposure/projection stores

Initial survey found live slot/fence fields in the shared spine:

- `CloudWorker.slot_generation`
- `CloudTargetEnrollment.slot_generation`
- `CloudSandbox.slot_generation`, `superseded_*` slot replacement fields
- `CloudTargetRuntimeAccess.active_sandbox_id`, `slot_generation`
- `CloudCommand.leased_cloud_sandbox_id`, `leased_slot_generation`
- `SandboxProfileTargetState.active_sandbox_id`, `slot_generation`
- `CloudWorkspace.materialized_slot_generation`
- Rust worker identity, heartbeat, command envelope/result, pending results, and materialization plan slot checks
- server `slot_guard.py` callers in worker-facing config/materialization services

Final integrated state:

- Live server, desktop compute-domain, generated cloud SDK, and Rust worker code no longer reference `slot_generation`, worker `slotGeneration`, `leased_cloud_sandbox_id`, `leased_slot_generation`, `materialized_slot_generation`, `slot_guard`, or profile-slot helper names.
- Historical Alembic files may still mention old columns, but the new head migration collapses them to the ORM shape and schema assertions verify absence.

## Intended Behavior

Collapsed identity is the only live model:

- `target_id` is the runtime identity and epoch.
- A managed target is 1:1 with its provider sandbox.
- Worker auth/enrollment/heartbeat/commands/results/events correlate by `target_id`.
- Runtime/config/auth applicability is checked by `(sandbox_profile_id, target_id)`.
- Workspace materialization validity is `materialized_target_id == current active primary target_id`.

## Files / Modules Owned

Phase 0:

- `specs/tbd/code-migration/orchestration.md`
- `specs/tbd/code-migration-plans/**`

Phase 1:

- `server/proliferate/db/models/cloud/{targets,sandboxes,cloud_target_runtime_access,commands,agent_auth_profiles,workspaces}.py`
- `server/proliferate/db/store/cloud_sync/{worker_auth,commands,sandbox_profile_target_state,targets}.py`
- `server/proliferate/db/store/{cloud_sandboxes,cloud_runtime_environments,cloud_workspaces,billing,support_diagnostics}.py`
- `server/proliferate/server/cloud/worker/{models,service}.py`
- `server/proliferate/server/cloud/{runtime,commands,agent_auth,sandbox_profiles,webhooks,workspaces}/**`
- `server/alembic/versions/8b9c0d1e2f3a_target_sandbox_identity.py`
- Rust worker shared DTO/storage files under `anyharness/crates/proliferate-worker/src/{cloud_client,identity,store,commands,materialization,runtime}.rs`
- cloud SDK generation, desktop readiness types, and targeted tests that compile against the shared wire

## Files / Modules Explicitly Out Of Scope

- Full runtime provisioning rewrite in `runtime/provision.py` except call-site compatibility needed for the shared wire.
- Full worker folder reshape into `control/`, `tail/`, and `lifecycle/`; that belongs to the worker phase.
- Product UI cleanup.

## Data / Contract Changes

Remove slot/fence fields from the live schema and wire contract:

- `slot_generation`
- `leased_cloud_sandbox_id`
- `leased_slot_generation`
- worker request/response `slotGeneration`
- materialization plan slot-generation checks

Keep sandbox identity where it is provider/audit identity:

- `CloudSandbox.id`
- `CloudSandbox.external_sandbox_id`
- `CloudSandbox.target_id`

## Implementation Steps

1. Copied orchestration into `specs/tbd/code-migration/orchestration.md`.
2. Removed slot fields from ORM dataclasses/Pydantic/Rust DTOs.
3. Updated stores and services to validate current target by `target_id` and `archived_at`, not slot fields.
4. Replaced workspace materialization freshness checks with `materialized_target_id`.
5. Deleted `slot_guard.py` and moved shared worker target validation into `worker/target_validation.py`.
6. Updated worker local SQLite identity/pending-result schemas to stop reading/writing slot generation.
7. Added a forward Alembic migration to collapse old slot columns/indexes into the Target = Sandbox schema.
8. Updated generated cloud SDK and desktop readiness types.
9. Updated tests to assert target replacement behavior instead of stale slot behavior.
10. Ran targeted Python/Rust/TypeScript checks and final live-code greps.

## Backward Compatibility And Deletion Plan

This is a replacement migration. Old slot-aware paths should not be retained as fallbacks. Historical Alembic migrations may mention old columns, but live models, stores, services, worker DTOs, and current tests should not depend on them.

## Tests And Verification

Completed:

- `make cloud-client-generate`
- `cd server && DEBUG=true uv run pytest -q tests/integration/test_schema_migrations.py`
- `cd server && DEBUG=true uv run pytest -q tests/unit/test_cloud_runtime_ensure_running.py tests/unit/test_cloud_runtime_provision.py`
- `cd server && DEBUG=true uv run pytest -q tests/integration/test_sandbox_profile_foundation.py tests/integration/test_cloud_workspace_claims_api.py`
- `cd server && DEBUG=true uv run pytest -q tests/integration/test_cloud_commands_api.py tests/integration/test_cloud_agent_auth_api.py`
- `pnpm --filter proliferate exec vitest run src/lib/domain/compute/target-readiness.test.ts`
- `pnpm --filter @proliferate/cloud-sdk build`
- `pnpm --filter @proliferate/cloud-sdk-react build`
- `pnpm --filter proliferate exec tsc --noEmit --pretty false`
- `cargo check -p proliferate-worker`
- `git diff --check`

## Risks / Open Questions

- Historical migrations still describe the schema they originally introduced; final schema assertions cover the new head shape.
- Full repo-wide test suites were not run in the phase-local loop unless the coordinator chooses to run them after integration.

## Critique Responses

- Split Phase 0/Phase 1 concerns in execution by copying orchestration first, then using bounded workers for agent-auth, sandbox-profile, runtime provisioning, tests, and frontend/SDK.
- Added generated SDK handling and verified generation with `make cloud-client-generate`.
- Added schema migration coverage after tests exposed the old slot constraint on fresh DBs.
- Removed the `slot_guard` module instead of leaving a compatibility path.
- Converted stale slot-generation tests into target replacement/archived target semantics, deleting generation-only tests.
