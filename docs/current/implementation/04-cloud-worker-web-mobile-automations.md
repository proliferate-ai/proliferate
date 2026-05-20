# Cloud Worker, Web/Mobile, And Automations

## Mental Model

Cloud is the command queue and source of truth. Worker is the target-side
executor. AnyHarness is the local runtime.

```text
web/mobile/server action
  -> cloud command row
  -> worker leases command
  -> worker applies preflight/materialization if needed
  -> worker calls AnyHarness
  -> worker reports delivery/result/status
  -> cloud streams/persists result for web/mobile
```

Desktop is no longer required to be the live caller for cloud-managed targets.

## Cloud Source Of Truth

Core cloud concepts:

```text
target
  managed cloud sandbox or SSH-accessible target

sandbox profile
  target-independent desired sandbox configuration

target config
  repo/workspace/environment materialization state

cloud command
  durable instruction for worker

command result/status
  worker delivery, accepted/rejected/failed, payload/result metadata

session/event state
  cloud-visible representation for web/mobile/automation UI
```

Runtime capability and agent auth desired/applied revisions should be attached
to launch-capable commands so worker can preflight before dispatching.

## Runtime, Worker, And AnyHarness State

Worker responsibilities:

```text
lease commands
check worker capability gates
fetch materialization plans
apply MCP/skill runtime config when stale
apply agent auth config when stale
call AnyHarness
report results
sync session events back to cloud
```

AnyHarness responsibilities:

```text
run sessions
store local runtime config/status
fail closed on missing runtime material
expose local APIs to worker
```

Cloud responsibilities:

```text
authorize user/admin/API actions
create commands
persist command/session/automation state
provide materialization plans
own source-of-truth selections and credentials
```

## Refresh Or Apply Path

Launch-capable commands should follow this shape:

```text
server builds command payload with:
  target_id
  workspace/session intent
  sandboxProfileId
  required runtime capability revision, when applicable
  requiredAgentAuthRevision, when applicable

worker preflight:
  if target applied state is stale, fetch/apply latest materialization
  if AnyHarness local status is stale, repair or fail
  only then dispatch start/resume/prompt to AnyHarness
```

Automation commands should use the same path as user-initiated web/mobile
launches. The difference is trigger/source, not runtime semantics.

## Current Implementation Alignment

Current repo has the broad worker command machinery and target config
materialization path. The MCP/skill runtime config command is present in the
`viola` worktree.

Still needs clean end-state alignment:

```text
single command preflight model for MCP/skills + agent auth
web/mobile session creation through cloud commands
automation commands using same payload conventions
capability gates for workers that understand new preflight fields
clear desired/applied revision state per target/profile
```

## Open Questions

- Which command payload shape becomes canonical for web/mobile session start?
- Do automations pin runtime capability/auth revisions at trigger time, or
  always use latest sandbox profile state?
- Where should cloud persist the web/mobile session shell before worker accepts
  the command?
- What is the minimum mobile/web event stream for V1: command status only, or
  full transcript event sync?
