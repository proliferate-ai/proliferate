# Boot Snapshot Contract

## Goal
Make run-time behavior deterministic by freezing critical execution context when a session/run starts.

Without this, live config edits can silently change in-flight behavior and break auditability.

## Scope
In scope:
- what is frozen at start
- where it is stored
- what is mutable after start
- how gateway/actions enforce it
- how environment references are represented safely

Out of scope:
- prompt engineering details
- sandbox provider snapshot internals

## Snapshot record location

Target contract:
- `boot_snapshot` is stored on session/run record as JSON (or side table keyed by session/run id).
- Gateway and action execution read from `boot_snapshot`, not mutable live coworker row.
- `boot_snapshot` is execution context only (not filesystem/memory checkpoint state).

Current related runtime store:
- `sessions.agentConfig`, `sessions.systemPrompt` in `/Users/pablo/proliferate/packages/db/src/schema/sessions.ts`.

## Required snapshot schema (logical)

```json
{
  "snapshotVersion": 1,
  "createdAt": "2026-02-27T00:00:00Z",
  "sessionId": "...",
  "runId": "...",
  "identity": {
    "actorUserId": "...",
    "requestedRunAs": "actor_user | org_system | explicit_user",
    "credentialOwnerPolicy": "prefer_user | prefer_org | strict_user | strict_org"
  },
  "model": {
    "provider": "anthropic",
    "modelId": "claude-sonnet-4-20250514",
    "temperature": 0.2
  },
  "instructions": {
    "systemPrompt": "...",
    "agentInstructions": "..."
  },
  "tooling": {
    "enabledTools": ["..."] ,
    "actionModeOverrides": {
      "linear:update_issue": "require_approval"
    },
    "connectorBindings": ["connector:uuid-1"]
  },
  "workspace": {
    "repoId": "...",
    "branch": "...",
    "baseCommit": "...",
    "configurationId": "...",
    "snapshotId": "..."
  },
  "compute": {
    "provider": "e2b",
    "templateId": "tpl_abc123",
    "imageDigest": "sha256:..."
  },
  "git": {
    "prOwnershipMode": "sandbox_pr"
  },
  "environment": {
    "envBundleRef": "env_bundle_uuid",
    "envBundleVersion": 3,
    "envDigest": "sha256:..."
  },
  "limits": {
    "maxDurationMs": 3600000,
    "maxConcurrentChildren": 3,
    "budgetCents": 500
  }
}
```

## Environment and secret boundary (required)

- `.env.local` (development env) is allowed as onboarding input.
- Raw `.env.local` values are persisted as encrypted env bundle records.
- `boot_snapshot` stores only references (`envBundleRef`, version, digest), never plaintext env values.
- Action/integration secrets (OAuth tokens, connector secrets) are not part of env bundle or boot snapshot payload.
- Runtime boot resolves env bundle values just-in-time through daemon-scoped secret context.
- Avoid exporting env bundles as global shell environment for unrelated sandbox processes.
- Optional compatibility mode may materialize an app-scoped `.env` file in workspace (excluded from VCS) when required by local tooling.

## Enforcement rules

1. Action invocation policy resolution must use snapshot identity + mode context.
2. Credential owner resolution must use snapshot policy defaults.
3. Tool availability in runtime must be subset of snapshot-enabled tools.
4. Mid-run edits to coworker config do not affect current run; they apply to next run only.
5. `boot_snapshot` writes must reject plaintext secret keys/values and only accept env references.
6. PR ownership mode is frozen per run (`sandbox_pr` or `gateway_pr`) and cannot mutate mid-run.
7. Resume/restart must request the pinned compute identity (`provider`, `templateId`, `imageDigest`) for reproducible runtime behavior.

Live-security override rule (TOCTOU safety):
- Frozen snapshot does not bypass live org security controls.
- At execution time, gateway/services must re-check live revocation/disablement state for integrations and credentials.
- Live revocations override frozen snapshot permissions immediately.

## Mutable vs immutable during run

Immutable for current run:
- run identity policy (`run_as`, credential owner policy)
- model and system prompt
- enabled tool set and action-mode override baseline
- workspace baseline ref (`repo/config/snapshot`) at run start
- compute baseline (`provider/templateId/imageDigest`)

Mutable during run:
- live progress summary/status
- emitted artifacts
- approval outcomes and invocation statuses
- retry counters and transient runtime state

## Size and retention constraints

- Target max snapshot payload size: `64KB` compressed JSON equivalent.
- Store full snapshot for audit retention window equal to session/run retention policy.
- If snapshot is externalized to object storage, DB must store stable reference + digest.

## Core files that consume this contract

- `/Users/pablo/proliferate/apps/gateway/src/hub/session-runtime.ts`
- `/Users/pablo/proliferate/apps/gateway/src/api/proliferate/http/actions.ts`
- `/Users/pablo/proliferate/packages/services/src/actions/service.ts`
- `/Users/pablo/proliferate/packages/services/src/sessions/service.ts`

## Core data models

| Model | Contract relevance | File |
|---|---|---|
| `sessions` | stores frozen execution context for session-scoped runs | `packages/db/src/schema/sessions.ts` |
| `automation_runs` | stores frozen context for automation execution runs | `packages/db/src/schema/schema.ts` (`automationRuns`) |
| `action_invocations` | records behavior evaluated under snapshot context | `packages/db/src/schema/schema.ts` (`actionInvocations`) |

## Definition of done checklist
- [ ] Snapshot schema is defined and versioned
- [ ] Snapshot is persisted at run/session creation
- [ ] Gateway/actions read frozen snapshot context during execution
- [ ] Mid-run config edits do not alter in-flight permissions/tools/model
- [ ] Snapshot retention and size policy are documented and enforced
