# Workflows v1 architecture alignment and completion plan

Status: non-authoritative migration and delivery plan.

Baseline reviewed: `workflows/gate-c-main-rebase` at
`8be1c7706fa12626a1a7bbc325b9d2c891760417` on 2026-07-10.

Canonical behavior: [`../codebase/features/workflows.md`](../codebase/features/workflows.md).

This document tells implementation agents how to move the current branch to the
canonical contract. It does not override that contract or the area structure
specs. When this plan and the workflow feature spec disagree, the feature spec
wins.

## 1. Outcome

Complete the workflows stack as one coherent product path:

```text
author in UI
  -> StartRun creates durable intent
  -> local or cloud executor receives the same resolved plan
  -> AnyHarness executes sequential and parallel stages
  -> exact temporary capabilities are enforced
  -> emitted state drives deterministic control flow
  -> observed state reconciles without loss or regression
  -> session takeover is acknowledged and safe
  -> schedule and poll use Celery/Beat/outbox
  -> strict pre-merge qualification proves the integration candidate
  -> final integration PR squash-merges to main
  -> merged main SHA is rebuilt, deployed, rerun, and baked on staging
  -> production remains a separate explicit post-bake approval
```

Completion does not mean that every current file has more tests around its
existing behavior. Several current behaviors and tests encode the wrong
contract and must be replaced.

## 2. Baseline assessment

### 2.1 Preserve

| Area | Useful foundation to preserve |
| --- | --- |
| Workflow storage | User-owned workflows, immutable versions, StartRun as the single compilation entrypoint, strict server definition validation. |
| Runtime engine | WorkflowRunActor placement, durable SQLite cursor, slot-affine sessions, pure failure decisions, emit schema validation/retry, lane cursors, sibling-output isolation. |
| Function invocation | Person ownership, stable tool name, encrypted write-only headers, JSON-schema argument validation, pinned-IP dispatch, Host/SNI correctness, response limits. |
| Local scheduled execution | Desktop executor identity, claim IDs, heartbeat fencing, deterministic worktree creation, bounded delivery retry, relay reattachment. |
| Trigger primitives | Schedule-slot uniqueness, poll item identity, `/init` derivation, missed-run policy vocabulary. |
| UI | Workflow library, vertical spine editor, sequential/parallel visual model, trigger surfaces, run timeline foundations. |
| Test assets | Workflow release fixtures, capture feed/service helpers, existing unit matrices that assert the canonical behavior rather than a known exception. |

### 2.2 Replace or repair

| Current implementation | Required replacement |
| --- | --- |
| Public runtime view exposes numeric step indexes and loses the slot-session map. | Stable `stepKey`, slot-keyed sessions, plan hash, and observed revision across Rust, Python, and TypeScript. |
| Plaintext run gateway bearer is persisted inside `resolved_plan` and returned by run APIs. | Secret-free plan plus private execution envelope with separate credential audiences. |
| StartRun is expected to pin source even when the source is an offline/unpushed local checkout or dirty bound workspace it cannot inspect. | Logical plan plus trusted two-phase executor `ExecutionBinding`; exact local commit or immutable initial checkpoint acknowledged before step 1. |
| `integrations: [provider]` means all current provider tools and all user functions; per-slot grants are flattened to a union. | Exact tool/invocation revision references, frozen at StartRun and enforced per slot/session. |
| Required invocation matches native tool-name strings. | Authoritative successful gateway receipt bound to run, slot, step, turn/activation, and attempt. |
| Workflow schedule/poll are bespoke asyncio loops. | Celery Beat discovery, transactional outbox, idempotent worker-facing tasks, and external local claim APIs. |
| Cloud delivery occurs before the request transaction commits. | Commit run intent and outbox before any sandbox/runtime network call. |
| Poll holds a trigger transaction across HTTP and advances past StartRun failures. | Network outside transactions; durable item inbox/run intent; cursor CAS after durable handling. |
| Parallel lanes fork and merge committed branch tips only. | System checkpoints that include ordinary dirty edits at group entry and lane completion. |
| `branch end` changes meaning inside a lane. | One global meaning and deterministic parallel quiescence. |
| In-memory check-then-mark session ownership and optimistic terminal cancellation. | Durable atomic session lease and cancel-request/quiescence acknowledgment. |
| Manual local runs execute in the selected shared workspace; local parallel is rejected. | Fresh worktree by default and the same AnyHarness language locally and in cloud. |
| Slot reuse is run-wide even though parallel lane sessions are bound to different worktrees. | Sequential run-level session affinity; fresh group-scoped parallel slots that cannot be reused outside the group. |
| Workflow-created sessions disable Product MCP subagents/peer behavior. | Run-scoped Product MCP peer roster and durable messaging. |
| Editor preserves API-seeded emit schemas/required invocations but cannot create them. | Full authoring plus stable draft identities and lossless schema-version handling. |
| T3 reports blocked/expected-fail as success and CI ignores failures. | Strict required-scenario manifest and exact-SHA promotion evidence. |

### 2.3 Delete after replacement

- workflow-specific `while` scheduler and poller process entrypoints
- the release-only workflow scheduler workaround
- numeric step-output reconstruction in Desktop and server refresh
- native-tool-name required-invocation heuristics
- run-wide union scope comments, tests, and UI copy
- tests that expect a secret-bearing resolved plan
- tests that expect cursor advancement after transient materialization failure
- tests that treat the server cancellation write as immediate session release
- expected-fail/blocked workflow scenarios once the real path exists
- stale workflow architecture redirects that describe superseded behavior as current

Deletion happens in the same workstream that lands the replacement. Do not
leave old and new execution paths behind feature flags unless the canonical
spec explicitly requires a staged compatibility window.

### 2.4 Current implementation map and critique

This map is pinned to the reviewed baseline SHA. `Conforming` means the
ownership/behavior can be retained; `partial` means the seam is useful but its
contract must change; `wrong` means tests around the current behavior are not a
substitute for replacement; `missing` means no production path exists.

| Subsystem and current owner | Status | Evidence and architectural finding |
| --- | --- | --- |
| Definition parsing, interpolation, includes | Partial | `server/proliferate/server/cloud/workflows/domain/{definition,interpolation,composition}.py` has strict parsing, prior-emit validation, and StartRun-time include expansion. Keep the pure domain shape, but freeze JSON Schema vocabulary, exact capability refs, include non-widening, stable keys, and parallel slot lineage. |
| StartRun/compiler/API orchestration | Partial | `server/proliferate/server/cloud/workflows/service.py` is the single compilation entry but also owns too many unrelated concerns. It currently conflates logical plan, target/source assumptions, private credentials, bindings, and delivery. WS0B-S/WS2 must separate compiler, ledger, envelope/binding, and worker owners. |
| Postgres run/trigger state | Partial | `server/proliferate/db/models/cloud/workflows.py` and `db/store/{cloud_workflows,cloud_workflow_triggers}.py` provide useful uniqueness and history rows, but the state is too compressed for desired/delivery/observed truth, full observation CAS, durable leases, receipts, inbox, and control commands. |
| Cloud/local delivery | Partial | `delivery.py` and `local_executor.py` have useful claim IDs, heartbeat fencing, and relay seams. Delivery can occur on the wrong side of commit and lacks the immutable binding/ack identity; local materialization defaults and parity are not canonical. |
| Schedule and poll | Wrong | `scheduler.py` and `poller.py` are bespoke loop/tick owners. Current polling can hold trigger state around network I/O and seal cursor/item state before every downstream outcome is durable. Replace with Beat, thin tasks, outbox, multi-phase I/O, inbox/dead-letter, and cursor CAS. |
| Gateway scope and function invocation | Partial/wrong | `gateway_grants.py` plus integration gateway code preserve SSRF-safe dispatch and write-only headers, but workflow grants are provider/namespace-wide, per-slot intent is flattened, function semantics are not frozen deeply enough, and a run credential is over-broad. |
| Required invocation | Wrong | Runtime/server behavior recognizes native/transcript tool names rather than a trusted, activation-keyed successful gateway receipt. This is forgeable and cannot recover an upstream-success/lost-response boundary. |
| Runtime contract and interpreter | Partial | `anyharness-lib/src/domains/workflows/{plan,engine,service,store}.rs` correctly places interpretation and durable cursor/attempt state in AnyHarness. Public identity and acceptance still need plan/binding/generation fencing, whole snapshots, explicit effect recovery, and exact session maps. |
| Live execution | Partial/wrong | `anyharness-lib/src/live/workflows/executor.rs` contains real prompt/emit/branch/shell/action behavior but is a 2,982-line mixed owner. Native-name gating and effect ambiguity must be replaced after WS0B-R extraction. |
| Agent/control-plane integrity | Missing | Bypass-mode agent shells are not yet proven unable to read/mutate AnyHarness home, SQLite, private sockets, callbacks, leases, or observations on local and cloud targets. Credentials alone do not protect deterministic truth when processes share an unrestricted OS identity. |
| Parallel runtime | Partial | Lane cursors, sibling-output isolation, authored-order join, and typed conflict foundations exist. Worktrees currently rely too heavily on branch tips/commits, do not fully checkpoint ordinary dirty state, and conflict with run-wide slot/session affinity. |
| Session ownership/cancel | Wrong | Current server hold and in-memory runtime checks are check-then-mark; cancellation can project terminal/release before runtime quiescence. There is no all-or-nothing Postgres reservation plus acknowledged SQLite enforcement generation. |
| Product MCP workflow peers | Missing | Existing Product MCP/session-link/message primitives are reusable, but workflow sessions do not receive the frozen roster, distinct `workflow_peer` policy, or run/session token and next-turn-only delivery semantics. |
| Desktop product domain/editor | Partial | `apps/packages/product-domain/src/workflows/**` and `apps/desktop/src/components/workflows/**` have useful spine editing, interpolation, triggers, and run presentation. The editor preserves some API-seeded fields but cannot author the complete target, and oversized screens mix access/query behavior with rendering. |
| Tier 2/Tier 3/release | Wrong/incomplete | Current intent tests cover useful CRUD seams, while `tests/release/src/scenarios/workflows/**` permits blocked/expected-fail agent halves and only registers WF1-WF7 with WF8 cut. There is no exact-post-squash-SHA signed promotion proof. |

Architecture verdict: the strongest choice already present is the interpreter
boundary—Postgres requests and observes, AnyHarness executes. The principal
design flaw is contract collapse around that boundary: logical program,
executor-local source truth, credentials, observations, session ownership, and
external-effect proof are not separately fenced. The completion work should
strengthen that boundary, not move cursor interpretation into the server or add
another workflow-specific scheduler/message bus.

## 3. Definition of done

The completion program is done only when all of the following are true:

1. The current implementation traceability review reports no unresolved P0/P1
   deviation from the workflow feature spec.
2. The resolved plan is secret-free and content-hashed, its acknowledged source
   binding is immutable and independently hashed, and both parse strictly in all
   languages.
3. Local and cloud run the same sequential/parallel semantics.
4. Function and integration grants are exact, per slot, frozen against
   widening, and narrowed by live revocation.
5. Agent processes on local and cloud targets cannot read or mutate runtime
   home/state/control surfaces or inspect the control-plane process; workflow
   bypass fails closed without this isolation.
6. Required invocation is receipt-based.
7. Schedule and poll use the production Celery/Beat/outbox substrate.
8. A transient poll/run-materialization failure cannot lose an item or advance
   its cursor.
9. Session takeover cannot release a session before runtime quiescence.
10. Parallel execution preserves dirty pre-group and lane edits.
11. The UI can author every workflow used by the release battery from a blank
    workflow without hand-editing JSON.
12. Workflow agents can list and message permitted peers through Product MCP.
13. Tier 1 and Tier 2 are blocking and green.
14. Every required Tier 3 workflow scenario genuinely passes against artifacts
    built from the exact merged `main` SHA in local and staging lanes, with zero
    missing, duplicate, blocked, skipped, expected-fail, cancelled, or failed rows.
15. Repository size/boundary/diff checks pass without expanding allowlists.
16. Production promotion still waits for explicit approval after merged-SHA CI,
    staging deployment, strict workflow Tier 3, and the measurable bake.

P0 means a safety, authority, data-loss, duplicate-effect, source-integrity, or
release-gate flaw that can invalidate a run or production proof. P1 means a
determinism, crash-recovery, ownership, compatibility, or required product-path
gap with no safe launch workaround. P2/P3 findings may remain only with an
owner, issue, and explicit non-launch impact.

## 4. Coordination and branch model

### 4.1 Integration branch

Use the current workflow stack as the integration baseline, not as a set of
independent PRs to merge directly to `main`.

```text
workflows/gate-c-main-rebase
  -> workflows/v1-completion                 integration branch
       -> workflows/completion-contracts
       -> workflows/completion-ledger
       -> workflows/completion-gateway
       -> workflows/completion-background
       -> workflows/completion-runtime
       -> workflows/completion-parallel
       -> workflows/completion-sessions
       -> workflows/completion-agent-comms
       -> workflows/completion-desktop
       -> workflows/completion-release
```

One merge captain owns `workflows/v1-completion`. Agents work in separate
worktrees and never merge, deploy, or push production tags themselves.

After the program is green, rebase the integration branch onto the then-current
`main`, rerun pre-merge qualification, and open one final integration PR.
Squash-merge only after independent review. Because squash creates a new commit,
the integration-SHA evidence is never production evidence: CI, artifact build,
staging deploy, strict Tier 3, and bake rerun against the merged `main` SHA.

### 4.2 Shared-file ownership

The merge captain assigns a writer lock for changes to:

- shared workflow ORM models and Alembic revision order
- contract version constants and shared golden fixtures
- generated OpenAPI/SDK output
- workflow feature and completion specs
- Tier 3 scenario registry and CI/promotion manifests
- release feature-flag/environment catalog

One named workstream may hold each writer lock at a time. Agents may propose
edits, but do not write a locked file until assigned. Two concurrent agents do
not independently edit ORM roots, create Alembic heads, regenerate the same SDK,
or mutate the release manifest.

Initial writer-lock map:

| Locked path or output | Designated writer | Unlock/merge order |
| --- | --- | --- |
| `specs/codebase/features/workflows.md`, this plan | WS0/merge captain | Freeze before WS1; later changes require architecture review. |
| `tests/contracts/workflows/**` except `traceability.yaml`, workflow contract versions | WS1 | Before any behavioral packet. |
| `tests/contracts/workflows/traceability.yaml` | Merge captain (WS1 creates schema) | Append-only planned -> executable/green transitions from one packet at a time. |
| `anyharness/crates/anyharness-contract/src/v1/workflows.rs`, workflow API mappings | WS1 | Generate/merge with fixtures. |
| Server request/response contract models and generated OpenAPI/SDK output | WS1, under merge-captain lock | One regeneration after each accepted contract change. |
| `server/proliferate/db/models/cloud/workflows.py`, workflow stores, Alembic workflow chain | WS2a | Complete persistence skeleton first; later migrations are sequentially allocated by captain. |
| StartRun/compiler, run ledger, delivery/reconciliation modules under `server/proliferate/server/cloud/workflows/**` | WS2b then WS2c | WS0B-S lands ownership-only extraction first. |
| Integration/function grant, auth, dispatch, and receipt modules | WS3a then WS3b then WS3c | WS2a schema first. Product MCP auth is excluded. |
| Beat registry, workflow tasks, trigger/poll/action worker modules | WS4a then WS4b then WS4c | WS2a schema first; legacy automation loop remains locked to compatibility owner. |
| `anyharness/crates/anyharness-lib/src/domains/workflows/**`, `src/live/workflows/**` | WS5a, WS5b, WS5c, WS6, WS7 in that merge order | WS0B-R extracts modules first; captain assigns any shared `mod.rs`/store edit. |
| Product MCP workflow-peer definition, session-link policy, message tests | WS8 | After WS7; never edit integration-gateway auth. |
| `apps/packages/product-domain/src/workflows/**` | WS9a | WS1 wire adapters land first. |
| Desktop workflow editor/screens/hooks and local executor/relay | WS9b then WS9c | WS0B-U extraction first. |
| `tests/intent/specs/workflows*.spec.ts`, workflow T2 registry | WS10b | Behavior packets provide accepted APIs/helpers; WS10b alone writes the cross-boundary intent suite. |
| `tests/release/**`, T3 registry, workflow CI/promotion files | WS10a then WS10b then WS10c | Runner policy first, scenario manifest second, promotion evidence last. |
| `.github/workflows/**`, version/release manifests, staging/prod flag catalog | WS10c/merge captain | Single active writer; no implementation packet deploys. |

Test files follow the behavior owner unless listed above. The contract-fixture
version owner is WS1, the migration-head owner is WS2a, generated-output owner
is WS1 or the merge captain it explicitly delegates to, and the final required
scenario manifest owner is WS10b.

Baseline structural debt is assigned, not waived:

| Current failure | Owning packet |
| --- | --- |
| `server/.../workflows/service.py` max-lines | WS0B-S, completed by WS2b/WS2c |
| `server/tests/unit/test_workflow_service.py` max-lines | WS2b |
| `server/tests/unit/test_workflow_actions.py` max-lines | WS4c |
| `server/tests/unit/test_workflow_triggers.py` max-lines | WS4a/WS4b |
| `anyharness-lib/src/live/workflows/executor.rs` max-lines | WS0B-R, completed by WS5/WS6 |
| `WorkflowTriggersCard.tsx`, `WorkflowEditorScreen.tsx`, and `WorkflowsHomeScreen.tsx` max-lines | WS0B-U/WS9b |
| `WorkflowsHomeScreen.tsx` raw-access boundary violation | WS0B-U/WS9c |

Acceptance removes stale allowlist entries where decomposition makes them
unnecessary; no packet increases a line-count or boundary allowance.

### 4.3 Per-track rules

Every implementation track:

- begins from the exact integration base SHA and accepted dependency SHAs named
  in its handoff; “latest” is not a reproducible assignment
- reads the canonical workflow spec and the relevant area structure docs first
- owns a bounded path set and does not opportunistically fix other tracks
- adds its deterministic tests with the behavior, not in a later cleanup PR
- changes tests that encode the old behavior rather than preserving them
- reports exact commands, outputs, known unexecuted checks, and commit SHA
- after any rebase, reruns every required check and reports the tested
  post-rebase SHA
- runs `git diff --check` before handoff
- does not increase max-line or architecture-boundary allowlists
- keeps secrets and live credentials out of logs, fixtures, plans, and commits

## 5. Dependency graph and waves

```text
WS0 architecture decisions
  +--> WS0B-S/R/U ownership-only decomposition
  +--> WS1 contracts
          |
          v
        WS2a shared persistence skeleton
          |
          v
        WS3a exact resolver -> WS2b compiler/ledger -> WS3b credentials
                                                    |
                                                    v
                                             WS2c delivery/reconcile
                                                    |
                                                    v
                                             WS3c receipts

WS2b -> WS4a schedule/outbox -> WS4b poll
WS2c + WS3b + WS4a + WS4b -> WS4c actions/local/final tasks

WS1 + WS0B-R --> WS5a --> WS5b
                         WS3c + WS5b --> WS5c
                         WS5c --> WS6

WS2c + WS3c + WS4c + WS5c + WS6 --> WS7a/7b/7c
WS2b + WS3c + WS5c + WS7c --> WS8
WS1 + WS0B-U --> WS9a --> WS9b
WS4c + WS5c + WS6 + WS7c + WS8 + WS9b --> WS9c
WS1 --> WS10a
accepted WS2-WS9 interfaces + WS10a --> WS10b --> WS10c --> WS11
```

Recommended execution waves with one coordinator plus at most three concurrent
implementation agents:

| Wave | Parallel work | Merge order |
| --- | --- | --- |
| 0 | Ratify WS0 decisions. Then run ownership-only WS0B-S, WS0B-R, and WS0B-U in parallel while WS1 builds fixtures. | WS0, WS0B, WS1 |
| 1 | WS2a lands the persistence skeleton. WS5a may start in parallel after WS0B-R + WS1. | WS2a, WS5a |
| 2 | Server chain is ordered WS3a -> WS2b -> WS3b -> WS2c -> WS3c. WS5b may run independently. WS4a begins after WS2b, followed by WS4b. | Exact dependency order, never finish time. |
| 3 | WS4c waits for WS2c/WS3b/WS4a/WS4b. WS5c waits for WS3c/WS5b, then WS6. WS7 waits for WS6 plus server/gateway/background completion; WS8 follows WS7c. | WS4c, WS5c, WS6, WS7, WS8 |
| 4 | WS9a/9b fixture-driven work may start earlier, but WS9c final integration waits for WS4c/5c/6/7c/8. WS10a runner work may start after WS1. | WS9, WS10a |
| 5 | WS10b/10c strict live battery and release gates. Owning tracks fix failures. | WS10 |
| 6 | WS11 independent read-only adversarial review, then narrowly owned fixes and reruns. | WS11 sign-off |

## 6. Workstream packets

### WS0 — Architecture, decisions, and traceability

Owner: architecture/spec agent.

Status: the first canonical draft and this plan are present; they still require
formal Gate A0 sign-off before behavioral work begins. Independent spec, plan,
and cross-doc audits were applied on 2026-07-10.

Owns:

- `specs/codebase/features/workflows.md`
- `specs/codebase/features/README.md`
- this plan
- historical notices in `codex/workflows-*.md`
- decision/traceability review only

Deliverables:

- ratify the four run contracts
- ratify capability/version/revocation behavior
- ratify parallel `end`, failure, checkpoint, and merge behavior
- ratify the replayable GET `/init` + GET `/poll` cursor contract
- ratify session lease and cancellation state machines
- freeze RFC 8785/SHA-256 plan and binding hashing, full-snapshot observation
  CAS, and credential generation/refresh rules
- freeze exact capability refs, trusted receipt activation/query protocol,
  deterministic action handshake, and effect-recovery matrix
- freeze Slack action metadata/readback reconciliation, required history scopes,
  bounded window, and `outcome_uncertain` fallback
- freeze slot/session lineage, dirty checkpoint coverage, Product MCP peer
  semantics, schedule DST/missed-run rules, and poll fixtures
- classify every current subsystem as conforming, partial, wrong, missing, or
  test-only
- provide the golden examples WS1 turns into executable fixtures

Acceptance:

- no downstream agent must invent a semantic decision
- all older conflicting workflow docs are marked historical
- each field/state has one owner and one source of truth
- server and runtime reviewers approve the boundaries

### WS0B — Ownership-only decomposition scaffolding

Owners: three short extraction agents; no behavior changes.

Depends on: WS0. May run beside WS1, but every behavioral packet branches only
after its relevant extraction is accepted.

Packets:

- **WS0B-S:** split the large server workflow service into API-facing service,
  compiler/run-ledger, delivery/reconciliation, and worker-facing modules
- **WS0B-R:** split runtime execution into agent-turn, emit/template,
  effect/action, observation/report, receipt, and parallel modules
- **WS0B-U:** split workflow home/editor/trigger orchestration into bounded
  Desktop components, hooks, and UI-local orchestration only; it does not edit
  `apps/packages/product-domain/src/workflows/**`

Acceptance:

- ownership-only moves preserve byte-equivalent public behavior and existing tests
- imports obey the relevant area structure spec; no convenience barrels appear
- max-line and boundary debt decreases or remains unchanged
- each later packet has a non-overlapping primary path set

### WS1 — Cross-language contract spine

Owner: contracts/SDK agent.

Depends on: WS0.

Owns:

- `tests/contracts/workflows/**` or the merge-captain-approved fixture path
- `anyharness/crates/anyharness-contract/src/v1/workflows.rs`
- AnyHarness workflow HTTP contract mapping
- server workflow request/response models and adapters
- Cloud SDK and AnyHarness SDK workflow contract generation
- product-domain wire adapters, not editor behavior

Required fixtures:

- `resolved-plan-v2.json`
- `materialization-offer-v1.json` using a dummy claim fence
- `execution-envelope-v1.json` using dummy credentials only
- `execution-binding-v1.json`
- `checkpoint-manifest-v1.json` plus invalid/restoration cases
- `observed-run-v2.json`
- `gateway-call-receipt-v1.json`
- `workflow-control-command-v1.json`
- `workflow-schema-profile-v1-valid.json` and invalid-case manifest

Required changes:

- stable hierarchical step keys
- immutable UUID slot/node/group/lane/include/step IDs (UUIDv7 for new objects,
  deterministic UUIDv5 for legacy upgrade), exact resolved key grammar, and
  slot-ID-keyed sessions
- plan version and plan hash
- source intent, binding hash, execution generation, exact source/checkpoint
  attestation, and requested/effective execution configuration
- exact capability references
- observed revision, attempt IDs, lane state, and quiescence
- strict version/unknown-kind failure
- public redaction of all envelope secrets
- deterministic server-action request/result and trusted receipt activation/query
  shapes
- materialization-offer versus final-envelope phases and credential rotation/
  old-generation revocation
- legacy definition upgrade fixture proving deterministic one-time IDs without
  rewriting the audited old version
- credential-canary fixture proving secrets never enter workflow SQLite/events/
  transcripts/logs/checkpoints

Acceptance:

- Rust, Python, and TypeScript parse the same fixtures
- producer serialization matches the fixtures
- `stepKey` survives runtime to server action lookup unchanged
- sessions remain a slot map at every boundary
- unknown versions cannot be opened as a lossy editable definition
- SDK generation, builds, and contract tests pass

### WS2 — Server schema, run ledger, and delivery state

Owners: three sequential server workflow-control packets; do not assign the
whole section to one agent.

Dependencies:

- **WS2a persistence skeleton:** WS1
- **WS2b compiler and ledger:** WS2a + WS0B-S + WS3a resolver interface
- **WS2c delivery and reconciliation:** WS2b + WS3b credential issuance

Packet outcomes:

- **WS2a:** one migration chain and ORM/store skeleton for desired/delivery/
  observed/execution-health state, plan/envelope/binding references,
  outbox/control commands,
  capability leases and receipts, poll inbox/dead letters, session leases, and
  action/effect identities; no behavioral cutover
- **WS2b:** StartRun compiler, canonical plan/binding hash validation, immutable
  run ledger, binding-ack preflight, and public redaction
- **WS2c:** commit-before-delivery, idempotent local/cloud delivery, exact
  full-snapshot observation CAS, and restart reconciliation

Owns:

- workflow run models/store/service/delivery
- run-state domain logic
- the merge-captain-sequenced Alembic workflow chain (WS2a only)
- server unit/integration tests for StartRun, delivery, and reconciliation

WS0B-S must extract ownership-correct modules before semantic work.
Worker-facing orchestration belongs under a workflow `worker/service.py`, not
in API handlers or a giant shared service.

Required changes:

- split desired, delivery, observed, and control-plane execution-health state;
  `orphaned` never overwrites the last runtime observation
- compile a secret-free immutable logical plan and accept an independently
  hashed executor source binding before execution
- separate the materialization-only offer from the post-binding private runtime
  envelope; mint binding-bound credentials only after binding acceptance
- commit run intent and outbox before delivery
- reject conflicting same-ID redelivery
- accept whole observations only for the matching plan/binding/generation and
  exact next revision; identical retries are no-ops and conflicting duplicates
  are audited failures
- ACK/replay the runtime's ordered observation outbox without skipping revisions
- persist requested/effective model without silent fallback
- redact ordinary run APIs

Acceptance:

- a failed commit cannot leave an orphan runtime
- stale refresh cannot regress any observed field
- terminal state cannot be rewritten by a late report
- same-terminal duplicate reports cannot mutate outputs/costs
- public API snapshots contain no credential
- CAS/uniqueness guarantees are tested against real Postgres
- source-binding rejection mints no final credential and leaves no accepted runtime
- cancellation before any claim atomically invalidates the offer and reaches
  `cancelled_before_acceptance` without a fabricated runtime observation

### WS3 — Capability leases, token audiences, and gateway receipts

Owners: three sequential integration-gateway/security packets.

Dependencies:

- **WS3a exact grants:** WS2a + WS1 contract fixtures
- **WS3b audiences:** WS2b
- **WS3c receipts:** WS2c + WS3b

Packets:

- **WS3a exact grants:** tagged provider/tool/schema and function semantic
  revisions, StartRun resolution, live narrowing
- **WS3b audiences:** per-slot one-use issuance handles, post-session-lease
  exchange for session-bound credentials, trusted context injection,
  rotation/expiry, and endpoint audience denial
- **WS3c receipts:** runtime-created activation registration, durable gateway
  outcome, authenticated runtime query/push interface, and lost-response recovery

Owns:

- workflow capability resolution and lease storage
- integration gateway auth/scope/dispatch/audit
- function-invocation semantic revision behavior
- token audience separation
- gateway receipt API/store and tests

Product MCP token minting/verification is owned by WS8, not WS3. WS3 owns only
integration/function gateway audiences.

Required changes:

- replace namespace-only grants with exact provider/tool and invocation revision refs
- issue per-slot/session integration credentials
- persist issuance before response; identical unacknowledged exchange retry
  returns the same generation, while wrong-context/post-ACK reuse fails
- separate integration credentials from run-report, ping, and delivery/claim
  audiences; coordinate the distinct WS8-owned Product MCP audience
- freeze maximum authority at StartRun; new capabilities cannot widen it
- revalidate membership and live revocation at use time
- audit allow, deny, upstream failure, and success without arguments or secrets
- bind trusted activation context without accepting run/slot/step identity from
  agent arguments
- persist and expose authoritative allow/deny/upstream/output-validation results
  for authenticated runtime verification
- validate every required invocation against the slot's resolved authority

Acceptance:

- slot A cannot call slot B's capability
- function A is allowed while function B is undiscoverable and denied
- a function created or edited after StartRun cannot change the run
- archive/revocation/membership removal denies the next authorization decision
  with no positive grant cache
- wrong-audience tokens fail on every integration/report/ping/delivery endpoint
  in WS2/WS3; Product MCP cross-audience behavior is owned by WS8
- denied/failed/stale/wrong-attempt receipts cannot satisfy a gate
- upstream success plus lost tool response is recovered from the durable receipt
  without a second outbound call
- function headers never appear in plan, API, log, audit, or receipt
- envelope credentials and provenance never enter agent env, workspace, prompt,
  arguments, or transcript
- credential canaries are absent from workflow SQLite/events/checkpoints/logs and
  present only in the private encrypted credential store

### WS4 — Celery/Beat, outbox, schedules, polls, and local queue policy

Owners: three sequential server background-work packets.

Dependencies:

- **WS4a schedules/outbox:** WS2b
- **WS4b polling:** WS2b + WS4a
- **WS4c actions/local/final tasks:** WS2c + WS3b + WS4a + WS4b

Packets:

- **WS4a schedules/outbox:** Beat registry, occurrence/DST/missed-run policy,
  and intent-plus-outbox transaction (no external delivery implementation yet)
- **WS4b polling:** exact `/init`/`/poll` contract, safe network phase, durable
  inbox/retry/dead-letter, cursor CAS
- **WS4c actions/local/final tasks:** cloud delivery/reconciliation tasks,
  deterministic action request/result tasks, local Postgres FIFO/claim
  visibility, and workflow-loop/workaround deletion

Owns:

- Beat schedule registration
- thin workflow Celery tasks
- workflow worker-facing service
- trigger stores/state
- safe outbound poll adapter
- deletion of bespoke workflow loops and the release workaround

The legacy single-prompt automation loop remains until legacy rows migrate;
this track deletes only workflow-specific loops and the release workaround.

Required changes:

- Beat discovers due schedule and poll work
- task-owned short transactions call commit-free services; no transaction spans
  external I/O; a domain-owned DB-free prepared-effect adapter performs it
- schedule occurrence identity is `(trigger_id, scheduled_for_utc)` with the
  canonical DST and missed-run matrix
- short transactions create idempotent intent plus cloud outbox; a committed
  local-ready row is immediately claimable without an outbox
- cloud delivery, refresh/reconciliation, and actions are idempotent tasks
- cloud materialization launches agent processes outside the runtime/control
  UID/container/namespace and exposes only the workspace plus brokered channels
- local execution remains claim/heartbeat/report APIs
- local queue policy enforces per-trigger FIFO in Postgres
- poll HTTP occurs outside transactions using pinned-IP safety, Host/SNI control,
  transport-header denial, response/time caps, and no unsafe redirects
- poll inbox supports retry and dead-letter
- cursor advances only after every page item has a durable decision
- a `has_more` cursor CAS and next-page outbox row commit atomically; repeated,
  null, unchanged, or over-budget page chains fail visibly
- provider action retry requires verified provider idempotency/reconciliation;
  otherwise an unknown post-send result becomes `outcome_uncertain`
- Slack uses the canonical stable-action metadata plus bounded
  `conversations.history` reconciliation and preflights `chat:write` plus the
  applicable history scopes

Acceptance:

- duplicate ticks create one occurrence and one outbox job
- crash after intent commit loses no delivery
- retry cannot double-deliver
- transient run creation leaves schedule/poll cursor stationary
- replayed item creates no second run
- blocked network fetch does not block a concurrent trigger update
- DNS rebinding and Host override fail closed
- `/init` and `/poll` fixture bytes, encrypted/write-only poll auth, header
  denylist, five-attempt poison policy, and paged `has_more` behavior pass
- production worker imports and boots
- cloud agent shell cannot read/mutate runtime SQLite/home/private callbacks or
  inspect/signal the control process
- no bespoke workflow scheduler/poller loop or workflow release workaround remains
- a crash after provider acceptance but before local receipt persistence causes
  exactly one reconciled notification or `outcome_uncertain`, never an automatic
  second send

### WS5 — AnyHarness durable sequential execution

Owners: three sequential AnyHarness workflow-runtime packets.

Dependencies:

- **WS5a attempts/observations:** WS1 + WS0B-R
- **WS5b sequential effects:** WS5a
- **WS5c receipt/report integration:** WS5b + WS3c

Packet outcomes:

- **WS5a:** strict plan/binding/generation acceptance, attempts, cursor, slot
  sessions, immutable ordered observation outbox/ACK replay, restart hydration
- **WS5b:** prompt/shell/SCM/action recovery policies, emit/branch behavior, and
  deterministic action wait/result handshake
- **WS5c:** trusted activation lifecycle, gateway receipt verification,
  authenticated reporting, and lost-report recovery

Owns:

- workflow domain models/store/service
- actor/manager and sequential step executor
- attempt/effect persistence
- runtime workflow HTTP surface
- Rust workflow tests

WS0B-R first decomposes `live/workflows/executor.rs` into bounded owners. Do not
raise its max-line allowance.

Required changes:

- bind every run to plan hash, binding hash, and generation and reject
  conflicting delivery
- persist attempt/effect intent before execution
- define replay/reconcile/uncertain policy per effect
- preserve slot session affinity
- retain bounded emit correction
- evaluate branches purely
- append exact whole-snapshot observed revisions with stable identity and report
  every unacknowledged revision in order
- replace native-tool-name gating with WS3 receipt verification
- keep runtime progress durable when server reporting fails
- keep envelope/report/gateway credentials out of workflow SQLite and every
  agent-readable persistence surface
- launch agent processes through the platform isolation broker so arbitrary
  shell access cannot reach runtime home/state/sockets/processes

Acceptance:

- the enumerated fault matrix reconstructs the actor at every persisted boundary
  and asserts the specified resume/query/replay/uncertain outcome
- duplicate actor wake does not duplicate completed work
- spoofed tool-looking transcript data never passes a gate
- real matching successful receipt passes
- failed or wrong-context receipt fails
- prompt, shell, SCM, action, and gateway effects have explicit recovery tests
- adversarial shell probes cannot read/write runtime state or invoke internal
  control/report/lease endpoints
- action failure reaches `on_fail` only after an authoritative result receipt;
  the server never advances the cursor

### WS6 — Parallel checkpoints, worktrees, and join

Owner: AnyHarness runtime git/isolation agent.

Depends on: WS5c.

Owns:

- extracted parallel runtime module
- workflow lane/checkpoint store
- git/worktree adapter changes
- real-repository parallel tests

Required changes:

- consume the acknowledged exact source/checkpoint binding and reject lineage drift
- system checkpoint all dirty state at group entry
- fork every lane from the same checkpoint
- checkpoint complete allowed lane deltas, including committed/staged/unstaged/
  deleted/non-ignored-untracked changes and file metadata
- merge off to the side in authored lane order and atomically adopt only after
  every lane and merge succeeds
- persist base/lane/merged checkpoint identities
- make conflicts typed and durable
- implement canonical failure and global `end` semantics
- enforce group-scoped fresh lane slots/sessions and reject concurrent or
  cross-group slot reuse
- resume safely during lane execution and merge

Acceptance uses real temporary repositories:

- dirty pre-group edit is visible in every lane
- two disjoint uncommitted lane edits survive join
- conflict produces the specified failure with no silent loss
- lane failure/conflict leaves the run workspace at the group-base checkpoint
  while retaining every result/conflict artifact
- completed lane does not rerun after restart
- downstream step sees merged code and all joined emits
- unchanged branch tips are not mistaken for proof of no work
- global `end` retains lane checkpoints for inspection but merges no partial
  group result or emit; completed external effects remain audited

### WS7 — Durable session leases, cancel, and takeover

Owners: three sequential session-runtime/ownership packets.

Depends on: WS2c, WS3c, WS4c, WS5c, and WS6.

Packets:

- **WS7a leases/guard:** all-or-nothing Postgres reservation, AnyHarness SQLite
  enforcement mirror/ACK, generation provenance, central mutation guard
- **WS7b cancellation:** durable command, process/turn stop, quiescent ACK,
  capability/session release ordering
- **WS7c recovery:** restart hydration, expiry/orphan policy, runtime self-fence,
  no-dual-owner takeover

Owns:

- workflow ownership/lease store and policy
- workflow manager cancellation/quiescence
- every session mutation guard integration
- server cancel/takeover command path
- Rust/server ownership tests

Required changes:

- durable atomic acquire-if-free lease with generation
- all explicitly bound sessions reserve atomically and the run waits for every
  prepare/commit ACK; partial install performs quiescent compensating rollback
- close admission and drain or explicitly cancel active/queued pre-lease work;
  no queued command begins after prepare
- synchronous lease hydration before runtime readiness
- one central user-mutation guard
- waiting states retain ownership
- server cancellation writes `cancel_requested` and a durable command
- runtime stops turns/process groups and persists quiescence
- release sessions/capabilities only after observed acknowledgment
- explicit dead-runtime/lease-expiry recovery without dual ownership
- atomically suspend interactive capabilities, validate
  workspace/harness/model/mode, install workflow-only authority, and mint new
  interactive authority only after quiescent release
- restart the same session actor/transcript through central MCP assembly on bind
  and release; do not inject MCP dynamically

Acceptance:

- concurrent binds yield exactly one winner
- runtime restart preserves lockout
- prompt, resume, config, fork, cancel, close, dismiss, title, permission,
  user-input, and MCP-elicitation mutation matrix is covered
- cancellation during agent turn, shell, waiting state, and idle is covered
- failed runtime cancellation remains `cancel_requested`
- a new workflow cannot bind before durable acknowledgment
- expiry alone never rebinds the same live session; absent self-fence and
  quiescent ACK, the old run/session becomes orphaned and only an explicit new
  run may use new sessions
- completion/failure/cancel all prove terminal quiescence, revoke workflow
  authority, reassemble fresh interactive bindings, ACK, then release the lease
- pre-acceptance cancel rolls back prepared/claimed/materializing work or queries
  uncertain AnyHarness delivery; it never assumes non-acceptance
- tests distinguish temporary workflow session leases from irreversible
  `cloud_workspace_claim`

### WS8 — Workflow-agent Product MCP communication

Owner: Product MCP/session-link agent.

Depends on: WS2b, WS3c, WS5c, and WS7c.

Owns:

- workflow Product MCP definition/domain or an approved extension of the existing
  subagent Product MCP
- workflow run roster/session links
- durable peer message storage and next-turn consumption
- Product MCP tests and focused docs

Do not build a workflow-only broker or bypass central MCP assembly.

Required behavior:

- workflow sessions receive a run/session-scoped Product MCP capability
- AnyHarness, not the integration gateway, mints/verifies the Product MCP token
- bind/release restarts the same session actor through central MCP assembly;
  this track supplies the workflow-peer definition, not dynamic injection
- list returns only permitted same-run planned/materialized peers using stable
  slot identity and availability
- send accepts only a materialized peer with a future unstarted actor-scheduled
  turn and queues context for it; it never creates an autonomous wake/turn
- receipts distinguish durable `queued` from recipient-observed `consumed`
- terminal/revoked runs deny new calls
- messages are observable and idempotent

Acceptance:

- sequential and parallel peers can list and message each other
- cross-run and cross-organization access is denied
- integration/report/delivery tokens are denied by Product MCP, and a Product
  MCP token is denied by gateway/report endpoints
- duplicate send is idempotent
- restart preserves delivery
- future unmaterialized sequential peers cannot be messaged; data flow uses emits
- peers with no future turn fail `peer_no_future_turn`
- T3-WF-8 is restored as a required scenario

### WS9 — Desktop authoring, local parity, chat ownership, and relay

Owners: three frontend/Desktop packets.

Dependencies:

- **WS9a product-domain:** WS1 + WS0B-U
- **WS9b editor:** WS9a; fixture-driven work may proceed while server/runtime
  tracks run
- **WS9c local/relay/chat integration:** WS4c + WS5c + WS6 + WS7c + WS8 + WS9b

Packet outcomes:

- **WS9a:** strict definition/wire serialization, reference and topology
  validation, read-only future-version behavior, and ownership-correct extraction
  of reusable product rules into the shared product-domain package
- **WS9b:** full editor authoring for schemas, exact capabilities, parallel and
  includes, typed stable drag/drop identities
- **WS9c:** fresh-worktree default, source-attestation/binding handshake, local
  claim/delivery/relay, bound-chat lockout/takeover, Product MCP wiring, and the
  Desktop native child-process isolation boundary

Owns:

- shared product-domain workflow model/validation/serialization
- workflow editor components and hooks
- workflow launch and run screens
- local executor/claim wiring and relay
- focused product-domain/Desktop unit and component tests (not
  `tests/intent/specs/workflows*.spec.ts`)

WS0B-U first decomposes the oversized editor, trigger card, and home screen.
Components render; hooks own UI orchestration; raw access stays behind access
boundaries.

Required changes:

- author emit schemas
- author required provider/tool or exact function invocation
- author workflow maximum and per-slot capability subset
- stable draft node/lane identities separate from editable slots
- immutable slot identities separate from editable slot labels; all bindings,
  grants, keys, and React identity use IDs
- typed non-bubbling drag/drop
- strict/read-only handling for unsupported schema versions
- preserve every supported field, including include names
- default manual local launch to a fresh worktree
- explicit existing workspace/session binding
- materialization-only offer, trusted local commit/checkpoint attestation,
  binding ACK, then final binding-bound envelope delivery to AnyHarness
- support local parallel definitions
- reject a bound session on a parallel lane and reject lane-slot reuse
- relay stable keys, slot sessions, plan hash, observed revision, and claim ID
- display cancel-requested until quiescent acknowledgment
- show ownership in the bound chat and navigate to the exact session
- display pre-lease drain/cancel and same-session central actor restart honestly
- preflight and launch the native agent sandbox/helper that denies runtime home,
  private loopback/control sockets, process inspection/signals, and credential
  stores while sharing only the selected workspace/brokered I/O

Acceptance:

- a blank editor creates every definition used by T3-WF-1 through T3-WF-10
- save/reload exactly round-trips the canonical definition
- unsupported future data cannot be silently deleted
- lane rename and step drag cannot mutate the wrong topology
- local claim/reclaim and stale report fencing pass
- binding never receives final gateway/report credentials before its source hash
  is accepted
- native adversarial shell probes fail against runtime SQLite/home/control
  endpoints without breaking ordinary workspace/tool access
- relay never numerically rekeys outputs
- frontend boundaries, typecheck, design checks, tests, and max-lines pass

### WS10 — Strict Tier 3, CI, promotion, and observability

Owners: three release-test packets, independent from behavior owners.

Dependencies:

- **WS10a runner/policy:** WS1
- **WS10b fixtures/scenarios:** accepted interfaces from each WS2-WS9 owner;
  final manifest waits for all
- **WS10c observability/promotion:** WS10b plus all WS2-WS9 acceptance

Owns:

- `tests/release/**`
- cross-boundary workflow intent tests
- workflow release CI
- exact-SHA promotion evidence
- staging workflow flag wiring
- workflow dashboards/alerts and runbook links

Packet outcomes:

- **WS10a:** strict runner, required-manifest uniqueness, correlation/deadline/
  budget policy, signed CI artifact format
- **WS10b:** T2 replacement and T3-WF-1 through T3-WF-10 fixtures/scenarios
- **WS10c:** dashboards, bake queries, merged-main-SHA provenance validation,
  fail-closed staging/production paths

Required runner modes:

```text
signal
  informational nightly mode; may report blocked or expected-fail

release
  required manifest; missing, skipped, blocked, expected-fail, cancelled,
  duplicate, or failed means nonzero exit
```

Strict summary artifact:

```json
{
  "headSha": "...",
  "target": "staging",
  "policy": "release",
  "serverSha": "...",
  "serverImageDigest": "sha256:...",
  "desktopArtifactDigest": "sha256:...",
  "desktopUpdaterManifestDigest": "sha256:...",
  "runtimeVersion": "...",
  "workerVersion": "...",
  "templateRef": "...",
  "schemaMigration": "...",
  "ciRunId": "...",
  "stagingDeployRunId": "...",
  "required": [
    "T3-WF-1/cloud", "T3-WF-2/cloud", "T3-WF-3/cloud",
    "T3-WF-4/cloud", "T3-WF-4/desktop",
    "T3-WF-5/cloud", "T3-WF-5/desktop",
    "T3-WF-6/cloud", "T3-WF-7/desktop", "T3-WF-8/cloud",
    "T3-WF-9/desktop", "T3-WF-10/cloud"
  ],
  "results": [
    {"id":"T3-WF-1","lane":"cloud","status":"green"},
    {"id":"T3-WF-2","lane":"cloud","status":"green"},
    {"id":"T3-WF-3","lane":"cloud","status":"green"},
    {"id":"T3-WF-4","lane":"cloud","status":"green"},
    {"id":"T3-WF-4","lane":"desktop","status":"green"},
    {"id":"T3-WF-5","lane":"cloud","status":"green"},
    {"id":"T3-WF-5","lane":"desktop","status":"green"},
    {"id":"T3-WF-6","lane":"cloud","status":"green"},
    {"id":"T3-WF-7","lane":"desktop","status":"green"},
    {"id":"T3-WF-8","lane":"cloud","status":"green"},
    {"id":"T3-WF-9","lane":"desktop","status":"green"},
    {"id":"T3-WF-10","lane":"cloud","status":"green"}
  ],
  "missing": 0,
  "skipped": 0,
  "blocked": 0,
  "expectedFail": 0,
  "cancelled": 0,
  "duplicate": 0,
  "failed": 0
}
```

The artifact is emitted and signed by trusted CI. User-provided JSON is not
release evidence. Every live scenario has a unique correlation ID, fixed
deadline, maximum agent-turn/tool budget, and no test-runner retry after an
external effect; infrastructure setup retries use the same idempotency identity.

Required live scenarios:

| ID | Proof |
| --- | --- |
| T3-WF-1 | Create and launch through the real UI; adversarial shell probes cannot reach runtime state/control; two sequential nodes reuse one stable slot/session; strict emit selects a deterministic branch; required function receipt gates completion. |
| T3-WF-2 | Create the function invocation through its real UI; granted function reaches capture once; ungranted function yields denial receipt and zero outbound. |
| T3-WF-3 | Connected-but-ungranted integration is undiscoverable and denied. |
| T3-WF-4 | Cloud and native Desktop: sequential -> parallel dirty-state lanes -> deterministic join -> downstream sequential stage. |
| T3-WF-5 | Exercise poll-first and workflow-first setup, then cloud and native Desktop targets: `/init`, poll item to completed run, cursor advance, exact replay dedup. |
| T3-WF-6 | Real cloud schedule fires, delivers, and completes in budget. |
| T3-WF-7 | Real Desktop schedule claim, heartbeat, delivery, relay, and `completed`; any other terminal fails. |
| T3-WF-8 | Deterministic sequential topology: materialize B, schedule A to send a generated nonce to B's known future turn, then B consumes and emits the exact nonce; queued and consumed receipts both prove delivery. |
| T3-WF-9 | Bound live session drains/cancels prior queued work, restarts the same session ID through central workflow MCP assembly, blocks mutation, waits for quiescent takeover/reassembly, then permits mutation/rebind. |
| T3-WF-10 | One real Slack notification with stable action metadata; inject crash after Slack acceptance/before local receipt, reconcile through bounded channel-history readback, and prove exactly one message plus one terminal receipt. |

Required CI/release changes:

- make workflow Tier 2 blocking
- remove `continue-on-error` from strict workflow Tier 3
- declaratively enable and validate workflows in staging
- use disposable staging user/org/repo/function/poll/Slack fixtures
- pre-provision and continuously validate owners for the staging identity,
  integration account, poll endpoint, repository, Slack destination, macOS
  runner, and E2B template before Gate B
- require strict local macOS/Desktop and staging/cloud summaries for the exact SHA
- require the summary in production promotion and every alternate production path
- never publish the stable Desktop updater before the same gate
- keep production workflows dark until the approved launch step

The bake is measurable: at least six continuous hours, two consecutive strict
local and staging runs, and at least 20 trigger occurrences including five each
for cloud schedule, Desktop schedule, cloud poll, and Desktop poll. Queries must
show exactly zero duplicate effects/items, orphaned accepted runs, stuck claims
or leases, cross-slot/cross-run scope denials caused by issued credentials, and
unreleased worktrees/process groups. Any threshold violation resets the bake.

### WS11 — Independent adversarial integration review

Owner: reviewer who authored none of WS2 through WS10.

Depends on: all implementation tracks.

Initial mode: read-only.

Review attacks:

- extract or misuse tokens across audiences
- use agent shell access to read/mutate runtime SQLite/home/private sockets,
  forge observations/leases, or inspect/signal the control process
- widen a live grant by creating/editing capabilities
- forge observations or replay stale revisions
- bind one session to two runs
- cancel without quiescing
- crash at every run/outbox/effect/receipt boundary
- trigger DNS rebinding or transport-header override
- duplicate non-idempotent effects
- lose dirty pre-group/lane edits
- move source branch after StartRun
- bypass exact-SHA release evidence
- compare UI copy and controls to actual runtime semantics

Findings return to the owning track. The reviewer does not apply a broad
cross-area cleanup from the review branch.

## 7. Verification program

### 7.1 Doctrine

Each critical guarantee gets:

1. deterministic Tier 1 proof of the state machine/security/failure boundary
2. Tier 2 proof that product surfaces and real services wire it correctly
3. one minimal Tier 3 proof that the deployed artifact reaches the durable outcome

Live-agent assertions use durable outputs, leases, action records, and gateway
receipts. They never depend on transcript wording.

### 7.2 Tier matrix

| Guarantee | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| Contracts | Golden fixtures parsed/serialized by Rust, Python, TS. | API/SDK round-trip preserves identity/redaction. | Run evidence uses the same contract. |
| Sequential | Slot affinity, ordered effects, branch/emit matrices. | Blank editor authors and resolves full definition. | Real cheap agent completes local and cloud sequential runs. |
| Required invocation | Matching successful receipt only; spoofed/failed/stale/wrong-slot fail. | Direct controlled gateway call produces receipts. | Real agent invokes required function and advances. |
| Capabilities | Exact frozen per-slot refs, audience separation, revocation. | Two functions/providers prove allow/deny and zero denied outbound. | Agent can use only the granted capability. |
| Parallel | Checkpoint, isolation, join, conflict, restart. | UI authors exact parallel definition. | Real lanes preserve dirty shared/lane edits and join. |
| Schedule | Slot uniqueness, policy matrices, outbox retry, FIFO. | Production Beat task and relay run once. | Real cloud and Desktop schedules complete. |
| Poll | Safe HTTP, inbox, retry/dead-letter, cursor CAS. | `/init`, poll task, item-to-intent, replay. | Public fixture item reaches one completed run. |
| Ownership | Atomic race, hydration, mutation matrix, cancel ACK. | Held UI and fake runtime ACK path. | Take over an in-flight real session safely. |
| Desktop | Claim race, heartbeat, stale relay, idempotent delivery. | Real server plus controlled local runtime. | Native macOS lane completes. |
| Agent comms | Same-run allow and cross-run denial. | Product MCP is provisioned in session config. | Agent A nonce reaches Agent B emit. |
| Notify | Idempotent action/outbox and uncertain result. | Stable step key creates one action. | One correlated real message. |

### 7.3 Required fault injection

The recovery policy is frozen before fault tests are written:

| Effect | Required recovery after restart |
| --- | --- |
| Agent turn | Reattach/query the persisted harness turn ID. Reconcile a durable terminal transcript/result. If the harness cannot prove whether the turn completed, stop `outcome_uncertain`; never issue a replacement prompt automatically. |
| Shell/process | Reattach to the persisted process-group handle and wait/stop it. If neither a live process nor a durable exit result can be proven, stop `outcome_uncertain` unless the authored step explicitly declares a safe idempotent replay key. |
| SCM/checkpoint/PR | Query the persisted checkpoint/branch/PR identity and reconcile. Reissue only with the identical provider idempotency identity. |
| Gateway invocation | Query the activation-keyed authoritative gateway receipt. A missing result after an unknown upstream outcome is `outcome_uncertain`; never generate a new activation merely because the client response was lost. |
| Server action/notification | Runtime-to-server retry uses the stable action identity. Provider retry is allowed only with verified provider idempotency or reconciliation; otherwise an unknown post-send result is `outcome_uncertain` and is not resent. |
| Observation/report | Retry the identical canonical snapshot revision. The server accepts byte-identical duplicates only. |

At minimum, reconstruct the service/actor after each injected stop:

- run intent committed before outbox relay
- runtime accepted delivery but acknowledgment was lost
- step/effect started before result persistence
- gateway upstream succeeded but response was interrupted
- poll page fetched before inbox commit
- poll item intent committed before run materialization
- action sent around ledger commit
- provider accepted notification before the worker persisted its receipt
- Desktop died before and after runtime delivery
- stale cloud observation arrived after a newer one
- cancellation arrived during an agent turn, shell process, waiting state, and idle
- runtime restarted while sessions were held
- parallel actor restarted after one lane checkpoint and during merge
- lane edits remained uncommitted at completion
- source branch moved after StartRun
- function/integration was created or edited after StartRun

For polling, block the HTTP fetch and update the trigger from another database
connection. The update must not wait, proving that no row lock or transaction is
held across network I/O.

### 7.4 Acceptance traceability manifest

WS1 creates the schema and initial planned rows for
`tests/contracts/workflows/traceability.yaml`; the merge captain then owns that
append-only file under a writer lock. Every numbered acceptance statement in
WS1-WS10 has a stable test ID, exact owning packet, intended file/command, tier,
and expected durable assertions at Gate A0. A packet converts its planned rows
to executable/green before acceptance. A prose-only acceptance or unowned future
test is not complete. The initial required rows are:

| ID | Exact packet and intended file | Planned command | Required assertion |
| --- | --- | --- | --- |
| T1-WF-CONTRACT-01 | WS1: `tests/contracts/workflows/**` | `python3 scripts/check_workflow_contract_fixtures.py` | All three languages parse/serialize identical plan, offer, binding/checkpoint manifest, envelope, observation, receipt, and command fixtures; redaction snapshots contain no credential marker. |
| T1-WF-LEDGER-01 | WS2c: `server/tests/integration/workflows/test_run_ledger.py` | `cd server && uv run pytest -q tests/integration/workflows/test_run_ledger.py` | No delivery before commit; ordered observation ACK/CAS; pre-acceptance cancel proves no claim or waits for rollback/runtime proof. |
| T1-WF-GATEWAY-01 | WS3b+WS3c: `server/tests/integration/workflows/test_gateway_receipts.py` | `cd server && uv run pytest -q tests/integration/workflows/test_gateway_receipts.py` | Issuance lost-response retry returns one generation; trusted activation succeeds; wrong context fails; one upstream call; no secret in public/audit surfaces. |
| T1-WF-BG-01 | WS4a+WS4b: `server/tests/integration/workflows/test_background.py` | `cd server && uv run pytest -q tests/integration/workflows/test_background.py` | Occurrence dedup, no lock over HTTP, poison/dead-letter, atomic next page, cursor stationary until every durable decision. |
| T1-WF-RUNTIME-01 | WS5a+WS5b: `anyharness/crates/anyharness-lib/src/domains/workflows/fault_tests.rs` | `cargo test -p anyharness-lib workflow_fault_local_effect` | Agent/shell/SCM/action recovery reaches its specified outcome; credential canaries are absent from workflow SQLite/events/transcript/log/checkpoints. |
| T1-WF-RUNTIME-02 | WS5c: `anyharness/crates/anyharness-lib/src/domains/workflows/report_tests.rs` | `cargo test -p anyharness-lib workflow_receipt_report_fault` | Activation/receipt/report failures recover through authoritative IDs and ordered observation ACK without duplicated effects or skipped revisions. |
| T1-WF-ISOLATION-01 | WS4c+WS5a+WS9c: `scripts/test-workflow-agent-isolation.sh` plus target tests | `scripts/test-workflow-agent-isolation.sh` | Local/cloud agent shells cannot read/write runtime home/SQLite/vault/sockets or call/signal/inspect control-plane surfaces, while workspace and brokered tools remain usable. |
| T1-WF-PAR-01 | WS6: `anyharness/crates/anyharness-lib/src/domains/workflows/parallel_tests.rs` | `cargo test -p anyharness-lib workflow_parallel` | Dirty deltas survive; atomic adoption and conflict/end semantics preserve artifacts without partial merge/emits. |
| T1-WF-LEASE-01 | WS7a+WS7c: `scripts/test-workflow-leases.sh` plus owned Rust/server tests | `scripts/test-workflow-leases.sh` | Multi-session prepare/commit/rollback is all-or-nothing; mutation denial and expiry never create two owners. |
| T1-WF-PEER-01 | WS8: `anyharness/crates/anyharness-lib/src/domains/product_mcp/workflow_peer_tests.rs` | `cargo test -p anyharness-lib workflow_peer` | Same-run send reaches a future turn; cross-run/future-peer/no-future-turn/autonomous-wake and cross-audience tokens fail. |
| T2-WF-EDITOR-01 | WS9a+WS9b: product-domain/Desktop focused tests | `pnpm --filter @proliferate/product-domain test && pnpm -C apps/desktop test` | Blank editor round-trips all ten definitions and rejects invalid slot lineage/future schema loss. |
| T2-WF-INTENT-01 | WS10b: `tests/intent/specs/workflows*.spec.ts` | `pnpm -C tests/intent test -- workflows` | Accepted WS2-WS9 interfaces compose through the product HTTP/UI seams with the strict target behavior. |
| T3-WF-MANIFEST-01 | WS10a: `tests/release/src/runner/workflow-policy.test.ts` | `pnpm -C tests/release test -- workflow-policy` | Missing, duplicate, blocked, skipped, expected-fail, cancelled, or failed required rows exit nonzero. |
| T3-WF-PROVENANCE-01 | WS10c: `scripts/ci-cd/workflow-evidence.test.mjs` | `node --test scripts/ci-cd/workflow-evidence.test.mjs` | Pre-squash SHA, user JSON, digest mismatch, bypass, or alternate path without signed exact-main evidence is rejected. |

The owning packet records the exact focused command in the manifest. Gate A1
and later gates run accepted packets' command sets and fail on a missing file,
unknown test ID, or still-planned/unexecuted row for an accepted packet.

## 8. Integration gates

### Gate A0 — Architecture and contract freeze

Required:

- WS0/WS1 accepted
- all contract goldens green in three languages
- no secret in public plan/API snapshots
- every acceptance criterion has a planned traceability row with exact packet,
  intended path/command, and durable assertion
- server, runtime, security, Desktop, and release reviewers sign the decision tables

### Gate A1 — Deterministic foundations

Required:

- WS0B and WS2 through WS7 accepted
- state transition, observation, effect, scope, receipt, cursor, branch, action,
  source-binding, and lease matrices green
- production Celery worker import/boot smoke green
- scoped server and AnyHarness structural checks green; no accepted packet owns
  new or expanded debt

### Gate B — Local product path

Required:

- WS4 through WS9 accepted plus the relevant WS10a/WS10b runner/scenarios
- blank-editor Tier 2 green
- controlled local runtime executes sequential/parallel/capability/ownership cases
- native macOS T3-WF-7 and T3-WF-9 green
- local integration gateway and agent communication green
- no blocked or expected-fail required row
- repository-wide max-line, server/AnyHarness/frontend boundary, generated-diff,
  and formatting checks green with no expanded allowlist

### Gate C — Pre-merge integration qualification

Required:

- final integration branch rebased onto current main
- full CI and deterministic manifest green on the integration SHA
- strict local and isolated cloud qualification T3-WF-1 through T3-WF-10 green
- candidate server/Desktop/runtime/worker/template/schema identities recorded
- adversarial review complete and owning-track fixes rerun

Gate C permits the final PR to squash-merge. Its SHA and artifacts are candidate
evidence only and cannot authorize production after the squash.

### Gate D — Post-squash exact-main-SHA staging qualification

Required:

- final PR squash-merged and the new commit is reachable from `main`
- CI rebuilds every selected artifact from that merged SHA
- real staging deploy summary matches the merged SHA
- signed evidence binds server image, Desktop/updater manifest, runtime, worker,
  E2B template, schema migration, CI run, and staging deploy identities
- strict local and staging T3-WF-1 through T3-WF-10 rerun on those artifacts
- six-hour/twenty-occurrence bake and its zero-threshold queries pass
- success/failure and scheduled latency dashboards receiving data
- release notes and operator runbook updates are already in the squashed PR

Any later `main` commit selected for promotion is a different release identity
and invalidates Gate D evidence. Rebuild, redeploy, rerun strict Tier 3, and
restart the bake for that SHA; do not append an untested docs/config commit after
qualification.

### Gate E — Production handoff

Required:

- Gate D signed evidence verifies on every selected production path
- `require_staging_success=false` and workflow-evidence bypasses fail closed
- production workflow flag state and rollback owner are explicit
- a human with production authority gives separate approval for the exact merged SHA

Hard stop: this program ends at an approval-ready handoff. No implementation or
test agent promotes production, publishes the stable updater, moves a production
template tag, or flips the production workflow flag without that separate
approval.

## 9. Standard verification commands

Agents run the focused commands for their track plus the applicable shared gate:

```bash
git diff --check
python3 scripts/check_max_lines.py
python3 scripts/check_frontend_boundaries.py

cargo test --workspace

cd server
uv run pytest -q

pnpm --filter @anyharness/sdk generate
pnpm --filter @anyharness/sdk build
pnpm --filter @proliferate/product-domain test
pnpm -C apps/desktop test
pnpm -C tests/intent test
pnpm -C tests/release typecheck
pnpm -C tests/release test
```

Contract tracks prove shared fixtures in all three languages. Database tracks
forward-apply migrations from a populated pre-feature database. AnyHarness
SQLite changes include forward migration and restart recovery tests.

The merge captain runs the complete gate after each wave; individual agents do
not claim full-repo green based on a focused subset.

## 10. Agent handoff template

Give each implementation agent a bounded packet in this form:

```text
You own <exact packet ID and objective> on a fresh worktree from
workflows/v1-completion at base SHA <sha>.

Accepted dependency SHAs:
- <packet>: <sha>

Assigned writer locks:
- <exact paths>

Contract/fixture versions and acceptance IDs:
- <versions>
- <test IDs>

Read first:
- specs/codebase/features/workflows.md
- specs/tbd/workflows-v1-completion-plan.md#<workstream>
- the relevant area structure specs named in AGENTS.md

Allowed ownership:
- <paths>

Do not edit without merge-captain coordination:
- workflow ORM/migration chain
- shared contract fixtures/version constants
- generated SDKs
- CI scenario registry/promotion workflows
- another workstream's files

Implement the canonical behavior, replace tests that encode the old behavior,
and add the deterministic acceptance cases listed for this workstream. Do not
raise line-count or architecture-boundary allowlists. Do not deploy or merge to
main.

Before handoff, rebase on the exact integration SHA supplied by the captain,
rerun every required check, and report:
- post-rebase tested commit SHA
- files changed
- exact verification commands and results
- unexecuted checks and why
- any canonical-spec ambiguity or cross-track dependency
```

## 11. Immediate next actions

1. Obtain formal server, AnyHarness, security, Desktop, and release Gate A0
   sign-off on the reviewed canonical spec and decision tables.
2. Create `workflows/v1-completion` from the reviewed integration tip.
3. Assign WS0B-S/R/U and WS1; freeze ownership scaffolding and golden contracts.
4. Land WS2a's complete persistence/migration skeleton before parallel server work.
5. Start WS3a and WS5a at their dependency tips; then follow the ordered server
   chain WS2b -> WS3b -> WS2c -> WS3c, branching WS4a/WS4b from WS2b and
   finishing WS4c only after its listed dependencies.
6. Keep WS10a's strict runner work visible from the beginning, while requiring
   every owning track to land its own deterministic tests.
7. Treat the writer map as locks, and update the traceability manifest at every
   accepted packet.

Do not start the final rebase/squash while required scenarios can report blocked
or expected-fail as success. Do not treat any pre-squash run as release evidence,
and do not begin production work before Gate D exact-main-SHA evidence exists.
