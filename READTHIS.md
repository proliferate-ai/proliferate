# Proliferate Cloud Surfaces Redesign

This branch is a planning/spec branch for the next product and architecture
push. It is meant to be read and critiqued before implementation.

Start here, then read:

- `docs/architecture/cloud-surfaces-launch-plan.md`
- `docs/architecture/cloud-work-launch-model-spec.md`

## One-Line Architecture

```text
Commands down. Events up. AnyHarness orders. Cloud projects. Worker transports.
Desktop can direct-attach.
```

## Product Shape

Proliferate is a cloud/team agent platform with a rich Desktop workbench.

- Desktop is the full dev workbench: files, git, terminals, direct attach, local
  credentials, SSH/cloud/local work.
- Web is the team control room: workspaces, sessions, automations, runs, status,
  claim/continue, results.
- Mobile is supervision: active work, needs-attention, approvals, summaries,
  claim/continue.
- Slack is a thread adapter: start/link work, reply as prompt, show needs-input
  and completion updates.
- Automations are scheduled/manual work launch definitions over the same target
  and workspace model.

The goal is not to make every surface a mini Desktop. The goal is one shared
cloud work model rendered appropriately per surface.

## Core Components

```text
AnyHarness
  execution truth: sessions, workspaces, prompts, interactions, tools,
  local SQLite, normalized events

Cloud
  control plane: auth, teams, targets, commands, projections, automations,
  credentials, MCP policy, billing, audit, live fanout

Proliferate Worker
  thin bridge: enrolls target, reports inventory, leases CloudCommands,
  calls local AnyHarness, uploads events, applies target/workspace material

Desktop
  rich direct client plus cloud-aware control surface
```

## Target / Workspace / Session Model

```text
Target
  compute: managed cloud, SSH, desktop dispatch, local direct, self-hosted cloud

Workspace / Worktree
  repo checkout and unit of work on a target

Session
  AnyHarness execution inside a workspace
```

A target can host many workspaces/worktrees. A workspace usually stays on its
target. A session runs inside a workspace.

## Launch Model

The central spec is the four-layer launch boundary:

```text
1. Target bootstrap
   worker enrollment, inventory, versions, target Git identity

2. Workspace preparation
   repo checkout, fetch, worktree, AnyHarness workspace registration

3. Workspace/run materialization
   env vars, tracked files, setup script, MCP config, skills, agent credentials

4. Session execution
   start session, config updates, prompt, interactions, events
```

Key correction: Git identity is target bootstrap. Repo checkout/worktree is
workspace prep. MCP/env/agent credentials are workspace/run materialization.

## Current V1 Credential Stance

Long term, Proliferate should have a proper provider/team/service credential
gateway.

For V1, we use a bridge:

- GitHub auth is required.
- Personal work uses user-scoped/synced credentials where needed.
- Team/automation work may use user-synced credentials as an explicit V1 bridge.
- The UI/run metadata must make the “runs as” credential source visible.
- Claiming a run does not transfer sandbox ownership, Git identity, or provider
  credentials.

This is intentionally not the final enterprise credential design.

## Planned Implementation Shape

The main backend move is to extract shared work-launch logic so automations are
not the only owner of cloud work startup.

Planned package:

```text
server/proliferate/server/cloud/work_launch/
  models.py
  commands.py
  workspace.py
  service.py
```

Intended ownership:

```text
server/cloud/targets
  target bootstrap, enrollment, workers, readiness, versions

server/cloud/target_git_identity
  target-level Git identity materialization

server/cloud/work_launch
  shared target/repo/workspace/materialization/session launch contract

server/cloud/target_config
  lower-level workspace/run materialization implementation

server/automations
  definition, schedule, run snapshots, claim/retry/cancel

proliferate-worker
  target command execution and AnyHarness dispatch
```

## What To Critique

Please critique the plan against these questions:

- Are the domain boundaries right?
- Is `work_launch` the right shared abstraction, or should it be split
  differently?
- Does the target bootstrap vs workspace prep vs materialization distinction
  hold for managed cloud, SSH, local, Slack, web, and mobile?
- Does the V1 credential bridge create unacceptable security/product risk?
- Is storing evolving launch config as JSON on automations/runs acceptable for
  V1?
- Are we preserving AnyHarness as the execution source of truth?
- Are we avoiding the worker becoming a second backend?
- Are we keeping web/mobile/Slack from inventing separate command semantics?
- Are the proposed acceptance demos sufficient?

## Out Of Scope For This Branch

- Full implementation.
- Full centralized agent credential gateway.
- Full native mobile app implementation.
- Full Slack app implementation.
- Token-level cloud event persistence.
- Web/mobile IDE features.

This branch should give reviewers enough context to challenge the architecture
before implementation begins.
