# Cloud / Shared Sandbox Spec Pack

Status: implementation-ready spec pack for the cloud/shared-sandbox architecture.

Date: 2026-05-20.

This directory is the canonical source for how the cloud control plane, shared
sandbox runtime, agent auth, and remote-access surfaces are designed and how
they are shipped.

Read [`00-sandbox-foundation.md`](00-sandbox-foundation.md) first. Every other
spec assumes the foundation is in place.

## Files

```text
00-sandbox-foundation.md          Cloud target / managed sandbox foundation.
01-mcp-skills-plugins.md          Sandbox-scoped MCP/skill/plugin runtime config.
02-agent-auth.md                  Sandbox-scoped agent LLM auth and gateway.
03-settings-admin-ia.md           Settings/Admin information architecture and shared UI primitives.
04-cloud-running-alignment.md     Cloud command queue, worker dispatch, projection, preflight.
05-claiming.md                    Shared unclaimed work, claim ownership, Desktop direct-attach tokens.
06-automations.md                 Scheduled/triggered work that reuses sandbox/auth/command primitives.
07-slack-bot.md                   Slack bot as a team-automation entrypoint.
08-web-mobile-dispatch.md         Cloud-mediated web/mobile clients and remote-access UX.
09-billing.md                     Entitlement, compute usage, managed credits, runtime blocks.
10-migration.md                   Move runnable workspace/session state between targets.
```

## Source Material

These specs are derived from, but supersede, the following planning bundles in
this repo:

```text
docs/current/cllloud/             Raw discussion notes that shaped the design.
docs/current/implementation/      Earlier numbered drafts (00, 01, 02, 04).
docs/current/overall.md           Phase ordering and prep steps.
docs/current/mockups/             Settings/Admin IA visual reference (settings-sample.html).
```

Treat those as input. If they conflict with the files in this directory, this
directory wins.

These specs also relate to existing authoritative architecture docs:

```text
docs/architecture/cloud-work-launch-model-spec.md
docs/architecture/cloud-worker-control-plane.md
docs/architecture/cloud-worker-implementation-phases.md
docs/architecture/cloud-worker-runtime-bundle-supervisor-spec.md
docs/architecture/cloud-worker-workspace-command-spec.md
docs/architecture/cloud-worker-automation-migration-spec.md
docs/architecture/target-runtime-mcp-skills-config.md
docs/architecture/shared-sandbox-config-admin-ui-spec.md
docs/architecture/agent-llm-auth-gateway-spec.md
docs/architecture/plugins-and-skills.md
```

When a spec in this directory contradicts an `architecture/` doc, this
directory describes the *target* and the architecture doc describes *current
shape*. Both should be updated as code lands.

## Canonical Vocabulary

Every spec in this pack uses these terms exactly. Do not substitute synonyms.

```text
sandbox_profile
  Cloud product/config root. One personal profile per user. One shared profile
  per organization. Physical table: sandbox_profile (existing, in
  db/models/cloud/agent_auth.py; will be broadened in spec 00 — not renamed).

cloud_target
  Addressable worker + AnyHarness runtime endpoint. Owns applied runtime state.
  Physical table: cloud_targets.

cloud_sandbox (= sandbox slot)
  Provider compute lifecycle row that backs a managed cloud target.
  Physical table: cloud_sandbox. Conceptually called "slot" in product copy.

slot_generation
  Monotonically increasing integer per (sandbox_profile_id, target_id). Bumped
  on slot replacement. Fences stale workers/commands across replacement.

cloud_workspace
  Durable Cloud product row for a workspace inside a sandbox profile.
  Survives slot pause/replace and AnyHarness restart.
  Physical table: cloud_workspace. Field `anyharness_workspace_id` is the
  runtime-side AnyHarness workspace id, filled in after worker materialization.

cloud_command
  Durable instruction queued for a worker. Physical table: cloud_commands.
  Field `workspace_id` is the AnyHarness workspace id (text, nullable until
  known); field `cloud_workspace_id` is the Cloud product row id.

target_runtime_config_revision
  Compiled MCP/skill/plugin runtime manifest for a sandbox profile target.

agent_auth_revision
  Selected per-harness auth materialization plan for a sandbox profile.

exposure
  Cloud policy admission for a runtime workspace/session: whether Cloud can
  list, project, and dispatch commands to it. Owned by
  cloud_workspace_exposure rows.

projection
  Cloud-side mirror of AnyHarness events at a defined level: index_only,
  session_summaries, transcript, or live. Owned by
  cloud_session_projection rows.

commandable
  Boolean flag on exposure/projection meaning Cloud-mediated clients may send
  prompts/actions to the workspace/session.

claim
  Ownership transition from shared_unclaimed to a single claiming user.
  Affects access policy only. Does not change projection mechanics or origin.

dispatch / remote access
  Make an existing runtime workspace visible/controllable through Cloud
  without moving runtime state.

migration / move
  Transfer runnable workspace/session state to another target. Separate from
  dispatch.

billing_subject
  Entitlement holder. Personal subject per user. Organization subject per org.
  Slots, workspaces, and managed-credit budgets are billed to the subject.
```

## Dependency Graph

Each spec depends on the foundation plus, optionally, earlier specs. Implement
in this order to keep launch fail-closed at every step:

```text
00 foundation
  └─ 01 mcp/skills/plugins              (sandbox runtime config)
  └─ 02 agent auth                      (sandbox auth selection)
       │
       ├─ 03 settings/admin IA          (depends on 00, 01, 02 owning their UI panels)
       └─ 04 cloud running alignment    (depends on 00, may reuse 01/02 preflight)
            │
            ├─ 05 claiming               (depends on 00, 04; exposes claim policy)
            ├─ 06 automations            (depends on 00, 01, 02, 04, 05)
            ├─ 07 slack bot              (depends on 06)
            ├─ 08 web/mobile/dispatch    (depends on 04; uses 05 claim verbs)
            ├─ 09 billing                (depends on 00 for slot/billing_subject;
            │                              gates 04 dispatch and 02 gateway)
            └─ 10 migration              (depends on 00; uses AnyHarness mobility)
```

## Cross-Cutting Rules

These rules are enforced by every spec in this pack. Restated in each spec
when the spec is responsible for the enforcement point.

- **One sandbox profile root.** All MCP/skill/plugin, agent auth, and managed
  cloud product config attaches to `sandbox_profile`. Do not invent a parallel
  config root in any spec.
- **One command/projection substrate.** Slack, automations, web, mobile, and
  Desktop cloud surfaces are clients of the same `cloud_commands` /
  `cloud_workspace_exposure` / `cloud_session_projection` substrate.
- **AnyHarness stays local/dumb.** AnyHarness does not know
  organization/publicization/billing/claim policy. It stores applied runtime
  projections. It does not call Cloud.
- **Cloud/Desktop own product source of truth.** Cloud writes desired state;
  worker applies it; AnyHarness mirrors it.
- **Launch fails closed.** Every launch-capable path preflights: sandbox slot
  ready, worker supports command kind, runtime config applied, agent auth
  applied, billing/entitlement allows run, claim/access policy allows command.
- **No nonfunctional controls.** Do not ship "Open in web", "Enable mobile",
  "Share with team", or "Move to another target" until the destination
  surface is real. Specs that introduce a verb own the surface that
  implements it.
- **UI lands with its backend slice.** Plugins UI lands with spec 01. Agent
  auth UI lands with spec 02. Compute readiness UI lands with spec 00.
  Claim UI lands with spec 05. Dispatch UI lands with spec 08.

## Migration Posture

There are no production users of this product yet. Specs do not carry
migration ceremony.

Concretely:

- **No dual-write or alias columns.** Renames happen in the same PR that
  ships the new name. Do not keep old column names "for one PR cycle".
- **No old + new code paths side by side.** When a new owner replaces an
  old one, the same PR rewrites callers and deletes the old code. No
  legacy bundle bridges, no fallback reads.
- **No additive migrations with backfill.** Replace the schema directly.
  Dev/test fixtures are updated to the new shape; there is no production
  backfill path to design around.
- **No worker version capability gates for "supports the new field".**
  Worker, server, contract, and SDK ship together in one PR. Workers
  inside the deploy boundary are not third-party and can be required to
  match the server version.
- **No "Phase N legacy cleanup".** If a spec describes both a new path
  and removing an old one, both happen in the same PR. Phases inside a
  spec exist only for genuine architectural sequencing (e.g. AnyHarness
  substrate must compile before Cloud writes against it), not for
  graceful rollout that we do not need.

Type-system back-compat is different from migration back-compat. Fields
that are `Option<…>` because they only apply to one of several call sites
(e.g. `sandbox_profile_id` exists for managed-cloud commands but not for
local-target commands) are fine and not what this rule restricts.

## Spec Format

Each spec follows this layout:

```text
1.  Purpose & Scope
2.  Mental Model
3.  Dependencies
4.  Current Repo State            (verified against code at the spec date)
5.  Target Model — DB / API / Runtime Contracts
6.  Files To Change
7.  Implementation Phases / Chunks
8.  Acceptance Criteria
9.  Verification / Tests
10. Open Questions                (only if genuinely unresolved)
```

Each section is grounded in the current repository code as of `2026-05-20`.
Where a planning note describes something that does not yet exist in code,
the spec says so explicitly under "Current Repo State" and treats it as new
work.
