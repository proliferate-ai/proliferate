# Session Runtime Contract (Boot Snapshot Replacement)

## Goal
Replace the broad `boot_snapshot`-as-primary contract with a cleaner immutable session contract made of normalized fields and session-scoped bindings.

## Status
- Applies to: V1
- Normative: Yes

## Core decision

V1 must not rely on one giant frozen JSON payload as the primary runtime contract.

Replace broad `boot_snapshot` with:
1. Small immutable `sessions` core fields
2. `session_capabilities` rows
3. `session_skills` rows
4. `session_messages` rows
5. `automation_runs` for per-wake manager execution context

`boot_snapshot` may still exist as a compatibility/debug envelope where needed, but it is not the authoritative model boundary.

## Immutable session core fields (required)

Each session must freeze core execution identity at creation:
- session kind (`adhoc_interactive | manager | worker_child`)
- actor/run-as policy
- automation linkage (`automation_id`, optional `automation_run_id`)
- repo/branch/base-commit baseline
- env bundle references (not plaintext values)
- compute profile
- visibility mode
- model/instruction references (if pinned)

These fields are immutable for in-flight execution.

## Session capabilities contract

`session_capabilities` is authoritative for runtime permissions.

Each row defines:
- `capability_key` (for example `sentry.read`, `child.spawn`, `github.pr.create`)
- mode (`allow | require_approval`)
- credential owner policy context
- optional scope limits (repo/project/resource)
- created-at/audit metadata

Rules:
- denied capabilities do not appear in agent-visible tooling
- live security revocations still override session-bound allow/approval states
- policy checks happen at invocation time in gateway

## Session skills contract

`session_skills` stores behavior packs attached to a session.

Each row defines:
- `skill_id`
- `version`
- optional config payload

Rules:
- skills shape behavior, workflow style, and prompting
- skills never grant permissions
- permission source of truth is always `session_capabilities`

## Session messages contract

`session_messages` stores queued instructions/events.

Supported directions:
- user -> session
- manager -> child
- child -> manager

Delivery rules:
- active session: inject at next safe reasoning checkpoint
- paused/waiting session: queue and inject on resume before next reasoning step
- no arbitrary mid-command interruption in V1

## Manager run linkage

Because manager session is persistent across wakes:
- every wake creates `automation_run`
- manager-side action/timeline/audit events must attach to active `automation_run_id`
- run-level inspectability is required even when `manager_session_id` is stable

## Environment and secret boundary

Storage:
- env bundles are encrypted at rest in control plane

Runtime boot/resume:
- decrypt env bundle at boot/resume
- materialize as process environment
- optional app-scoped env file materialization if tooling requires it

Safety:
- never persist plaintext env values in session metadata
- do not expose env values in UI payloads
- do not emit env values in logs by default
- do not persist env values in artifacts by default

Secret classes:
- repo/runtime env may materialize in sandbox runtime
- integration/OAuth/action secrets remain server-side unless explicitly projected into runtime env policy

## Mutable vs immutable

Immutable for current session execution:
- session core fields listed above
- `session_capabilities` bindings
- `session_skills` bindings

Mutable during execution:
- progress/status
- action outcomes and approval states
- emitted artifacts
- transient retries/checkpoints
- queued `session_messages`

## Enforcement requirements

1. Runtime authorization executes from immutable session core + `session_capabilities`.
2. Gateway validates invocation input shape, capability binding, credential policy, and live revocation state.
3. Mid-session automation/config edits do not alter active session bindings.
4. Resume/restart must preserve session contract identity and refresh short-lived credentials dynamically.
5. Live revocations/disabled integrations/credential invalidation override frozen session bindings immediately.

## Implementation file anchors

- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/tools.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`

## Core data models

| Model | Contract relevance | File |
|---|---|---|
| `sessions` | immutable session core identity and linkage | `packages/db/src/schema/sessions.ts` |
| `session_capabilities` | session-scoped permission bindings | `packages/db/src/schema/schema.ts` (target) |
| `session_skills` | session-scoped skill attachments/version pinning | `packages/db/src/schema/schema.ts` (target) |
| `session_messages` | queued inter-session/user instructions | `packages/db/src/schema/schema.ts` (target) |
| `automation_runs` | per-wake manager execution and audit grouping | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `action_invocations` | side-effect audit under session capability policy | `packages/db/src/schema/schema.ts` (`actionInvocations`) |

## Definition of done checklist
- [ ] Session contract is defined as core fields + capability/skill/message bindings
- [ ] New sessions persist immutable capability and skill bindings at creation
- [ ] Tool/action visibility excludes denied capabilities
- [ ] Manager-side actions are attributable to active `automation_run_id`
- [ ] Env handling is encrypted-at-rest and plaintext-free in metadata/log/artifact paths
- [ ] Runtime policy checks enforce live security overrides
