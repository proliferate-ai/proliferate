# Repo Onboarding and Baseline Lifecycle

## Goal
Define a simple monorepo-first onboarding contract that produces reusable repo baselines for future coding sessions.

## Status
- Applies to: V1
- Normative: Yes

## Core decision

V1 removes `configuration`, `configuration_repo`, and `configuration_secret` from the primary onboarding model.

Replace with a repo baseline model:
- one baseline per repo
- optional named monorepo targets within that baseline

## Baseline contract

Baseline stores:
- install/update commands
- run commands
- optional test commands
- default working directory/target
- preview port expectations
- env bundle references
- optional E2B workspace cache snapshot reference

### Baseline recipe structure (required)

Update/install recipe entries MUST support:
- `name`
- `command`
- `workingDirectory`
- `runPolicy` (`always | conditional`)
- optional `conditionalInputs` (for example lockfile/dockerfile/target change triggers)

Run service recipe entries MUST support:
- `serviceName`
- `command`
- `workingDirectory`
- `envMode` (`process_env | env_file | both`)
- `isLongRunning` (boolean)
- optional `expectedPorts`
- optional `healthCheck`
- optional `restartPolicy`

Optional test recipe entries SHOULD support:
- `name`
- `command`
- `workingDirectory`
- `isBlocking` (boolean)

## Core entities

| Entity | Meaning | Primary model/file |
|---|---|---|
| `repo` | Connected source-control repository | `packages/db/src/schema/repos.ts` |
| `repo_baseline` | Runnable baseline metadata and target command set | `packages/db/src/schema/schema.ts` (target) |
| `repo_baseline_target` | Named monorepo targets attached to a baseline | `packages/db/src/schema/schema.ts` (target) |
| `session (setup)` | Onboarding/setup run that validates baseline | `packages/db/src/schema/sessions.ts` (`sessionType = setup`) |
| `session (coding)` | Task-oriented coding run using baseline + task constraints | `packages/db/src/schema/sessions.ts` |

## Implementation file anchors

```text
apps/web/src/server/routers/
  onboarding.ts
  repos.ts
  sessions-create.ts
  sessions-submit-env.ts

packages/services/src/onboarding/
  service.ts
  db.ts

packages/services/src/repos/
  service.ts
  db.ts

packages/services/src/sessions/
  service.ts
  sandbox-env.ts
```

## Lifecycle contract

### 1) First-time onboarding
1. Connect repo.
2. Choose monorepo target(s).
3. Provide/select env bundle.
4. Run onboarding/setup session.
5. Validate install/run/test commands.
6. Persist `repo_baseline` (+ target records where applicable).
7. Mark repo ready.

### 2) Coding session creation
1. User/manager requests coding session for repo + task.
2. Session loads repo baseline.
3. Optional workspace cache snapshot is restored.
4. Session executes mandatory git freshness step.
5. Session runs baseline update/install recipe according to `runPolicy`.
6. Session starts baseline run services under process supervision.
7. Session exposes logs/service status/ports to UI + agent.
8. Session runs requested target/commands under task constraints.

### 3) Refresh/repair path
Trigger conditions:
- onboarding commands no longer work
- dependency/tooling drift
- explicit operator refresh request

Repair flow:
1. Run new onboarding/setup session.
2. Update repo baseline and targets.
3. Future sessions use refreshed baseline.
4. In-flight sessions keep their own immutable session contract.

## Required invariants

- Every coding session links to baseline identity (`repo_baseline_id` target contract).
- Baseline updates apply only to future sessions.
- Env values remain encrypted at rest; sessions carry refs, not plaintext metadata copies.
- Git freshness step always runs before task execution.
- Baseline granularity default is repo-level with named internal targets.
- Missing/stale workspace snapshots MUST fall back to repo-baseline bootstrap (never hard-fail solely due to snapshot loss).
- Correctness source is baseline + git freshness + recipes; workspace snapshot is optimization only.

## UX contract

Onboarding page must show:
- repo connected state
- selected monorepo targets
- baseline validation state
- ready-for-run indicator
- one-click baseline refresh action when stale

Session detail must show:
- baseline used
- target used
- whether cache snapshot was restored
- active services and service health
- service logs and exposed preview ports

## Definition of done checklist

- [ ] Onboarding creates `repo_baseline` instead of `configuration*`
- [ ] Session creation resolves baseline + target deterministically
- [ ] Git freshness step is mandatory in coding session bootstrap
- [ ] Repair flow refreshes baseline without mutating active sessions
- [ ] UX exposes baseline readiness and refresh state from durable DB rows
- [ ] Recipe schema supports `always|conditional` install/update execution policy
- [ ] Service model is first-class (name/cmd/cwd/env/ports/health/restart)
