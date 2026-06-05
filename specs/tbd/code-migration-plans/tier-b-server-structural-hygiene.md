# Tier B: Server Structural Hygiene

Status: executable planning target after PR 529 merges.

## Starting Baseline

Start after PR 529 merges and preferably after the Tier A worker follow-ons are
planned. PR 529 removes slot-specific seams and adds minimal target validation,
but large server files still need ownership-correct decomposition.

If Tier C agent-auth/Bifrost/billing feature work is queued, use this track to
extract the shared command/auth boundaries first. Do not run behavior changes in
`commands/service.py`, `worker/service.py`, or `agent_auth/**` in parallel with
structural moves of those same files.

## Docs To Read

- `AGENTS.md`
- `specs/README.md`
- `specs/codebase/structures/server/README.md`
- `specs/codebase/structures/server/guides/workers.md`
- Relevant primitive/feature docs for the file being split
- `specs/tbd/structure-alignment-coordinator-model.md` if using subagents

## Intended End State

- Route handlers remain thin API adapters.
- Stores own SQL and row mapping only.
- Services own product orchestration, not raw endpoint construction.
- Domain helpers own pure decisions and transition rules.
- Worker, command, provisioning, workspace, and agent-auth server surfaces are
  discoverable by ownership rather than collected in large service files.

## Owned Files / Surfaces

Likely hot spots:

- `server/proliferate/server/cloud/worker/service.py`
- `server/proliferate/server/cloud/workspaces/service.py`
- `server/proliferate/server/cloud/commands/service.py`
- `server/proliferate/server/cloud/runtime/provision.py`
- `server/proliferate/server/cloud/runtime/wake.py`
- `server/proliferate/server/cloud/agent_auth/**`
- Matching stores under `server/proliferate/db/store/**`

## Out Of Scope

- Behavior changes unless required to preserve semantics during extraction.
- Tier C feature behavior in command preflight, gateway/BYOK, or billing
  semantics. This track may create the boundaries those changes will use.
- Celery/durable job conversion.
- Worker control-loop transport changes.
- Frontend or SDK changes except import fallout from API shape changes.

## Migration Slices

1. **Inventory**
   - Generate large-file and dependency maps.
   - Identify mixed responsibilities per file.
2. **Worker service split**
   - Separate auth/validation, command lease/report, heartbeat/status, exposure,
     and control-loop-ready seams.
3. **Command service split**
   - Separate enqueue policy, idempotency/reuse, lease/result handling, wake
     orchestration, and API mappers.
4. **Workspace service split**
   - Separate lifecycle, creation/ensure/start, mobility/revision handling,
     detail assembly, and archive/purge.
5. **Runtime provisioning split**
   - Separate target registration, provider sandbox lifecycle, runtime access,
     and worker enrollment orchestration.
6. **Agent-auth service split**
   - Separate selection, runtime materialization, provider keys, gateway/BYOK,
     and worker reporting.
7. **Ratchets**
   - Tighten max-line allowlists or server structure checks when files shrink.

## Data / Contract Changes

None expected. If a split needs an API/schema change, carve it into a separate
feature or primitive migration.

## Backward Compatibility And Deletion Plan

Preserve public behavior. Delete old helper paths once moved. Do not leave
compatibility wrappers unless they are temporary and named with a deletion owner.

## Verification

- Targeted server tests for each split area
- `cd server && DEBUG=true uv run pytest -q` before final PR readiness when blast
  radius is broad
- `cd server && uv run python -m py_compile <touched files>`
- `git diff --check`

## Risks And Open Questions

- This track can conflict with active feature work in the same large files.
  Prefer one file family per PR, and sequence command/auth extraction before
  Tier C behavior changes in those files.
- Moving too much at once makes review hard. Preserve behavior and keep imports
  direct.

## Critique Prompts

Plan critique:

```text
Review the server structural hygiene plan. Are ownership boundaries correct per
server docs? Is behavior preserved? Are PR slices small enough and ordered
around hot files? Return findings first.
```

Implementation critique:

```text
Review the server split diff. Look for behavior changes hidden in moves, store
logic leaking into services, API concerns in domain helpers, duplicate old/new
paths, and missing targeted tests. Return findings first.
```
