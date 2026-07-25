# Workflows V1 PR2 — AnyHarness Execution Spine

Status: implementation-ready planning document. This file is intentionally
non-authoritative until PR2 implements the contract and promotes the relevant
parts into the owning feature, primitive, and AnyHarness structure specs.

This plan is based on the current PR1 baseline, the current AnyHarness/server/
Desktop/worker code, and three adversarial Fable 5 review rounds followed by
code-anchored correction passes. It does not use old workflow branches or the
unimplemented broad cloud-command/recovery program as an implementation base.

Read with:

- [`../codebase/features/workflows.md`](../codebase/features/workflows.md) for
  the PR1 definition and input-template contract inherited by every run;
- [`../codebase/structures/anyharness/README.md`](../codebase/structures/anyharness/README.md),
  [`session-engine.md`](../codebase/structures/anyharness/specs/session-engine.md),
  and [`session-actor.md`](../codebase/structures/anyharness/specs/session-actor.md)
  for runtime ownership and live-session serialization;
- [`../codebase/structures/server/README.md`](../codebase/structures/server/README.md)
  for Cloud domain, Postgres, and background-task ownership;
- [`../codebase/structures/proliferate-worker/README.md`](../codebase/structures/proliferate-worker/README.md)
  for worker ownership, while treating its unimplemented `control/**` and
  `tail/**` target-shape docs as aspirational rather than current code; and
- [`../developing/testing/README.md`](../developing/testing/README.md) for the
  verification tiers.

## 1. Decision In One Page

PR2 builds one narrow execution spine:

```text
Cloud workflow definition + typed invocation arguments
  -> immutable input-resolved run bundle
  -> one target-specific delivery adapter
  -> idempotent AnyHarness PUT
  -> SQLite run + logical plan + arguments + bindings + observation
  -> workspace materialization + frozen target execution plan
  -> sequential workflow-run actor
  -> generic exclusive claim over each stage session
  -> bypass-equivalent prompt and optional goal execution
  -> terminal observation + claim release
```

Delivery is deliberately split by target because the network topology is
different:

```text
managed Cloud
  Cloud outbox/Celery task -> existing server-to-sandbox connection
  -> sandbox AnyHarness PUT

Desktop
  enrolled Desktop worker heartbeat pulls queued delivery
  -> local AnyHarness PUT
```

Managed Cloud does not wait for a Desktop and does not route through a new
sandbox-worker command bus. Desktop does not make React or Tauri the executor;
the lifecycle-managed worker is the authenticated pull adapter.

The AnyHarness `PUT /v1/workflow-runs/{runId}` contract is the delivery
correctness fence. Every transport is at-least-once. Repeating the exact run
payload returns the existing run; reusing the run ID for different content is
a conflict.

SQLite beside AnyHarness is the execution source of truth. Cloud stores the
immutable invocation, delivery progress, and only the latest monotonic runtime
projection. It never independently advances a step.

The workflow actor does not take ownership of a raw `LiveSessionHandle` and
does not put workflow logic into `SessionActor`. It acquires a durable generic
session-control claim and performs mutations through the existing session
runtime under an exact claim capability. Interactive mutations are rejected;
reads, transcripts, and event streams remain available.

Prompt execution is intentionally at-most-once after AnyHarness has durably
begun the local turn. The current event sink is not strict enough for that
promise: PR2 must atomically persist `turn_started` and the prompt-ID-bearing
user item, and must reject before ACP dispatch if that batch fails. A crash
after that batch but before the ACP request reaches the agent may fail a prompt
the agent never saw. PR2 accepts that narrow liveness loss because replaying an
ambiguous agent turn can duplicate external effects.

## 2. Locked Scope

PR2 must ship all of the following together:

- idempotent Cloud invocation and AnyHarness run acceptance;
- SQLite plan, typed arguments, runtime placement, session bindings, status,
  cursor, claims, and observations;
- exactly one sequential in-process driver per nonterminal run;
- new worktree, new scratch workspace, and existing-workspace placement;
- explicit existing-session binding by stage index;
- exclusive session acquisition without moving the live handle;
- interactive mutation rejection while a workflow owns a session;
- prompt-only and prompt-plus-goal steps;
- temporary application of the product's per-harness bypass-equivalent mode,
  followed by safe session-config restoration before release;
- unexpected-interaction detection and fail-safe cancellation;
- durable cancellation and exact claim release;
- restart reconciliation without blind prompt replay;
- direct managed-Cloud delivery while Desktop is off;
- Desktop pull delivery to local AnyHarness; and
- the minimal UI and real acceptance journeys that prove those contracts.

PR2 does not add:

- schedules, triggers, polling automations, or ECS scaling policy;
- Slack, pull-request, script, approval, or arbitrary action steps;
- parallel stages or agents;
- grants, function invocations, or a dynamic integration gateway;
- required-tool-call semantics;
- retries of failed agent work;
- DAGs, branches, outputs, or a generic command registry;
- a React execution loop;
- a new general-purpose worker control plane; or
- the old workflow recovery/security/automation state machine.

Those features must extend the run contract rather than replace its delivery,
claim, cursor, observation, or reconciliation rules.

## 3. Best-Practice Design Method

### 3.1 Start from acceptance journeys

The design is complete only if it can explain these concrete journeys:

1. invoke into a new local scratch workspace and finish two sequential prompts;
2. invoke into a deterministic repository worktree and survive a restart;
3. bind an existing idle session, reject human mutations, preserve reads, and
   return the session after completion;
4. run a prompt-plus-goal step and wait for both outcomes;
5. cancel an active turn and safely return the session; and
6. invoke into a managed sandbox and finish while Desktop is fully off.

Every table, phase, transport rule, and extension seam below exists to make one
of these journeys correct. Machinery that proves none of them is out of scope.

### 3.2 Put truth beside the side effect

| Truth | Owner |
| --- | --- |
| Definition, user intent, logical target, and delivery progress | Cloud Postgres |
| Managed-sandbox availability and direct delivery attempt | Cloud background task |
| Desktop target reachability and local handoff | Enrolled Desktop worker |
| Workspace, session, turn, goal, cursor, claim, and run status | AnyHarness SQLite |
| Live serialization for one workflow run | Workflow-run actor |
| Live serialization for one agent session | Existing session actor |

The system must not have Cloud and AnyHarness independently deciding which
step runs next.

### 3.3 Keep four lifecycles distinct

```text
invocation  immutable user request and input-resolved bundle
delivery    queued/attempting/accepted/failed/cancelled transport
run         accepted/preparing/running/finalizing/terminal execution
session     persistent agent session temporarily controlled by a run
```

An offline Desktop can have a valid queued invocation. A delivery can be
accepted while the run is still executing. A session remains after the run
releases it.

### 3.4 Treat distributed delivery as at-least-once

Exactly-once delivery is not a useful promise. The contract is:

```text
stable run ID + immutable payload digest + idempotent receiver
```

Managed background-task retries and repeated Desktop heartbeats may deliver
the same run more than once. That is expected.

### 3.5 Persist intent before an external effect

Every effect follows the same reasoning:

```text
persist phase + stable operation identity
  -> perform or reconcile the effect
  -> persist durable evidence + next phase + observation
```

For effects that cannot be made exactly-once, recovery chooses an explicit
safety bias. Worktree creation is reconciled by deterministic identity. A
locally begun agent turn is never replayed.

### 3.6 Serialize session control at the actual mutation choke point

The current runtime performs important mutations outside the actor mailbox:
close, dismiss, purge, model relaunch, goal operations, and loop firing are
examples. Therefore actor-only authorization is insufficient.

PR2 adds one generic `SessionControlService` beside the existing workspace
access gate. It owns durable claims and per-session mutation guards. Every
externally initiated session mutation passes through it before reaching an
actor or a store write. `SessionActor` stays workflow-agnostic.

### 3.7 Make restart semantics phase-specific

“Retry on restart” is not a policy. Each phase must answer:

- what durable evidence exists;
- whether the effect is safely repeatable;
- how to correlate an already-started effect; and
- whether ambiguity fails the run rather than replaying work.

The matrix in section 17 is a required implementation artifact, not advisory
documentation.

## 4. Current Baseline And Explicit Corrections

The plan relies on current code where it exists and names the required
additions where it does not.

Current, usable primitives:

- PR1 workflow definitions, templates, catalog validation, revisions, and UI;
- caller-supplied session prompt IDs;
- synchronous `PromptAcceptance::Started { turn_id }` before ACP send, with
  current turn events still requiring PR2's strict persistence upgrade;
- durable session events and restart repair for unclosed turns;
- native goal mirror and `GoalRuntime`;
- SQLite transactions through the current single connection/mutex and WAL;
- deterministic AnyHarness workspace creator context and worktree operations;
- direct server-to-sandbox AnyHarness access and sandbox materialization;
- Cloud runtime-worker enrollment and heartbeat for both Desktop and sandbox
  identities; and
- a Postgres transactional background outbox plus Celery relay substrate; and
- workspace operation leases and durable terminal-command setup records.

Required PR2 additions:

- the Cloud invocation/delivery domain and background task names/handlers;
- Desktop workflow fields on the existing worker heartbeat and one idempotent
  delivery-result route;
- a durable AnyHarness data epoch, stable for one SQLite data set and exposed by
  runtime info plus workflow responses;
- the AnyHarness workflow contract, domain, store, service, manager, and actor;
- a generic session-control service used by every mutation path;
- a workflow-run creator-context variant;
- a strict atomic session turn-begin batch plus indexed prompt-ID lookup;
- claimed-session event subscriptions, turn-finish/session-exit hooks, and a
  retained wake epoch for workflow drivers;
- strict fail-closed goal reconciliation and exact goal-lifetime lookup;
- deterministic orphaned-worktree adoption and workspace-domain scratch-repo
  creation; and
- workflow-specific Tier 2 and Tier 3 scenarios.

Corrections to the first draft that are locked into this plan:

- no unified new worker downlink for managed Cloud and Desktop;
- no claim enforcement solely at the actor mailbox;
- no claim acquisition that assumes every existing session is already live;
- no claim expiry or force-release timer;
- no assertion that a local `turn_started` proves the ACP agent received the
  prompt;
- no synchronous assumption about turn completion;
- no goal correlation by objective or one revision number alone;
- no unattended run without explicitly applying bypass-equivalent mode;
- no interaction failure path without an interaction wake; and
- no claim release merely implied on the success path;
- no target launch-option freeze before a new workspace exists;
- no cancellation transition written by a second state-machine driver; and
- no returned session that still carries workflow-owned work or autonomous
  configuration.

## 5. Ownership And Code Boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Cloud workflow domain | Invocation validation, interpolation, immutable bundle, target choice, delivery row, latest runtime projection | Runtime cursor or session commands |
| Cloud workflow tasks | Managed sandbox ensure/wake, direct AnyHarness delivery/cancel, bounded observation pulls | Step sequencing |
| Desktop worker | Authenticated Desktop pull, target-local placement resolution, local AnyHarness handoff, latest observation upload | Workflow semantics |
| Desktop native | Starting/stopping the worker and local AnyHarness sidecars | Polling or executing workflow steps |
| AnyHarness workflow domain | Run records, transitions, cursor, bindings, observations, reconciliation policy | Cloud target policy |
| AnyHarness workflow manager/actor | One sequential driver per nonterminal run and wake routing | Hidden durable truth |
| Session control domain | Generic exclusive claims and mutation admission | Workflow stages or prompt semantics |
| Session runtime/actor | Session start, live command ordering, prompt turns | Workflow cursor |
| Goal runtime | Native goal mutation and mirror | Workflow advancement |
| Product UI | Invoke, inspect, link, cancel, and explain controlled sessions | Delivery or execution loops |

Expected AnyHarness target shape:

```text
anyharness-contract/src/v1/workflows.rs

anyharness-lib/src/api/http/workflows.rs

anyharness-lib/src/domains/workflows/
  model.rs
  store/
  service/
  runtime/

anyharness-lib/src/domains/sessions/control/
  model.rs
  store.rs
  service.rs

anyharness-lib/src/live/workflow_runs/
  model.rs
  manager/
  handle.rs
  actor/
  steps/agent_prompt.rs
```

The raw live-session handle registry remains owned by `LiveSessionManager`.

## 6. Invocation And Resolved Bundle

### 6.1 Cloud invocation API

```http
POST /v1/workflows/{definitionId}/invocations
Idempotency-Key: <caller-generated key>
```

```json
{
  "expectedRevision": 3,
  "inputs": { "ticket": "PRO-123" },
  "target": { "kind": "managedCloud" },
  "placement": {
    "kind": "newWorkspace",
    "repository": { "kind": "definitionDefault" }
  }
}
```

Target is explicit and immutable:

```ts
type WorkflowExecutionTarget =
  | { kind: "managedCloud" }
  | { kind: "desktop"; desktopInstallId: string };
```

There is no automatic Desktop-to-Cloud fallback.

Placement is explicit:

```ts
type WorkflowInvocationPlacement =
  | {
      kind: "newWorkspace";
      repository:
        | { kind: "definitionDefault" }
        | { kind: "none" }
        | { kind: "environment"; repoEnvironmentId: string };
      baseRef?: string;
    }
  | {
      kind: "existingWorkspace";
      workspaceId: string;
      sessionBindings?: Array<{
        stageIndex: number;
        sessionId: string;
      }>;
    };
```

Existing workspace/session IDs are target-local. Cloud checks projected
ownership when possible; AnyHarness performs the authoritative validation.

`definitionDefault` is request syntax, not a value left for an asynchronous
delivery task to interpret. In the invocation transaction Cloud resolves it
against the selected target and snapshots one immutable logical placement:

- a null `defaultRepoConfigId` resolves to `none` and therefore `newScratch`;
- managed Cloud resolves a configured default to its eligible Cloud repository
  environment;
- Desktop resolves only an environment for the exact `desktopInstallId`;
- an explicit environment must match the user, target kind, and Desktop
  install when applicable; and
- multiple eligible Desktop local paths are
  `workflow_repository_environment_ambiguous`, never an arbitrary choice.

The snapshot contains stable repository identity, selected environment ID,
base ref, and setup identity/config needed for later resolution, but no
credential. Changing or deleting the definition default after invocation can
never redirect the run. Delivery only maps this frozen logical selection to a
target-local `repoRootId`.

### 6.2 Arguments and interpolation

Cloud validates against the exact PR1 declaration:

- unknown argument: reject;
- missing required argument: reject;
- wrong JSON scalar type: reject;
- non-finite number: reject;
- referenced but omitted optional argument: reject;
- malformed or undeclared template reference: reject.

Interpolation is single-pass and only replaces exact
`{{inputs.name}}` tokens in prompt and goal text. Inserted input text is never
scanned recursively for new tokens.

Canonical rendering:

- string: exact UTF-8 string;
- number: canonical finite JSON number text;
- boolean: lowercase `true` or `false`.

The server preserves both typed arguments and the authored definition
snapshot. It also produces input-resolved stages. AnyHarness does not fetch a
mutable definition or run a second template engine.

Cross-language golden fixtures must prove Python, Rust, and TypeScript agree on
validation, canonical JSON, and digest bytes.

### 6.3 Immutable logical bundle

```json
{
  "contractVersion": 1,
  "runId": "10000000-0000-4000-8000-000000000001",
  "definition": {
    "id": "20000000-0000-4000-8000-000000000001",
    "revision": 3,
    "schemaVersion": 1,
    "title": "Diagnose a ticket",
    "defaultRepoConfigId": "30000000-0000-4000-8000-000000000001",
    "validatedCatalogVersion": "2026-07-12.1",
    "inputs": [
      { "name": "ticket", "type": "string", "required": true }
    ],
    "stages": [
      {
        "harnessConfig": {
          "agentKind": "claude",
          "modelId": "sonnet",
          "effort": "high"
        },
        "steps": [
          {
            "kind": "agent.prompt",
            "prompt": "Investigate {{inputs.ticket}}.",
            "goal": {
              "objective": "Produce a diagnosis for {{inputs.ticket}}."
            }
          }
        ]
      }
    ]
  },
  "arguments": { "ticket": "PRO-123" },
  "resolvedPlacement": {
    "kind": "newWorkspace",
    "repository": {
      "kind": "repositoryEnvironment",
      "repoConfigId": "30000000-0000-4000-8000-000000000001",
      "repoEnvironmentId": "40000000-0000-4000-8000-000000000001",
      "repositoryIdentity": "github:proliferate-ai/proliferate"
    },
    "baseRef": "main"
  },
  "resolvedStages": [
    {
      "harnessConfig": {
        "agentKind": "claude",
        "modelId": "sonnet",
        "effort": "high"
      },
      "steps": [
        {
          "kind": "agent.prompt",
          "prompt": "Investigate PRO-123.",
          "goal": {
            "objective": "Produce a diagnosis for PRO-123."
          }
        }
      ]
    }
  ]
}
```

Digest scopes are distinct:

- `requestHash`: canonical normalized **caller request syntax**—definition
  ID/revision, arguments, target, and requested logical placement—computed and
  checked before resolving mutable defaults;
- `bundleDigest`: SHA-256 over canonical JSON of the immutable definition,
  arguments, resolved stages, and resolved logical placement; and
- `runtimePayloadDigest`: SHA-256 over the canonical immutable `run` object
  after target-local placement is fixed; the transport precondition and
  per-attempt monotonic `control` object are excluded.

`bundleDigest` is not decorative: both delivery adapters embed it, Cloud
validates that a Desktop-prepared runtime payload changes only target-local
placement fields, and AnyHarness recomputes the logical portion before
acceptance. The AnyHarness body and digests contain no credentials. AnyHarness
recomputes both rather than trusting supplied values.

## 7. Cloud Persistence

PR2 adds two one-to-one row families.

### 7.1 `workflow_invocation`

Immutable after insert:

```text
id
user_id
workflow_definition_id nullable, ON DELETE SET NULL
definition_revision
definition_schema_version
validated_catalog_version
title_snapshot
idempotency_key
request_hash
arguments_json
resolved_bundle_json
bundle_digest
target_kind
desktop_install_id nullable
logical_placement_json
resolved_placement_json
created_at
```

`logical_placement_json` is the normalized caller directive used by
`request_hash` (`definitionDefault`, explicit environment, or existing
workspace). `resolved_placement_json` is the frozen target-specific repository/
workspace selection created only for a new invocation and covered by
`bundle_digest`. Both are retained because they answer different audit and
replay questions.

Unique `(user_id, idempotency_key)` returns the existing invocation for the
same request hash and returns `409 workflow_invocation_idempotency_conflict`
for different content.

The service normalizes the caller request, computes/checks `request_hash`, and
returns an existing row **before** consulting current repository defaults. Only
a new idempotency key proceeds to frozen placement resolution and
`bundle_digest` creation.

### 7.2 `workflow_invocation_delivery`

Mutable row keyed by invocation ID:

```text
invocation_id
status                       queued | delivering | accepted | failed | cancelled
cloud_sandbox_id nullable
handoff_started_at nullable
attempt_count                target handoff evidence, not broker retry count
last_attempt_at nullable
runtime_payload_json nullable
runtime_payload_digest nullable
anyharness_run_id nullable
anyharness_workspace_id nullable
anyharness_data_epoch nullable       fixed before first target handoff
runtime_revision nullable
runtime_observation_json nullable
runtime_observed_at nullable
control_plane_runtime_outcome nullable  runtime_lost only
control_plane_runtime_outcome_at nullable
cancel_requested_at nullable
error_code nullable
error_message nullable
accepted_at nullable
finished_at nullable
updated_at
```

`delivering` is not a lease, but `handoff_started_at` is correctness evidence:
once a payload may have left Cloud, cancellation must converge at AnyHarness
rather than pretending delivery never occurred. A background task may retry a
`queued` or `delivering` row. The idempotent AnyHarness receiver resolves
concurrent or post-crash attempts.

The first canonical immutable `run` object fixed for a delivery is immutable;
each attempt constructs `{ run, control }` from it plus current cancellation
state. Managed Cloud persists `run` before the first `PUT`. Desktop uses one
idempotent worker progress route with `prepared`, `accepted`, `failed`, and
`runtimeLost` variants: the worker persists its candidate locally, reports
`prepared` **before** local `PUT`, and Cloud compare-and-sets the first body/
digest and returns that winning body.

Every attempt then uses the Cloud-custodied body. Exact replays are accepted;
a different prepared body loses the CAS and must not be sent.

Delivery progress is monotonic. A late `failed` result cannot overwrite
`accepted` or cancellation-pending state. Every result is bound to the exact
invocation, bundle digest, logical placement, target identity, and winning
runtime payload digest. `failed` is legal only for a deterministic rejection
that proves AnyHarness did not accept the run. Timeout, transport failure,
5xx, or an unparseable response after a `PUT` remains `delivering` and must be
reconciled against the same AnyHarness data epoch.

Delivery status and runtime status are separate. `accepted` means AnyHarness
durably owns the run, not that the run finished.

## 8. Target-Specific Delivery

### 8.1 Managed Cloud: direct server push

Invocation creation, delivery creation, and a
`workflows.deliver_managed_run` outbox task commit in one Postgres
transaction. PR2 adds that supported task and its idempotent Celery handler to
the existing outbox relay.

The handler:

1. reloads the invocation; an unoffered cancelled row exits, while a
   `delivering` row with cancellation pending must still converge at the
   target;
2. applies the live billing/availability gate;
3. uses the current `connect_ready_sandbox` materialization/wake path and
   reloads refreshed runtime credentials;
4. ensures AnyHarness is healthy;
5. reads AnyHarness's durable data epoch and fixes it on the delivery before
   the first possible handoff;
6. resolves the selected repository environment to target-local placement;
7. fixes the exact runtime payload/digest and `handoff_started_at` in
   Postgres before network I/O;
8. calls the sandbox directly with
   `PUT /v1/workflow-runs/{runId}`, carrying the fixed expected data epoch and
   current monotonic `cancelRequested` control bit; and
9. transactionally records acceptance and inserts the first observation task
   plus a cancel task when `cancel_requested_at` is set.

No sandbox worker downlink is involved. The server can already address
sandbox AnyHarness; introducing a second hop would add no delivery guarantee.

Concurrent handler attempts and a crash after the remote `PUT` but before the
Postgres update are safe: each retries the same body and receives the same run.
It must not skip that replay merely because cancellation arrived after the
first handoff. The replay carries `cancelRequested`, so an uncertain delivery
becomes an accepted-but-never-started cancelled run rather than an orphan.
That replay is legal only while runtime info reports the same stored data
epoch. Once handoff may have occurred, an epoch change or an authoritative
same-epoch absence for a previously accepted run records `runtime_lost` and
never re-PUTs into the replacement/empty runtime.

After acceptance, a bounded `workflows.observe_managed_run` task long-polls or
reads observations for a limited window, stores only greater revisions, and
in the same transaction inserts its successor outbox item while the run remains
nonterminal. A periodic stale-projection sweep repairs a missing chain. It must
not hold an unbounded Celery task for the whole agent run.

PR2 registers `workflows.reconcile_runtime_projections` in the existing Beat
schedule at a one-minute cadence. It scans only accepted nonterminal deliveries
whose observation timestamp is stale and whose control-plane runtime outcome
is null, then inserts idempotent observe outbox items.
`workflows.deliver_managed_run`, `workflows.observe_managed_run`, and
`workflows.cancel_managed_run` are added explicitly to the relay's supported
outbox task registry.

Cancellation of an already accepted managed run is cleanup, not a new paid
run. It resumes a paused sandbox even when the normal new-run billing gate
would reject, retries through provider unavailability, and sends cancellation
before allowing further workflow advancement. Irreversible sandbox
destruction, a changed durable AnyHarness data epoch after handoff, or an
authoritative same-epoch 404 for a Cloud-accepted run proves managed
`workflow_runtime_lost`; ordinary pause or unreachability remains
cancellation-pending.

### 8.2 Desktop: worker heartbeat pull

The renderer creates the Cloud invocation but never delivers it. Desktop
native continues only to ensure that AnyHarness and the enrolled worker
processes are running.

Current worker documentation reserves heartbeat for liveness and describes an
unshipped control long-poll. PR2 deliberately amends that invariant instead of
building the general control plane: the existing heartbeat becomes one bounded
workflow rendezvous while remaining the only poll. The same PR must update the
worker lifecycle/control specs.

The heartbeat request and response gain bounded workflow fields:

```ts
interface WorkerHeartbeatWorkflowReport {
  runtimeDataEpoch: string;
  observations: Array<{ runId: string; revision: number; snapshot: unknown }>;
  cancelAcks: Array<{
    runId: string;
    localState: "absent" | "accepted" | "terminal";
  }>;
  runtimeLossReports: Array<{
    runId: string;
    expectedDataEpoch: string;
    proof: "epochChanged" | "acceptedRunAbsent";
  }>;
}

interface WorkerHeartbeatWorkflowWork {
  queuedDeliveries: WorkflowDesktopDelivery[];
  acceptedRuns: Array<{
    runId: string;
    expectedDataEpoch: string;
    cloudRevision: number | null;
    cancelRequested: boolean;
  }>;
}
```

Uploads are retained in worker SQLite until a successful heartbeat response.
Cloud applies observations transactionally only at a greater revision;
duplicate request replay is harmless. Both directions have fixed item and byte
limits and naturally paginate across heartbeats.

The authenticated worker identity limits deliveries to the exact owner and
`desktopInstallId`. Only one non-revoked worker is active for that identity.
Selecting a delivery and recording `delivering`/`handoff_started_at` happen in
one Postgres transaction before the heartbeat response is returned; response
loss simply reoffers the same item.

For each queued delivery the worker:

1. persists any `cancelRequested` bit before network work;
2. reads the durable local AnyHarness data epoch; if Cloud already fixed a
   different epoch after handoff, reports `runtimeLost` and performs no `PUT`;
3. if local AnyHarness already has the run, verifies its digest against the
   Cloud-winning digest and reports adoption without re-resolving or re-PUT;
4. otherwise uses a Cloud-prepared body when present, or resolves logical
   placement to target-local IDs and persists a candidate in worker SQLite;
5. submits the candidate plus current data epoch through the idempotent
   progress route's `prepared` variant and uses the body/epoch Cloud returns
   from the first-writer CAS;
6. calls local AnyHarness `PUT` with that immutable body and the current
   expected data epoch plus monotonic cancellation bit;
7. reports `failed` only for a deterministic immutable rejection; after a
   timeout, 5xx, or malformed response it remains `delivering` and reconciles
   by `GET`, adopting an exact run, exact-re-PUTing only a same-epoch 404, or
   reporting `runtimeLost` on an epoch change; and
8. reports acceptance and continues normal heartbeats.

For each accepted nonterminal run, the worker reads the latest local snapshot
and uploads it on the next heartbeat. Cloud applies it only if its revision is
greater. A restarted/re-enrolled worker is re-told every accepted nonterminal
run with the acceptance epoch, so no ephemeral process memory is required. An
epoch mismatch or authoritative same-epoch 404 for such an accepted run reports
runtime loss and never recreates/re-PUTs it.

For each cancellation item, the worker durably records intent and calls local
AnyHarness cancel. A possibly handed-off but unreported delivery is completed
with the Cloud-winning body plus `cancelRequested` only under the same stored
data epoch, closing the crash after local `PUT` and before result reporting. An
epoch change records runtime loss instead. Only a delivery never handed to a
worker may be cancelled without target convergence.

An offline Desktop leaves delivery queued or cancellation pending. There is no
target fallback and no delivery lease. Same-epoch redelivery on every heartbeat
is harmless.

Accepted PR2 limitation: delivery and remote cancellation latency is bounded
by the heartbeat interval. A doorbell or long-poll may reduce latency later;
it is not required for correctness and must not be smuggled into PR2 as a
general command bus.

### 8.3 Cloud runtime projection

AnyHarness observations are authoritative. Cloud stores only the latest
snapshot using:

```sql
UPDATE workflow_invocation_delivery
SET runtime_revision = :revision,
    runtime_observation_json = :snapshot,
    runtime_observed_at = :observed_at
WHERE invocation_id = :id
  AND (runtime_revision IS NULL OR runtime_revision < :revision)
```

Managed tasks upload through direct reads; Desktop workers upload through
heartbeat. Lists and offline views use this projection. When a target is
reachable, the product may read or proxy the AnyHarness run directly for
freshest detail.

The stale-projection Beat reconciler applies only to managed delivery. Desktop
projection staleness self-heals when the worker reconnects because Cloud
re-advertises every accepted nonterminal run without a lost outcome and the
worker uploads the latest greater AnyHarness revision on heartbeat.

If a sandbox is paused/destroyed or a Desktop powers off before the latest
snapshot reaches Cloud, Cloud honestly shows the last observed revision until
the target returns. It must not invent terminal state. The only exception is a
separate, explicit `workflow_runtime_lost` control-plane outcome after proof of
irreversible sandbox destruction, a post-handoff durable data-epoch mismatch,
or authoritative same-epoch absence of a Cloud-accepted run. Pause,
unreachability, and ordinary Desktop offline state are never that proof.
That outcome lives in `control_plane_runtime_outcome`, never in the
AnyHarness revision/observation sequence and never by regressing delivery from
`accepted` to `failed`. A real terminal AnyHarness observation takes
precedence if one already exists; otherwise the UI presents the distinct lost
outcome with its proof timestamp. Once lost is recorded, delivery/observation
tasks and workers never recreate or re-PUT that run ID.

## 9. AnyHarness API

AnyHarness generates `dataEpoch` once in the same SQLite data set and exposes
it through runtime info plus every workflow acceptance/read/observation
response. It survives process restart and binary upgrade; only replacing or
resetting the durable runtime data creates a new epoch. Cloud/worker delivery
binds the epoch before first handoff, so a replacement empty runtime can never
silently accept a replay of a possibly executed run.

```http
PUT  /v1/workflow-runs/{runId}
GET  /v1/workflow-runs/{runId}
GET  /v1/workflow-runs/{runId}/observations?afterRevision=<n>
POST /v1/workflow-runs/{runId}/cancel
POST /v1/workflow-runs/{runId}/abandon-controlled-sessions
```

`PUT` behavior:

- `201`: body validated, run and initial observation committed;
- `200`: exact replay of the existing runtime payload digest/body;
- `409 workflow_runtime_epoch_conflict`: expected data epoch does not match the
  current SQLite data set; no run/workspace/session effect occurred;
- `409 workflow_run_delivery_conflict`: same ID, different immutable body;
- no workspace, session, or prompt effect before the initial transaction.

The wire envelope separates immutable delivery from monotonic control:

```json
{
  "expectedDataEpoch": "01J...",
  "run": { "contractVersion": 1, "bundleDigest": "...", "placement": {} },
  "control": { "cancelRequested": true }
}
```

`expectedDataEpoch` is fixed before the first handoff and checked against the
SQLite metadata **inside the same transaction and before run lookup/insertion**.
A mismatch is the typed no-effect conflict above; the adapter records
`runtime_lost` and never retries into that replacement data set. This closes a
reset race between runtime-info read and `PUT`.

`runtimePayloadDigest` covers `run`, not `expectedDataEpoch` or `control`.
Replaying the exact run with `cancelRequested: true` atomically sets
`cancel_requested_at` in the acceptance transaction or on an existing run.
Once true it cannot be cleared. A newly accepted cancelled run starts no
workspace/session/prompt effect. This is the target-side linearization point
for cancellation racing uncertain delivery.

The runtime placement is exact and target-local:

```ts
type WorkflowRuntimePlacement =
  | {
      kind: "newWorktree";
      repoRootId: string;
      baseRef?: string;
    }
  | { kind: "newScratch" }
  | {
      kind: "existingWorkspace";
      workspaceId: string;
      sessionBindings: Array<{
        stageIndex: number;
        sessionId: string;
      }>;
    };
```

Before accepting the run, AnyHarness validates contract structure, immutable
bundle/digest agreement, resolved-stage/template agreement, and target-local
placement shape. It cannot yet authoritatively resolve launch options for a
new worktree or scratch workspace because current launch options read the
materialized workspace environment.

Therefore acceptance stores the logical bundle first. During `preparing`,
after workspace and setup success but before session rows or prompts,
AnyHarness resolves all stages against that workspace's live launch options,
adds bypass-equivalent mode, and freezes `execution_plan_json` exactly once.
Existing-workspace delivery may preflight early but freezes at the same point.
Unavailable options become a terminal run error with no agent effect, not a
half-valid rejected delivery.

## 10. AnyHarness SQLite

Four row families are sufficient. Sequential V1 does not need one mutable row
per authored step.

### 10.1 `workflow_runs`

```text
id                            run/invocation ID, primary key
contract_version              exactly 1
runtime_payload_digest
definition_snapshot_json      immutable authored definition snapshot
arguments_json                immutable typed arguments
resolved_bundle_json          immutable input-resolved bundle
execution_plan_json nullable  frozen once after workspace-aware resolution
placement_json                immutable target-local placement
workspace_id nullable
resolved_base_commit_oid nullable  frozen before a new-worktree Git effect
workspace_setup_run_id nullable    deterministic and persisted before launch
status                        accepted | preparing | running | finalizing |
                              succeeded | failed | cancelled
phase nullable                materializing_workspace | acquiring_sessions |
                              waiting_workspace_setup |
                              resolving_execution_plan | starting_session |
                              reconciling_session | applying_harness_config |
                              setting_goal | dispatching_prompt |
                              waiting_for_turn | waiting_for_goal |
                              clearing_step_goal | stopping_owned_work |
                              clearing_owned_goal | resolving_interaction |
                              restoring_session | abandoning_control |
                              releasing_control
terminal_intent nullable      succeeded | failed | cancelled
cleanup_disposition nullable  close_and_abandon
current_stage_index nullable
current_step_index nullable
current_session_id nullable
current_prompt_id nullable
current_turn_id nullable
current_turn_outcome nullable
current_goal_id nullable       native goal lifetime fence
current_goal_min_revision nullable
current_goal_status nullable
current_goal_operation_id nullable
current_goal_prior_id nullable
current_goal_prior_revision nullable
revision                      monotonic, starts at 1
cancel_requested_at nullable
abandon_requested_at nullable
error_stage_index nullable
error_step_index nullable
error_code nullable
error_message nullable
created_at
started_at nullable
finished_at nullable
updated_at
```

Status/phase mapping is explicit:

| Status | Allowed phases |
| --- | --- |
| `accepted` | none |
| `preparing` | `materializing_workspace`, `waiting_workspace_setup`, `resolving_execution_plan`, `acquiring_sessions`, `starting_session`, `reconciling_session`, `applying_harness_config` |
| `running` | `starting_session`, `reconciling_session`, `applying_harness_config`, `setting_goal`, `dispatching_prompt`, `waiting_for_turn`, `waiting_for_goal`, `clearing_step_goal` |
| `finalizing` | `stopping_owned_work`, `clearing_owned_goal`, `resolving_interaction`, `restoring_session`, `abandoning_control`, `releasing_control` |
| terminal | none |

Later newly created stage actors may start lazily, and every stage still
applies its config immediately before its first prompt. Start/reconcile/config
phases are therefore legal under `running`; the run never regresses from
`running` to `preparing` between stages. Reused bindings have already passed
strict acquisition reconciliation before the first workflow prompt.

Every success, failure, and cancellation first records `terminal_intent` and
enters recoverable `finalizing`. `terminal_intent` is monotonic: the first
non-null value wins under revision CAS and a later cancel request cannot rewrite
it. If cancellation wins the CAS before an intent is selected, the actor sees
the marker and selects `cancelled`; if success/failure intent wins first, the
late marker remains audit/control evidence while that chosen outcome finishes.

The actor stops exact workflow-owned work, clears its goal/interaction/queued
prompt, restores safe session configuration, and verifies quiescence. It then
acquires the workspace lease and every session guard, and claim deletion plus
the final terminal transition occur in one SQLite transaction. The guards
remain held through commit. This prevents both premature release and an
interactive mutation slipping between cleanup and claim deletion.

Every transition compares the expected revision, increments once, and appends
the corresponding observation in the same transaction.

### 10.2 `workflow_run_stage_bindings`

```text
run_id
stage_index
session_id
session_source                created | reused
effective_harness_config_json
restore_harness_config_json nullable until captured before first config
                               mutation; exact prior config for reused
                               sessions, safe interactive config for created
claim_id
acquired_at
released_at nullable
primary key (run_id, stage_index)
unique (run_id, session_id)
```

One authored stage means one session. Two stages cannot bind the same session
in V1.

### 10.3 `session_control_claims`

```text
session_id                    primary key, FK sessions ON DELETE RESTRICT
owner_kind                    workflow_run
owner_id                      FK workflow_runs ON DELETE RESTRICT
claim_id                      unique unguessable capability
acquired_at
updated_at
```

There is no clock expiry. Claim and owner live in the same SQLite database;
time-based expiry could admit an interactive mutation while an old driver is
still live.

Session deletion, dismissal, workspace purge, and run-history deletion are
blocked while a claim exists. Normal terminal cleanup removes claims first.
Foreign keys prevent orphaning a claim through ordinary deletion.

### 10.4 `workflow_run_observations`

```text
run_id
revision
snapshot_json
observed_at
primary key (run_id, revision)
```

The run update and observation insert share one transaction. PR2 never compacts
workflow observations because no Cloud-to-AnyHarness acknowledgement contract
exists yet. Retention/acknowledgement is follow-up work.

The immutable plan, cursor, and terminal error location derive all stage/step
presentation states. Past prompt/turn details remain in the bound session's
durable transcript and deterministic prompt provenance; a mutable step ledger
would duplicate truth.

## 11. Sequential Workflow-Run Actor

AnyHarness owns one `WorkflowRunManager` and at most one live actor per
nonterminal run ID. The manager:

- de-duplicates concurrent starts;
- starts the actor after the initial run transaction commits;
- scans nonterminal runs during app startup;
- accepts cancel wakeups;
- routes claimed-session turn, goal, and interaction wakeups; and
- removes an actor only after the run becomes terminal.

The actor is a loop over durable truth:

```text
load run
  -> honor durable cancellation
  -> reconcile current phase from durable target evidence
  -> perform at most the next required effect
  -> commit next phase/cursor + observation
  -> wait for a hint, then reload
```

Wakeups are hints, not truth, but they cannot be lossy edges. Each actor owns a
retained monotonic `watch` epoch, subscribes **before** loading durable state,
and rechecks the epoch immediately before sleeping. A bounded reconciliation
timer is the final backstop. An event committed between read and wait-arm
therefore causes another loop without requiring process restart.

PR2 does not silently widen `SessionEventObserver`, which currently does not
receive all routine persisted events. The workflow manager instead uses:

- `SessionExtension::on_turn_finished` for terminal turns;
- a per-claimed-handle broadcast subscription for persisted error, goal, and
  interaction events;
- a narrow new session-exit extension hook; and
- direct cancel wake increments after the cancel transaction.

Those sources advance the owning run's wake epoch for:

- turn start/finish/error;
- goal update/met/failed/cleared;
- interaction requested; and
- actor/session shutdown.

The actor rereads SQLite and session events after every wake. Process-loss gaps
are repaired by startup scanning and durable reconciliation.

Step dispatch is a typed, narrow seam:

```text
WorkflowStepExecutor
  agent.prompt -> AgentPromptStepExecutor
```

There is no generic JSON command interpreter.

## 12. Workspace Placement

### 12.1 Repository worktree

The delivery adapter resolves a Cloud repository choice to a target-local
`repoRootId`. AnyHarness owns the worktree effect.

PR2 adds this creator context:

```json
{ "kind": "workflowRun", "runId": "<run-id>" }
```

Branch, target path, display identity, and creator context derive from the run
ID. Before any Git mutation, AnyHarness resolves the symbolic base ref to an
exact commit OID and durably freezes it on the run. Worktree create and orphan
adoption use that OID, so movement of `main` cannot change one run.
`ensure_workflow_worktree` may reuse a workspace only when repo root, resolved
base OID, branch, path, and creator context all match. Any different collision
is `workflow_workspace_conflict`.

Recovery must explicitly test the crash after Git creates the worktree but
before the workspace row commits. Creator context cannot prove this orphan,
because it exists only in the missing row. PR2 adds a distinct
`adopt_orphaned_workflow_worktree` path that verifies the deterministic repo
root, Git worktree registration, path, branch, and frozen base OID for the run
ID, then inserts the row with workflow creator context. Existing
`create_worktree` path/branch conflict behavior is not reused for adoption.
Any mismatch is a conflict; no suffixed duplicate is created.

There is no generic workspace `ready` bit. The workflow materialization path
suppresses ordinary automatic setup and the post-create retention pass until
the workspace-to-run link commits. It derives a deterministic setup operation/
terminal-run ID, persists that ID and `waiting_workspace_setup` **before**
process dispatch, then calls a new idempotent start-by-ID API. The run waits for
durable terminal success. Failure is terminal-before-session; restart uses the
exact terminal-command evidence and never blindly reruns an ambiguous setup
script. Cancellation finalization stops/waits for that exact command before
terminating. Once linkage is durable, normal retention may be scheduled. The
workspace remains for inspection after the run.

Workspace retention, manual retire/mark-done, and checkout deletion must treat
a nonterminal workflow run for that workspace or any session claim as an
authoritative blocker. Startup orphan adoption/reconciliation runs before
inventory retention can retire a deterministic workflow checkout.

### 12.2 Scratch workspace

PR1 permits no repository, while current AnyHarness sessions require Git
identity. `newScratch` uses a deterministic run-derived container:

```text
<managed-scratch-root>/workflow-runs/<run-id>/
  owner.json
  workspace/
```

`workspace/` is the workspace root; `owner.json` stays outside the agent's
repository. Under the workflow workspace-operation lease and a keyed path
guard, materialization:

1. creates the outer directory without following a symlink;
2. atomically writes an owner record containing contract version, run ID,
   creator kind, and runtime data epoch before creating the inner repository;
3. creates `workspace/`, initializes an empty Git repository with the runtime's
   managed identity, and read-back-verifies its root; and
4. registers/reuses the workspace only with the exact workflow-run creator
   context, then durably links it to the run before retention is admitted.

Recovery distinguishes exact crash residue from foreign content. An absent
container starts normally. An empty, non-symlink container without
`owner.json` is the only pre-provenance crash window and may be adopted while
holding the path guard. An exact owner record for the same run/data epoch may
resume missing Git initialization or workspace-row insertion idempotently. If
the row is still absent, only the expected owner/repository artifacts may be
present because no prompt can precede linkage; unexpected files conflict.
After an exact row/link exists, normal workflow contents are preserved. A
mismatched owner, data epoch, creator context, symlink, Git root, or unexpected
unowned content is `workflow_workspace_conflict`; PR2 never deletes or suffixes
it.

PR2 extracts this managed-repository primitive into the workspace domain; it
does not import cowork's private helper.

Cloud and the renderer never supply an arbitrary filesystem path.

### 12.3 Existing workspace

AnyHarness verifies the workspace exists, is active/mutable, and belongs to
the receiving runtime. An explicit binding must:

- identify a stage index exactly once;
- belong to the selected workspace;
- use the stage's exact `agentKind`;
- be neither closed nor dismissed;
- have no other control claim; and
- pass the acquisition readiness checks in section 13.

Unbound stages get newly created session rows in the selected workspace.

## 13. Session Acquisition And Ownership

### 13.1 A claim, not a handle transfer

`LiveSessionManager` continues to own all live handles. Workflow code receives
only an opaque mutation authority:

```rust
enum SessionMutationAuthority {
    Interactive,
    WorkflowRun { run_id: String, claim_id: String },
}
```

The public session read model exposes only:

```ts
controlOwner?: {
  kind: "workflowRun";
  runId: string;
  acquiredAt: string;
};
```

The `claimId` is never returned publicly.

### 13.2 One generic mutation admission boundary

`SessionControlService` owns a keyed in-process mutex per session plus the
durable claim store. Every top-level mutating runtime operation acquires a
guard, checks its authority against the claim, and holds the guard until the
actor accepts/rejects the command or the direct durable mutation finishes.

The admission API is non-reentrant: after one top-level check it passes an
opaque internal mutation permit to lower-level operations rather than
reacquiring its own guard. Multi-session/tree/workspace operations first take
the existing workspace operation lease, precompute every affected session,
acquire all session guards in stable ID order, validate every claim, and only
then mutate. Recursive close and workspace purge therefore fail before
partially closing siblings. Claim acquisition and release use the same lock
order: a new `WorkspaceOperationKind::WorkflowControl` lease, then sorted
session guards. Existing exclusive workspace operations wait on that lease and
then recheck durable claims/nonterminal runs before effects.

This applies to:

- prompt dispatch and pending-prompt edits/reorder/delete/steer;
- session start, close, dismiss, restore, delete, and workspace purge;
- model/config mutation and relaunch;
- cancel;
- goal set/clear;
- interaction resolution;
- loop create/update/fire/delete;
- fork and delegated-session lifecycle; and
- product/domain operations that mutate the session or its actor.

Existing interactive APIs use `Interactive`. Workflow code calls internal
controlled runtime methods with the exact run/claim capability. Raw mutating
handle calls must remain behind this runtime boundary.

Background loop fire is an interactive top-level mutation and must use the
same admission path; it cannot continue sending directly through a raw handle.
`session_controlled_by_workflow` is a skipped fire, not `None`/permanent disarm
and not the current busy retry spin: the loop remains durably armed and may
resume only after claim release. Acquisition still rejects any already-active
loop.
Process shutdown may drop live actors, but it never converts that teardown into
a user close/dismiss or releases a durable claim.

Reads, transcript replay, run/session GETs, and SSE/event subscriptions do not
take the mutation guard and remain available.

### 13.3 Race-free acquisition

To acquire all stage sessions before the first workflow prompt:

1. acquire the workspace operation lease, then every reused-session guard in
   stable session-ID order;
2. verify no durable claim;
3. inspect actor-owned readiness when live: idle, no queued prompt/config,
   no pending interaction, and no background work;
4. inspect domain-owned readiness outside the actor: no active loop and no
   nonterminal goal;
5. validate workspace, harness, and effective launch config;
6. pre-generate IDs for every unbound stage; and
7. in one SQLite transaction insert every new session row, every binding,
   every claim, and the run transition/observation—or none; and
8. release the guards and workspace lease.

No external mutation can pass its admission check between readiness validation
and claim commit. Failure leaves no partial claim.

If an interactive mutation acquires the guard first, acquisition observes its
accepted/busy/queued result and fails readiness. If acquisition commits first,
the later interactive mutation returns `409 session_controlled_by_workflow`.

### 13.4 Non-live and newly created sessions

An existing non-live session is claimed before AnyHarness starts/publishes its
actor. Starting it then uses workflow authority. This closes the visibility
gap where an interactive request could otherwise start and mutate the actor
first.

All stage rows/claims are therefore prepared before the first agent prompt.
After that atomic claim transaction, every **reused** binding is brought live
under workflow authority when needed and passes strict control-acquisition
reconciliation before any workflow-authored config, goal, or prompt effect in
any stage. Only actors for newly created sessions may start lazily when their
stage begins.

Starting a claimed session is not sufficient readiness proof. The current
attach hook is permissive/fire-and-forget and may return success on missing
handle, native read failure, or malformed response. PR2 adds a strict
control-acquisition read/reconcile that requires the live handle, fails closed
on native/read/shape failure, returns the reconciled goal head, and then
rechecks readiness. If it discovers a preexisting user goal, the run enters an
acquisition-rollback finalization branch that preserves that foreign goal and
releases all claims without applying workflow config or clearing it. Because
all reused bindings are reconciled up front, this is a no-workflow-authored-
effect rollback even for a later stage. Only after every reused binding passes
may workflow configuration or prompting begin.

Claims stay through the whole run. A completed early stage is not returned to
interactive control while the run is still reconciling or cancellable.

At process bootstrap, durable claims are loaded before normal session start or
generic unclosed-turn repair is admitted. Claimed sessions remain fenced until
the workflow manager has reconciled them. This is an enforceable startup gate,
not merely actor-start ordering.

## 14. Effective Harness Configuration

After workspace setup and before session acquisition, each stage is checked
against the workspace-aware `/v1/agents/launch-options` semantics and resolved
to an effective config:

- exact `agentKind`;
- concrete model, using target default when PR1 omitted `modelId`;
- concrete effort/reasoning option when applicable; and
- the product bypass-equivalent execution mode.

The bypass mapping is product policy shared with the existing cowork path, not
a workflow-authored field:

```text
claude -> bypassPermissions
codex  -> full-access
agent with no mode control -> no mode override
```

The implementation should extract the existing mapping into an ownership-
correct shared session/agent policy helper rather than importing workflow code
from the cowork domain.

Before a stage's first prompt, the driver applies and read-back-verifies the
effective config under workflow authority. For a reused session, omission in
PR1 means the target default resolved for this run; it does not preserve an
arbitrary old interactive selection.

Failure to apply or verify any effective option is terminal before that
stage's prompt.

The bypass override is temporary. Before the first workflow config mutation,
each binding durably stores a restoration config. A reused session records its
exact prior model/effort/mode. A workflow-created session records the same
model/effort with the workflow-only autonomous override removed, yielding the
target's safe interactive mode. Finalization applies and read-back-verifies
that restoration config before claim release. A restoration failure leaves the
run safely nonterminal in `finalizing`; it never exposes a bypass-configured
session to interactive mutation. `workflow_session_restore_failed` is the
retryable cleanup diagnostic while finalization retains control; only a proven
permanent failure becomes `workflow_session_cleanup_requires_abandon` and
offers the owner-confirmed close-and-abandon action.

## 15. Prompt And Goal Execution

For one `agent.prompt` step:

1. select the bound stage session and verify its exact claim;
2. if a goal exists, persist a deterministic goal-operation ID plus the prior
   goal-head ID/revision **before** native mutation;
3. set/re-arm it while the actor is idle, reconcile native state as needed,
   and persist the resulting confirmed internal lifetime ID/minimum revision;
4. derive
   `promptId = workflow/{runId}/{stageIndex}/{stepIndex}`;
5. commit `dispatching_prompt` and that prompt ID;
6. send the resolved prompt under workflow authority;
7. require `PromptAcceptance::Started`, persist the returned turn ID, and
   enter `waiting_for_turn`;
8. receive retained wake hints through the claimed-handle subscriptions and
   extension hooks, then derive truth from durable session events;
9. if the turn succeeds and the step has a nonterminal goal, enter
   `waiting_for_goal`; and
10. after a goal step succeeds, clear that exact goal lifetime and confirm its
    mirror state before advancing the cursor; otherwise advance only when the
    completion predicate succeeds.

`PromptAcceptance::Queued` is an invariant failure: an exclusively controlled
idle session may not queue a workflow prompt. Finalization must remove the
exact deterministic queued prompt before releasing control.

Completion:

| Step | Success | Failure |
| --- | --- | --- |
| prompt only | correlated turn completed | correlated turn failed, cancelled, interrupted, or requested an unsupported interaction |
| prompt + goal | correlated turn completed **and** the same goal lifetime reached `met` at revision >= the stored minimum | turn failure/cancel/interruption, or that goal lifetime reached `failed`/`cleared` |

Goal objective text is not identity. Consecutive steps may use the same
objective. The internal goal record ID fences one native goal lifetime; the
stored revision is a minimum correlation anchor, not the revision expected to
be terminal.

Turn outcome is derived durably:

- `cancelled`: matching `turn_ended(cancelled)`;
- `failed`: a matching error event in the sequence window from that turn's
  `turn_started` through `turn_ended`, whether or not `turn_ended` exists;
- `completed`: non-cancelled `turn_ended` and no error in that sequence window;
- `open/ambiguous`: `turn_started` without error or `turn_ended` after process
  loss.

### 15.1 The prompt replay fence

The current session sink emits `turn_started` and the user-message item as
separate best-effort writes, so its existing comment is not a correctness
fence. PR2 adds a strict batch API: `turn_started` plus both prompt-ID-bearing
user-item events commit atomically, sequence allocation advances only after
commit, and any failure returns `PromptAcceptError` before `Started` or ACP
send. That batch proves a local turn began; it does not prove the agent
received the request.

PR2 also adds a queryable `prompt_id` projection/index on session events so
recovery can map the deterministic prompt ID back to its turn without JSON
scanning.

Recovery rules:

- no local turn for the prompt ID: safe to dispatch;
- a local turn exists: bind that turn and never dispatch the prompt again;
- the bound turn has a durable terminal outcome: apply it;
- the bound turn is still open after AnyHarness process loss: record
  `workflow_turn_outcome_unknown`, confirm the old actor/process is gone,
  append the normal cancelled repair while the claim remains held, and enter
  finalization; never replay.

Generic session start/repair must exclude claimed sessions until workflow
reconciliation records the unknown outcome. The workflow then invokes the
normal repair under its claim before release, leaving no interactive window
with an open durable turn.

Cancellation in `dispatching_prompt` cannot rely on `current_turn_id`, because
the actor may have durably begun the turn before the run row stores the returned
ID. It always queries the deterministic prompt ID and cancels the correlated
turn when present.

Goal set never advances from a provisional `pending_injection` response. The
driver waits for the mirror or performs native reconcile; exact recovery uses
a new goal-history lookup by lifetime ID because `current_goal` intentionally
hides a cleared head. A confirmation that remains absent is a terminal-before-
prompt failure. On restart, the persisted prior-head baseline and exclusive
claim distinguish the new workflow lifetime; the driver never blindly
reissues a pending native set.

### 15.2 Unexpected interactions

Bypass-equivalent mode prevents ordinary tool-permission parking. It does not
eliminate user-input or MCP elicitation.

`InteractionRequested` is a required workflow wake. When it belongs to the
controlled current turn, the driver:

1. durably records `workflow_interaction_required`;
2. sends controlled actor cancel;
3. waits for turn shutdown/terminal evidence; and
4. records failed terminal intent and enters the normal recoverable
   `finalizing` path; only `releasing_control` may release claims/commit failed.

The run must never wait forever for an unattended human response.

## 16. Cancellation

Cancellation is durable and idempotent at both layers.

Cloud first stores `cancel_requested_at`:

- queued and never handed off: mark delivery cancelled and suppress it;
- `delivering` managed: enqueue an outbox-backed convergence task using the
  fixed body plus `cancelRequested`;
- accepted managed: enqueue the same idempotent direct cancel task;
- `delivering` Desktop: keep offering the fixed body plus cancellation until
  the worker reports target convergence; and
- accepted Desktop: advertise `cancelRequested` on every heartbeat until a
  terminal AnyHarness observation arrives.

The cancel marker update and required managed outbox item commit in the same
Postgres transaction. An acceptance result arriving after Cloud cancellation
is valid: it transitions to accepted-with-cancellation-pending, never back to
ordinary accepted, and schedules/advertises target cancellation. Late failure
cannot overwrite it.

AnyHarness `POST /v1/workflow-runs/{id}/cancel` and the `PUT` control bit both
perform the same operation: atomically set `cancel_requested_at`, append an
observation, and advance the retained wake epoch. The first false-to-true
mutation uses revision CAS, increments the run revision once, and inserts that
same revision's snapshot in one SQLite transaction; repeats are true no-ops.
They do **not** directly
rewrite status/phase; the workflow actor remains the only state-machine
driver.

After any in-flight effect returns, the actor first persists/reconciles its
stable evidence, then reloads under revision CAS. If no terminal intent has
been selected, a previously linearized cancel marker selects `cancelled` and
enters `finalizing`. Once an intent exists, cancellation never overwrites it.
Finalization is shared by success, failure, and cancel:

1. stop an owned setup command or active/prompt-ID-correlated turn;
2. remove the exact queued workflow prompt, if invariant failure created one;
3. resolve/cancel an outstanding workflow interaction;
4. clear and confirm the exact workflow-created goal lifetime;
5. restore and verify each binding's safe session configuration;
6. verify no workflow-owned mutation, queue item, interaction, goal, or
   background work remains; a preserved pre-acquisition user goal is explicitly
   foreign and allowed only on the no-workflow-authored-effect acquisition
   rollback branch; and
7. while holding workspace/session guards, atomically delete exact claims,
   stamp binding release times, commit the terminal intent, and append the
   final observation.

If cleanup cannot yet be proved, the run stays durably `finalizing` with its
claim. Preparation failures take the same path; no error branch can strand a
claim without a driver-visible recovery phase.

A proven permanent cleanup failure—agent binary removed, model no longer
launchable, or native goal cleanup permanently unavailable—offers an explicit
owner-confirmed **close and abandon**, never force-release-to-interactive.
`POST /v1/workflow-runs/{id}/abandon-controlled-sessions` is accepted only from
typed cleanup-blocked finalization. The HTTP service does not mutate a session,
claim, status, phase, or terminal intent: it CAS-sets `abandon_requested_at`,
increments revision and appends that revision's observation in the same
transaction, then wakes the sole workflow actor. Repeated confirmation is a
no-op.

The actor reconciles any in-flight stable effect, enters
`abandoning_control`, stops/waits for the exact owned setup command, and under
the normal workspace/session guard order force-stops each controlled **session**
actor/process. It marks affected sessions closed while preserving transcript,
removes exact workflow-owned pending state, and atomically deletes claims and
commits terminal `failed`. It preserves the first `terminal_intent`, records
`cleanup_disposition = close_and_abandon`, and retains the permanent cleanup
error as the reason the intended outcome could not be safely returned. A
closed session cannot execute with stale bypass config. This is the bounded
escape from an otherwise permanent retention wedge without introducing a
second state-machine writer.

There is no force-release-to-interactive endpoint. Ordinary session
close/dismiss/delete and workspace purge return
`session_controlled_by_workflow` while a claim exists.

An offline Desktop honestly shows cancellation pending until its worker
reconnects. PR2 does not pretend the local session was released remotely.

## 17. Restart Reconciliation Matrix

At startup the workflow manager loads claims and nonterminal runs before any
claimed session is resumed for workflow work.

| Durable phase | Evidence and recovery |
| --- | --- |
| accepted | Validate the stored logical bundle/control marker; enter workspace preparation or immediate cancellation finalization. |
| materializing_workspace | Freeze symbolic base to an exact commit OID before Git mutation. Reuse a row only with exact creator context. For the missing-row crash window, use the dedicated orphan-adoption proof over deterministic repo/path/branch/OID; never expect creator context on disk. |
| waiting_workspace_setup | The deterministic setup run ID was linked before dispatch. Read that exact terminal-command run; start-by-ID only if absent, continue only on durable success, stop/wait on cancel, and fail on terminal failure. |
| resolving_execution_plan | Re-read workspace-aware launch options. If no plan was frozen, freeze once; otherwise verify the immutable frozen plan. |
| acquiring_sessions | Under the workspace lease and all keyed guards, verify whether the one all-stage transaction committed. Adopt all exact IDs or create all rows/bindings/claims atomically; never a partial subset. |
| starting_session | Claim already exists. Before the first workflow-authored effect, start/publish every reused non-live session under workflow authority; later only newly created stage sessions may start lazily. Never create a second session for a stage. |
| reconciling_session | Await strict native goal reconcile and repeat readiness for every reused binding before the first prompt. A newly discovered user goal fails acquisition, preserves it, and rolls back all claims without clearing it. |
| applying_harness_config | Read live/durable config; apply only missing effective values; read-back-verify. |
| setting_goal | Compare current/native state with the persisted operation ID and prior goal head. Adopt a confirmed new lifetime, wait/reconcile a pending set, or issue once only when evidence proves no prior effect. |
| dispatching_prompt | Query the deterministic prompt ID. Absent means safe dispatch; present means bind its turn and never redispatch. |
| waiting_for_turn | Derive completed/failed/cancelled from the bounded event sequence. An open turn after process loss records `workflow_turn_outcome_unknown`, repairs cancelled under claim, then finalizes. |
| waiting_for_goal | Load exact goal lifetime ID and revision/status; apply the goal predicate. |
| clearing_step_goal | Clear/confirm the exact completed goal lifetime, then advance the cursor. |
| any phase + cancel marker | First reconcile the phase's stable effect evidence. If `terminal_intent` is null, select cancelled under revision CAS; otherwise preserve the first intent. No illegal status/phase pair is created. |
| stopping_owned_work | Correlate setup run, deterministic prompt ID, turn ID, and queue item; cancel/remove exact owned work and await terminal evidence. |
| clearing_owned_goal | Resolve pending native state and clear/confirm only the workflow lifetime. |
| resolving_interaction | Confirm the workflow interaction is resolved/cancelled. |
| restoring_session | Apply/read-back each durable restoration config. Retry safely on restart. |
| abandoning_control | Reconcile the owner-confirmed marker, stop/wait for exact setup and session processes, close controlled sessions, remove exact owned pending state, then atomically record abandoned cleanup, terminal failure, and claim deletion under all guards. |
| releasing_control | Under workspace/session guards verify quiescence, then delete exact claims and commit terminal intent in one transaction. |

Additional startup invariants:

- one manager start wins per run ID;
- a terminal run never restarts;
- a claim whose owning run is terminal is an invariant violation and is cleaned
  only by exact owner/claim match;
- a claim cannot outlive a deleted run/session because both foreign keys
  restrict deletion; and
- worker/server restarts do not affect execution after AnyHarness acceptance;
- session start and generic turn repair remain fenced until claimed-run
  reconciliation completes; and
- workflow orphan adoption/reconciliation precedes workspace retention.

## 18. Run Read Model And Product Surface

`GET /v1/workflow-runs/{id}` returns the immutable definition/arguments plus a
projection such as:

```ts
interface WorkflowRun {
  id: string;
  contractVersion: 1;
  runtimePayloadDigest: string;
  definition: { id: string; revision: number; title: string };
  arguments: Record<string, string | number | boolean>;
  status:
    | "accepted"
    | "preparing"
    | "running"
    | "finalizing"
    | "succeeded"
    | "failed"
    | "cancelled";
  terminalIntent?: "succeeded" | "failed" | "cancelled";
  cleanupDisposition?: "closeAndAbandon";
  phase?: string;
  revision: number;
  workspaceId?: string;
  cursor?: { stageIndex: number; stepIndex: number };
  stages: Array<{
    stageIndex: number;
    status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
    sessionId?: string;
    sessionSource?: "created" | "reused";
    steps: Array<{
      stepIndex: number;
      kind: "agent.prompt";
      status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
    }>;
  }>;
  error?: { code: string; message: string; stageIndex?: number; stepIndex?: number };
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}
```

The minimal PR2 product surface contains:

- Run on a saved workflow;
- typed input form;
- managed Cloud or exact Desktop target;
- new repository workspace, new scratch, or current workspace placement;
- optional compatible current-session binding per stage;
- queued/preparing/current-stage/current-step/finalizing/terminal state;
- links to workspace and sessions;
- Cancel;
- owner-confirmed Close and abandon only for typed permanent cleanup failure;
- controlled-session banner plus disabled mutating controls/composer.

The server still enforces mutation rejection. UI disablement is explanatory,
not authorization.

Closing/reloading the UI cannot stop a managed run. Desktop details may read
local AnyHarness directly; managed details may be proxied by Cloud while the
runtime is reachable. Cloud history uses the latest projection.

## 19. Typed Failure Contract

At minimum:

```text
workflow_invocation_idempotency_conflict
workflow_definition_revision_conflict
workflow_input_missing
workflow_input_type_mismatch
workflow_input_unknown
workflow_input_number_not_finite
workflow_optional_input_reference_missing
workflow_target_unavailable
workflow_repository_environment_unavailable
workflow_repository_environment_ambiguous
workflow_run_delivery_conflict
workflow_workspace_conflict
workflow_workspace_setup_failed
workflow_session_not_found
workflow_session_workspace_mismatch
workflow_session_harness_mismatch
workflow_session_not_idle
workflow_session_active_goal
workflow_session_active_loop
session_controlled_by_workflow
workflow_target_launch_option_unavailable
workflow_harness_config_apply_failed
workflow_session_restore_failed
workflow_session_cleanup_requires_abandon
workflow_interaction_required
workflow_turn_failed
workflow_turn_outcome_unknown
workflow_goal_failed
workflow_goal_not_confirmed
workflow_runtime_epoch_conflict
workflow_runtime_lost
workflow_cancelled
```

Every stored run error includes stage/step location when applicable.

## 20. Implementation Sequence Inside PR2

PR2 remains one end-to-end pull request, but its commits/packets should be
reviewable in this order:

1. Contracts and durable stores
   - cross-language bundle/run/observation fixtures;
   - Cloud invocation/delivery models and migrations;
   - AnyHarness contract and four SQLite row families;
   - pure transition and projection tests.
2. Generic session control
   - keyed mutation guards and durable claims;
   - route every current mutation path through admission;
   - aggregate workspace/tree preflight with stable lock ordering;
   - read-model `controlOwner`;
   - live/non-live/new-session acquisition race tests.
3. Workspace and session preparation
   - workflow creator context;
   - exact base-OID freeze, deterministic worktree adoption, and
     provenance-fenced scratch ensure/adoption;
   - prelinked idempotent setup-run wait and retention blockers;
   - workspace-aware launch-option freeze and bypass-equivalent config;
   - all-stage binding/claim preparation.
4. Sequential engine
   - manager/actor lifecycle;
   - prompt/goal executor;
   - strict atomic turn-begin, prompt-ID lookup, retained wake epoch, and exact
     event/exit hooks;
   - cancellation/finalization and restart matrix tests.
5. Managed-Cloud delivery
   - outbox task names/relay support/Celery handlers and the one-minute stale-
     projection Beat reconciler;
   - direct AnyHarness client methods;
   - bounded observation task and cancellation.
6. Desktop delivery
   - heartbeat request/response additions;
   - worker prepared-delivery SQLite state, pre-PUT Cloud CAS, and local
     AnyHarness client;
   - result reporting, observation upload, and cancellation.
7. Product proof
   - minimal invoke/status/cancel/controlled-session UI;
   - Tier 2 seam tests;
   - new Tier 3 workflow lane;
   - canonical spec promotion and stale worker/cloud-command doc correction.

No packet may introduce a second product-code writer on shared files. Each
packet gets independent acceptance against its exact commit before integration.

## 21. Verification Matrix

### 21.1 Tier 1 — deterministic contracts and real databases

Python/Rust/TypeScript fixtures:

- authored definition + typed arguments + input-resolved bundle;
- canonical number/boolean/string interpolation and digest;
- managed/Desktop runtime payloads;
- AnyHarness run request/response;
- observation and Cloud projection;
- session `controlOwner`.

Real Postgres:

- same idempotency key/same request returns one invocation;
- same key/different request conflicts;
- definition default change/delete after invocation cannot change the frozen
  repository selection;
- ambiguous Desktop repository environments reject deterministically;
- invocation, delivery, and managed outbox task commit atomically;
- concurrent managed delivery tasks produce one accepted AnyHarness run;
- crash after AnyHarness `PUT` before Postgres acceptance safely retries;
- Desktop worker identity receives only its owner/install deliveries;
- offline Desktop delivery is re-offered after reconnect;
- concurrent Desktop prepare candidates produce one immutable winning body;
- worker-state loss after local `PUT` adopts the local run using Cloud custody;
- ambiguous Desktop `PUT` outcomes remain delivering, adopt by same-epoch
  `GET`/exact replay, and never report deterministic failure;
- post-handoff epoch change or authoritative absence of a Cloud-accepted run
  records runtime loss and never re-PUTs the run;
- late failure cannot overwrite accepted/cancellation-pending delivery;
- out-of-order/duplicate observations never regress Cloud revision;
- managed and Desktop cancel at every before/after handoff/PUT/report crash
  boundary either suppresses an unoffered run or converges target cancellation;
- observation successor enqueue is atomic and stale-chain sweep repairs loss;
- stale-projection sweep excludes runtime-lost deliveries;
- accepted cancel remains pending until a terminal runtime observation.

Real SQLite and live-runtime tests:

- same `PUT` creates one run; changed body conflicts;
- runtime reset between epoch read and `PUT` returns a no-effect epoch conflict
  before run insertion and converges to runtime loss;
- exact `PUT` replay with `cancelRequested` atomically sets the monotonic marker
  and a newly accepted cancelled run performs no workspace/session effect;
- initial run and observation are atomic;
- AnyHarness data epoch survives restart/upgrade and changes with a fresh data
  set;
- every transition increments revision and observation atomically;
- concurrent actor starts produce one driver;
- all session claims commit atomically or none do;
- prompt-first versus claim-first passes in both orderings;
- workspace purge/retire versus claim acquisition has no partial mutation;
- recursive close preflights all affected claims before closing any session;
- a non-live session is claimed before actor publication;
- a newly created session is never visible without its claim;
- every mutation family rejects interactive authority while claimed;
- a loop fire denied by a claim stays armed, sends no prompt, and resumes only
  after release;
- reads/transcript/SSE remain available while claimed;
- close/dismiss/delete/purge cannot remove a claimed session;
- retention and manual retire cannot remove a nonterminal workflow workspace;
- deterministic worktree retry creates one workspace;
- crash after Git worktree creation but before workspace-row insert repairs;
- symbolic base movement after OID freeze cannot change create/adoption;
- orphan adoption runs before retention and rejects every foreign collision;
- scratch crash after outer-directory creation, owner-record creation, Git
  initialization, workspace-row insertion, or run linkage adopts exactly one
  workspace and never deletes foreign content;
- scratch owner/data-epoch/symlink/Git-root/unowned-content mismatches conflict,
  while an exact linked scratch preserves later workflow files on restart;
- crash between setup-link persistence, terminal-run insertion, process start,
  and acknowledgement still follows one deterministic setup command;
- post-create retention cannot run before workspace-to-run linkage;
- effective model/effort/mode is applied and verified;
- workflow runs use bypass-equivalent mode;
- goal is set before prompt and fenced by lifetime ID;
- goal pending/timeout never dispatches a prompt without a confirmed lifetime;
- non-live attach synchronously reconciles and preserves a discovered user goal;
- every reused binding, including later-stage non-live sessions, strictly
  reconciles before the first workflow-authored effect; any discovered foreign
  goal rolls back all claims before an earlier stage can run;
- same-text consecutive goals cannot cross-complete;
- strict acquisition goal read fails closed and preserves a discovered user
  goal without treating it as workflow-owned cleanup;
- prompt-only and prompt+goal signals may arrive in either order;
- interaction-requested wakes, cancels, and fails rather than hanging;
- failed/empty/cancelled turns derive correctly from durable events;
- turn errors after `turn_ended` do not retroactively fail that turn;
- strict turn-begin batch failure sends no ACP request and leaves no partial
  prompt fence;
- crash before local turn start safely dispatches once;
- crash after local turn start never redispatches;
- cancel after strict turn begin but before `current_turn_id` persistence finds
  the turn by deterministic prompt ID;
- a wake/cancel committed exactly between actor read and wait-arm is observed
  without restart;
- cancel during every phase enters a legal finalization path and releases only
  after owned setup/turn/queue/interaction/goal work stops;
- cancel racing success/failure intent selection is revision-linearized, the
  first terminal intent wins, and cancel in every finalization phase cannot
  rewrite it;
- reused and created sessions restore safe config before release;
- permanent cleanup failure exposes only owner-confirmed close-and-abandon,
  preserves transcript, closes the session, and never exposes stale config;
- close-and-abandon request/actor-stop/pending-state/session-close/claim-delete/
  terminal-commit crash points reconcile under the sole workflow actor, stop
  the exact owned setup command, and preserve the original terminal intent;
- a second lazy stage starts/reconciles/configures under `running` without
  status regression and survives restart in each stage-preparation phase; and
- success/failure/cancel atomically release exact claims with terminal state.

### 21.2 Tier 2 — real product seams

With real server, Postgres, Desktop shell, worker binary, and a pure HTTP
AnyHarness contract double:

```text
create/reopen definition
  -> enter typed arguments
  -> invoke managed target
  -> assert invocation + outbox + direct delivery request
  -> invoke Desktop target
  -> assert heartbeat delivery + local PUT + result
  -> render queued/accepted projection
  -> cancel queued and accepted runs
```

Tier 2 stops at the delivery/outbox/HTTP boundary. It uses no mock LLM, does
not claim run completion/current-step execution, and does not replace
Postgres or the worker protocol with in-memory stores. Real AnyHarness and
model execution belong only to Tier 3.

### 21.3 Tier 3 — new real workflow lane

There is no current live workflow lane. PR2 creates and registers one:

1. Cloud invocation targeting Desktop -> real heartbeat -> real worker -> local
   AnyHarness scratch, two prompts in one stage, expected file effect, success;
2. repository worktree, restart between steps, no duplicate worktree/prompt;
3. existing idle session takeover, interactive prompt rejected, transcript
   readable, prior config restored, session reusable after success;
4. prompt-plus-goal on a cheap goal-capable harness, advance only after `met`;
5. cancel during a real turn on both Desktop and managed Cloud, including
   managed sandbox resume-to-cancel, then prove goal/interaction/config
   cleanup, terminal cancellation, and claim release; and
6. managed Cloud with Desktop fully off, direct sandbox delivery, terminal
   observation projected to Cloud.

Assertions use durable state and file effects, never exact transcript wording.

## 22. Documentation Promotion At Implementation Time

Once implementation matches this plan, PR2 should promote the contract into:

- `specs/codebase/primitives/workflow-execution.md`
  - end-to-end invocation, target delivery, observation, and cancellation;
- `specs/codebase/structures/anyharness/specs/workflow-run-engine.md`
  - SQLite, workflow actor, session claims, prompt/goal, and restart behavior;
- `specs/codebase/features/workflows.md`
  - PR2 user surface and acceptance;
- the relevant server, worker, Desktop-native, chat-composer, and testing
  indexes/guides.

The same PR must correct or demote stale worker/cloud-command documents that
claim unshipped `control/**`, command queue, or `tail/**` code is current. The
worker lifecycle/control docs must explicitly record PR2's bounded heartbeat
rendezvous exception. The implementation must not be reviewed against
fictional baseline files.

## 23. Explicit Rejections

PR2 rejects:

- workflow state inside `SessionActor`;
- literal transfer/removal of `LiveSessionHandle` ownership;
- actor-only authorization for runtime/store mutations;
- a React or Tauri workflow poller/executor;
- a sandbox-worker delivery hop when Cloud can address AnyHarness directly;
- a new general worker command bus disguised as workflow delivery;
- a Cloud mutable per-step ledger;
- a mutable SQLite row for every authored step;
- target-authored arbitrary filesystem paths;
- time-expiring or manually force-released session claims;
- claim release before owned goal/queue/interaction/config cleanup;
- best-effort multi-row prompt-begin persistence as a replay fence;
- cancellation that overwrites actor status/phase from the HTTP handler;
- prompt replay after a durable local turn began;
- unattended user/MCP interactions that can hang forever;
- importing the old recovery/security/automation program; and
- pre-building future step kinds, grants, schedules, or parallelism.

These constraints are what keep PR2 both end-to-end and reviewable.
