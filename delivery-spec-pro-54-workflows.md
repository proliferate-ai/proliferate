# Delivery Specification — PRO-54 Workflow Feature (node-DSL workflows)

Frozen delivery specification for the PRO-54 workflow program: chat-first
authoring of a closed five-node JSON DSL, Server-owned definitions and
invocations, and local-first graph execution on AnyHarness. This document is
the founder-approved intent for the whole program, delivered as a ten-PR stack
(A–J below). It lives only on its feature branch per repository convention
(`specs/README.md` — delivery specifications never enter the permanent
documentation path; completed delivery specs live in Git history). The
authoritative product intent is Linear PRO-54; this document adds the
implementation-level rulings and the delivery plan. On approval it is frozen;
implementers report concrete contradictions instead of changing scope.

- Issue: https://linear.app/proliferate-team/issue/PRO-54/workflow-feature
- Baseline: `main` at `1471d4f7e` (release-2026-08-05)
- Empirical groundwork: `experiments/pro-54/FINDINGS.md` (branch
  `codex/pro-54-workflow-generation-experiments`), champion doc bundle
  `experiments/pro-54/best/`
- Supersedes at completion: the Workflows V1 beta (stages×steps documents,
  form authoring, managed-cloud-only delivery)

## 1. Decision register

Rulings made in the 2026-08-05 design session. Each governs the whole stack;
contradictions with area documents must be reported, not silently resolved.

| ID | Ruling |
| --- | --- |
| D1 | Scope: one master specification for the full program, delivered as ordered PR-sized stages with explicit gates. |
| D2 | The workflow builder is a real AnyHarness agent session, not server-side inference. No new Server LLM call path is built for this program. |
| D3 | This release is local-first: the builder session and all workflow run execution happen on the user's desktop AnyHarness. The cloud sandbox is scoped out as an execution environment pending the post-E2B cloud rearchitecture; §11 plans the follow-up concretely. |
| D4 | Hard replacement of the Workflows V1 beta: the stages×steps schemaVersion-1 document, its form-based authoring UI, and its triplicated validation are deleted. No duplicate old/new paths remain at cutover. |
| D5 | `human_in_loop` execution is required in v1. Policy: notify and wait indefinitely; cancellation is the escape hatch. No HITL timeout in v1. |
| D6 | Typed node outputs are submitted through a workflow-owned product MCP tool (`submit_node_result`), validated in-session so the agent self-repairs. A turn that completes without a valid submission triggers one runtime re-prompt (a run-control constant, not DSL-authored); still missing → the run fails with `node_output_missing`. |
| D7 | Capabilities are gateway-enforced per-session grants carried in the frozen invocation, resolved from a repo-owned static capability→provider mapping. |
| D8 | Unbacked capabilities produce publish-time warning diagnostics and invocation-time hard failures before delivery. |
| D9 | Cron triggers generalize the Automations scheduler pattern (per-row schedule + `next_run_at` due-scan tick with locking and sweep), not Celery beat entries. |
| D10 | `agent` and `human_in_loop` nodes gain optional `harness`, `model`, `effort` fields (a deliberate amendment to the issue's verbatim schema). Missing `model` freezes as the existing `targetDefault` selection and resolves on the claiming machine via the catalog's `default_model()`; missing `harness` is compiler-filled from catalog `defaultAgentKind`; `effort` is legal only with an explicit `model` (V1 law retained). |
| D11 | Graph view: `@xyflow/react` (React Flow) with `elkjs` auto-layout, read-only in v1. Code view: existing Monaco/CodeMirror dependencies. |
| D12 | Templates are repo-owned, open-source seed DSL documents in the canonical workflows tree, CI-validated against the schema and compiler; “use template” seeds the builder chat with the template as the initial candidate. |
| D13 | Documentation staging: stage A lands the canonical workflows tree as `Status: target` with one `## Current gaps` checklist (sandbox-program playbook, `specs/authoring.md` rule 5); every later stage strikes its items in the same PR as the code. This delivery spec itself stays branch-only and is mirrored to PRO-54 once frozen. |
| D14 | Builder documentation pack: baked placement (compiled into prompts; node executors never read the MD files), pinned pack provenance (pack id, commit, ordered file list, digest) recorded on every candidate — per the PRO-54 experiment findings. |

## 2. Program shape and lifecycle

One sentence per half: **authoring** produces an immutable published revision
of a node-DSL document through a local builder chat; **execution** freezes
that revision plus typed inputs into a Server invocation that a desktop
claims and runs as a graph of agent sessions.

```text
chat (builder session, local AnyHarness)
  → immutable candidate (local, compiler-diagnosed, provenance-pinned)
  → publish (Server API; authoritative recompile; immutable revision + compiled plan)
  → trigger (manual | cron | webhook — Server-owned invocation service)
  → frozen invocation (revision, typed inputs, grants, execution binding, target=local)
  → claim (desktop executor, Automations claim/heartbeat pattern)
  → run (local AnyHarness graph runtime: one session per agentic node,
         deterministic choice evaluation, pinned-path artifacts)
  → terminal result (success outputs | typed failure) → observed Server-side
```

The five node types, the JSON Schema, the semantic laws, the builder pack
composition, and the webhook wire contract are exactly as written in PRO-54
and are not restated here; §3 records only the deltas and bindings this
specification adds.

## 3. DSL contract deltas (amendments to the PRO-54 schema)

The canonical schema lands at
`specs/codebase/systems/product/workflows/workflow.schema.json` (stage A).
It is the issue's schema with one amendment (D10):

`agentNode` and `humanInLoopNode` gain three **optional** properties (not
added to `required`; `additionalProperties: false` retained):

```json
"harness": { "type": "string", "pattern": "^[a-z][a-z0-9-]{0,31}$" },
"model":   { "type": "string", "minLength": 1, "maxLength": 255 },
"effort":  { "type": "string", "minLength": 1, "maxLength": 64 }
```

Compiler laws attached to these fields (numbered into the canonical
`compilation.md` law list in stage A):

- `effort` present without `model` present is a compile error
  (V1 precedent: `server/proliferate/server/workflows/domain/validation.py:64-113`).
- When present, `harness` must name a catalog agent, `model` must resolve to
  an active catalog model for that harness, and `effort` must be a value of
  that model's effort/reasoning control — validated against the live catalog
  at publish, never enumerated in the schema.
- Missing `harness` → compiler fills the catalog `defaultAgentKind`
  (`catalogs/agents/catalog.json`) into the compiled plan.
- Missing `model` → the compiled plan and frozen invocation carry the
  existing explicit `{"kind":"targetDefault"}` selection
  (`server/proliferate/server/workflows/domain/invocation.py:166-184`);
  the claiming runtime resolves it with the same `default_model()` walk
  normal chat uses
  (`anyharness/crates/anyharness-lib/src/domains/agents/catalog/selection.rs:169-189`),
  failing the node with the existing `ModelUnavailable` error rather than
  guessing. Consequence (accepted): two runs of one revision may execute on
  different models when claimed by machines with different auth contexts.
- Missing `effort` → nothing is written; the harness catalog default applies
  (effort is a post-create live-config write, `session-launch-defaults.ts`
  pattern, exactly as Automations applies control values).

Document identity: the new document keeps the issue's `"schemaVersion": { "const": 1 }`
and new `$id`. The legacy stages×steps document also used `schemaVersion: 1`;
ambiguity is resolved by D4 — legacy rows are removed in stage B and the
compiler rejects stages-shaped documents with a dedicated diagnostic.

## 4. Server (control plane)

### 4.1 Definitions and publication

- `workflow_definition` / revision storage is rewritten in place for the
  node-DSL document (stage B): immutable revisions, RFC 8785 canonical hash,
  compiled-plan JSON, and **authoring provenance** (builder pack id, Git
  commit, ordered file list, content digest, builder session id, candidate
  id) per D14. Definition edits never mutate existing invocations or runs
  (existing law, retained).
- The **Python compiler is the authoritative gate** at publish: JSON Schema
  validation (the canonical file loaded verbatim), then the semantic laws
  (reachability, acyclicity, terminal coverage on every path, dominance-based
  reference legality, binding type equality, closed node vocabulary, §3 model
  laws, credential-shaped-literal scan, markdown-output laws). Diagnostics
  are path-addressed `DefinitionIssue(path, message, kind)` — the existing
  repair-loop signal shape.
- Destructive migration (stage B, flagged in §12): legacy beta definition and
  invocation rows are dropped. The beta is gated off by default
  (`WORKFLOW_MANAGED_RUNS_ENABLED=False`, `server/proliferate/config.py:84`)
  and the frontend beta gate hides the product
  (`apps/packages/product-client/src/pages/WorkflowsPage.tsx:25`), so no GA
  data exists.
- Managed-cloud delivery is **retired, not kept dormant** (flagged in §12):
  the `managedCloud` target is rejected at invocation with a typed error, the
  old delivery wiring that speaks the stages document is deleted with it, and
  `managed-cloud-execution.md` is retired to Git history with a pointer. A
  dormant path that cannot parse the new document would be a duplicate old
  path (repo law).

### 4.2 Invocations, queue, and claims

All three trigger kinds enter one Server-owned invocation service that
freezes: revision, typed inputs (validated against declared workflow
`inputs`), resolved capability grants (§7), execution binding (repository
worktree vs scratch workspace), and `target: local`. New invocations queue
until claimed.

Claim/heartbeat/transition APIs generalize the Automations local executor
(`server/proliferate/server/automations/api.py:58,86`,
`local_executor.py:103` claim TTLs and `RECLAIMABLE_STATUSES`,
`db/store/automation_run_claims.py:218` `FOR UPDATE SKIP LOCKED` selection
filtered by the caller's available repositories, claim columns per
`db/models/automations.py:272-279`). Additions specific to workflows:

- `POST /api/v1/workflows/executor/local/claims` — poll-claim due
  invocations; execution-binding repository must be available to the caller.
- Immediate-claim optimization: a manual invocation created from a desktop
  may be claimed synchronously by that desktop in the invoke response,
  skipping one poll interval.
- Transition ladder (client-pushed, secret-free, mirroring the Automations
  phase ladder and the managed-cloud observation philosophy): claim →
  workspace placed → run started → per-node state snapshots
  (`node_id, attempt, state, started/finished, output names only`) →
  terminal result (success `resultBindings` values / failure
  `reasonCode` + details). Prompts, transcripts, and artifact contents are
  never projected to the Server.
- Sweep: expired claims return to the queue via the trigger scheduler tick
  (same shape as `automations/worker/scheduler.py:41`).

Gate: `WORKFLOW_LOCAL_DELIVERY_ENABLED` (Pydantic field, default `False`,
typed unavailable error, `env-vars.yaml` row) — the same flag convention as
`WORKFLOW_MANAGED_RUNS_ENABLED`.

### 4.3 Triggers

- New tables: `workflow_trigger` (org, workflow, **pinned revision**, kind
  `manual|cron|webhook`, enabled, input-mapping config; cron rows carry
  rrule + timezone + `next_run_at`; webhook rows carry a hashed signing
  secret) and `workflow_trigger_receipt` (unique `(trigger_id, event_id)`
  dedup, raw-body digest, mapped-inputs snapshot, resulting invocation id).
- Cron: a workflow-trigger due-scan tick generalized from
  `automations/worker/scheduler.py:19` (interval loop, Redis lock —
  `server/cloud/materialization/locks.py:32` — backoff, Sentry escalation).
  Firing creates a frozen invocation; execution waits for a claim (accepted
  local-first consequence: runs queue while no desktop is online).
- Webhook: `POST {server}/api/v1/workflow-triggers/{triggerId}/events`
  exactly per the PRO-54 wire contract (headers, `v1=` HMAC-SHA256 over
  `timestamp.eventId.eventType.rawBody`, replay window, dedup, `202` with
  receipt/invocation ids). Implementation follows the existing verifier
  pattern (`integrations/github/app_installations.py:312-314` —
  `hmac.digest` + `compare_digest`) in the cloud webhook router
  (`server/proliferate/server/cloud/webhooks/api.py`).
- Input mapping: trigger config maps normalized event fields to declared
  workflow inputs as `{input_name: constant | "$.body.<pointer>"}`; mapping
  failures (missing required input, type mismatch) persist a rejected
  receipt and do not create an invocation.
- Trigger configuration stays outside the DSL (issue law). Gate:
  `WORKFLOW_TRIGGERS_ENABLED` (default `False`).

## 5. AnyHarness (local runtime)

### 5.1 Authoring domain (`domains/workflow_authoring`)

- The builder session is a normal local chat session created from the
  Workflows surface: catalog-default harness/model, **scratch workspace**,
  `SessionMcpBindingPolicy::InternalOnly` (no integrations), subagents off.
  The builder pack (§6) is baked into the session via `system_prompt_append`
  (`anyharness-contract/src/v1/sessions.rs:162-180` already carries it).
- New workflow-authoring product MCP (registered in
  `app/product_mcp.rs` with a surface/session predicate, following the
  reviews MCP precedent — `domains/reviews/mcp/tools.rs`):
  - `propose_workflow(document)` — runs the local Rust compiler (§5.3);
    diagnostics come back as the tool result for in-session repair; a clean
    compile persists an **immutable candidate** row (SQLite:
    `workflow_authoring_candidates`: session id, seq, document, diagnostics,
    pack provenance) and emits a domain event the UI subscribes to.
  - `get_current_candidate()` — returns the latest candidate document so the
    builder always reasons over the real current DSL (issue requirement),
    including candidates created by user code-view edits.
- Publish is a client-mediated Server call (the desktop client already owns
  Server APIs): latest candidate document + provenance → Server recompiles
  authoritatively → immutable revision. A Server-side diagnostic on publish
  is surfaced in the authoring UI and back into the chat as a message.
- User inline DSL edits (code view) compile through the same local compiler,
  create a candidate with `origin: user_edit`, and inject a system-style
  chat message informing the builder that the candidate changed.

### 5.2 Run runtime (`domains/workflows`, rewritten)

The single-stage restriction
(`domains/workflows/service.rs:468,474`, hardcoded `stage_index: 0` at
`:236-237`) is replaced by a workflow-specific graph executor. The existing
anti-abstraction fence is retained in spirit: no generic step trait, no
generic scheduler, no generic retry framework — this executor knows exactly
five node types.

- **Durable state** (SQLite): `workflow_runs` keeps the frozen
  `invocation_json`/`resolved_plan_json` snapshot; new `workflow_run_nodes`
  rows carry `(run_id, node_id, attempt, state, session_id, prompt_id,
  outputs_json, artifact_paths, started_at, finished_at)`. Node states:
  `pending → running → awaiting_submission_retry → completed | failed`,
  plus `awaiting_human` as a projection flag on HITL nodes. The runtime owns
  the node cursor; the Server never advances a node (existing law).
- **Agentic node execution**: one new internal session per node in the run
  workspace, prompt id `workflow:<runId>:<nodeId>:<attempt>` (extending the
  existing `workflow:<runId>:0:0` convention and the prefix-guarded
  turn-outcome mapping in `domains/workflows/session_extension.rs:52,67-69`).
  Session parameters come from the compiled plan (§3): harness, exact model
  or `targetDefault` resolution (`domains/workflows/resolution.rs` pattern),
  effort applied post-create when authored.
- **Node prompts are runtime-compiled and self-contained** (baked placement,
  D14): builder-authored `objective` + `instructions`, input bindings
  materialized (scalars inlined as JSON; markdown bindings as pinned
  absolute workspace paths with a read-first instruction), the output
  contract (every declared output named, markdown outputs with their exact
  `context/<node>/<file>.md` path and required sections), and the
  `submit_node_result` protocol. Node executors never read the spec MD
  files.
- **`submit_node_result` (workflow run product MCP)**: validates in-session
  that every declared output is present and type-correct and that every
  markdown output exists at its exact pinned path containing the required
  section headings; failures return structured tool errors so the agent
  self-repairs (D6). A recorded valid submission plus a `Completed` turn
  outcome completes the node. `Completed` without a valid submission →
  exactly one re-prompt turn demanding submission (`awaiting_submission_retry`,
  constant `NODE_SUBMISSION_RETRIES = 1` in run-control) → then run failure
  `node_output_missing`. A `Failed`/`Cancelled` turn maps to run failure
  `node_execution_failed` / truthful cancellation (existing run-control
  vocabulary, extended per-node).
- **`choice` evaluation** is deterministic Rust over recorded typed outputs —
  no session. Compile-time type equality makes runtime coercion unnecessary;
  a missing case falls to `default` (schema-required).
- **Terminals**: `success` records `resultBindings` values (markdown values
  as workspace-relative paths); `failure` records `reasonCode` + message +
  `detailBindings`. Both are pushed in the terminal transition (§4.2).
- **`human_in_loop`** (D5): the node session is created attended-capable in
  the same run workspace; the run-control admission law gains an explicit
  HITL carve-out — human chat messages are legal on an active HITL node
  session while all other workflow-owned sessions keep exclusive-execution
  admission. The `interaction` field compiles into the prompt (ask, wait for
  a response when `required: true`, proceed autonomously when `false` after
  asking); machine-branching decisions must also be typed scalar outputs
  (issue law, compiler-checked when a `choice` reads the node). The node
  blocks indefinitely; notification is §8; cancellation is the escape hatch.
- **Workspace**: one isolated retained workspace per run at the existing
  workflows worktree root (`workspace-placement.md` contract survives with
  local paths) — a repository worktree or scratch repo per the invocation's
  execution binding. The `context/` artifact tree lives at the workspace
  root exactly as the schema's `path` pattern pins it.

### 5.3 Rust compiler mirror

Authoring needs sub-second diagnostics locally and the claim path needs
defensive validation, so the semantic laws are implemented twice — Python
(authoritative, publish) and Rust (authoring + claim-time defense). This is
the codebase's existing discipline (V1 validation existed in Python, TS, and
`portable_validation.rs`), made safe the existing way: **one shared fixture
corpus** (`examples/valid/**`, `examples/invalid/**` with expected diagnostic
codes and paths) executed by both suites in CI; a drift in either
implementation fails its build (stage C gate; conformance.md owns the law).

## 6. Builder documentation pack

- Canonical author-facing files (stage A): `generation.md`, `language.md`,
  `node-types.md`, `patterns.md`, `workflow.schema.json`, selected
  `examples/`. Content starts from the experiment champion bundle
  (`experiments/pro-54/best/`: dsl-spec-verbose-v2, laws-gen3,
  protocol-structured-v2) adapted from the experimental sequential DSL to
  the five-node DSL; the design-laws content keeps its named-rule,
  evidence-derived form and stays under evidence-driven iteration
  (FINDINGS mechanism list).
- Pack pinning (D14): the assembled pack records id, Git commit, ordered
  file list, and content digest; every candidate and published revision
  carries it (§4.1, §5.1) so any generation is replayable.
- Placement: baked into the builder session (system-prompt append), and the
  builder is instructed by `generation.md` to write self-contained node
  instructions (the runtime scaffold in §5.2 supplies the protocol
  mechanics). Node executors never receive the pack — the experiments showed
  write-once/materialized-file placement fails and baked placement wins.
- Templates (D12): `specs/codebase/systems/product/workflows/templates/<name>/`
  with `workflow.json` (a valid document) + `README.md` (description,
  starter prompt). Launch set: support triage, on-call investigation, bug
  investigation, release notes (adapted from the experiment scenarios).
  CI validates every template through the same conformance fixtures. “Use
  template” seeds the authoring session's first candidate with the template
  document.

## 7. Capability grants

- **Repo-owned static mapping** (stage B module, versioned with the code;
  D7): `issue_tracker.* → linear`; `messaging.* → slack`;
  `observability.read → sentry, axiom, posthog`; `knowledge_base.* → notion`;
  `web.read → exa, tavily, context7`; `deployments.* → render`;
  `repository.* / git.* → GitHub App or gitlab integration + workspace git
  permissions`; `filesystem.* → session permission policy in the run
  workspace (no gateway involvement)`; `support.*`, `email.*` → **unbacked**
  in current deployments.
- **Publish**: capabilities that are unbacked in the deployment, or that
  require an execution binding the workflow lacks (`repository.*` with a
  scratch binding), produce warning diagnostics (D8).
- **Invoke**: the invocation service resolves each granted capability against
  the executing identity's connected integration accounts
  (`cloud_integration_account`, `db/models/cloud/integrations.py:126`) and
  hard-fails before queueing when a required backing is missing (typed,
  per-capability error). The resolved grant set — `(capability → provider,
  tool-class read|write)` — is frozen into the invocation.
- **Enforcement** (stage I): per-node grants ride the claim; node session
  creation carries a new `SessionMcpBindingPolicy::IntegrationGrants{...}`
  variant (today's policy is binary Inherit/InternalOnly,
  `domains/sessions/model.rs:92-94`) which the gateway binding extension
  applies when filtering `integrations.list_providers/list_tools/call_tool`.
  Authoritative enforcement is Cloud-side: the claim transition registers
  the node session's grant set keyed by the signed session binding
  (`Mcp-Session-Id`, `integrations.md:161-170`), and the virtual gateway
  checks it on every `call_tool` in addition to the existing per-tool
  policy/approval layer. Local filtering is UX; Cloud checking is the
  security boundary. Nodes never inherit another node's grants.

## 8. Product client (desktop)

- **Authoring surface** rebuilds the Workflows page: left = the standard
  chat surface bound to the builder session (`product-ui/src/chat/**`
  transcript + composer); right = a toggleable panel, Cowork-shell layout
  precedent (`CoworkWorkspaceShell.tsx:43,86-115` resizable right panel).
  Graph view: React Flow + ELK auto-layout, read-only, rendered from a typed
  candidate projection in `product-domain` (new dependency, D11). Code view:
  Monaco (already vendored) showing the candidate document; an edit compiles
  locally and lands as a `user_edit` candidate (§5.1). Publish button gates
  on a clean local compile and shows Server diagnostics on rejection.
  Template gallery seeds new authoring sessions.
- **Local run executor** generalizes the Automations pattern: claim poller
  (`use-local-automation-claim-poller.ts:27-28` — 10s poll / 30s heartbeat,
  persisted per-device executor id) and a phase ladder with
  `ensureClaimActive` between phases (`local-automation-executor.ts:25-49`),
  extended to drive the local AnyHarness workflow-run API and push node
  transitions (§4.2).
- **Run UI**: run list/detail rebuilt for node runs — per-node timeline
  (state, attempts, typed output names, artifact paths), terminal result,
  truthful cancellation. A running HITL node renders a “waiting for you”
  entry that opens the node session as a normal chat.
- **HITL notification** (v1, flagged §12): in-app surfacing (run detail +
  a badge on the Workflows page) plus a desktop OS notification via the
  existing Tauri notification path. Messaging-integration notifications
  (Slack DM) are an explicit gap item, not in v1.
- The `WORKFLOWS_BETA_GATE_ENABLED` const (with its documented one-edit
  removal convention) stays **on** for the whole stack and hides the entire
  rebuild; stage J removes it.

## 9. Delivery plan and gates

Each stage is one PR (squash-merged), carries its code + tests + canonical
doc edits striking its `Current gaps` items in the same commit (repo law),
and is independently revertible. Order is dependency order; I and H may land
in either order after G.

| Stage | Scope | Gate |
| --- | --- | --- |
| A | Doc-only: canonical workflows tree per the PRO-54 file list (`README`, `language`, `node-types`, `generation`, `patterns`, `authoring`, `definitions`, `compilation`, `triggers`, `invocations`, `workspace-placement`, `runs`, `run-control`, `migration`, `conformance`) as `Status: target` + one master `Current gaps` checklist; `workflow.schema.json`; `examples/valid|invalid` with expected diagnostics; `templates/`; pack content adapted from `experiments/pro-54/best/`. Existing V1 docs rewritten in place; `managed-cloud-execution.md` marked retired. | `scripts/check_docs.py`; new CI script validates every example + template against the schema; founder review freezes the tree. |
| B | Server replacement: node-DSL document + Python compiler + diagnostics; revision storage with canonical hash, compiled plan, pack provenance; publish/read APIs; capability mapping module + publish warnings; destructive beta-row migration; `managedCloud` target rejection + old delivery wiring deleted; form-editor UI + V1 TS validation deleted (page shows beta-gated empty state); flags `WORKFLOW_LOCAL_DELIVERY_ENABLED`, `WORKFLOW_TRIGGERS_ENABLED` (both default off). | pytest + conformance fixtures green in Python; no stages×steps code path remains (grep gate); frontend typechecks with V1 authoring deleted. |
| C | Rust compiler mirror in `anyharness-lib` + shared-fixture conformance harness in both CIs. | Fixture parity: identical accept/reject + diagnostic codes across Python and Rust suites. |
| D | Graph run runtime (§5.2): node cursor + durable node rows, session-per-node, prompt scaffold, `submit_node_result` MCP + retry law, choice evaluation, terminals, workspace `context/` contract. Local-API driven (no Server delivery yet). | Rust integration tests execute conformance run fixtures end-to-end (scripted harness sessions); truthful cancellation per node proven. |
| E | Authoring domain (§5.1): builder session bootstrap with baked pack + provenance, `propose_workflow`/`get_current_candidate`, candidate store + events, publish handoff. | Intent test: scripted builder chat → valid candidate → publish → Server revision with provenance. |
| F | Authoring UI (§8): chat-left/panel-right surface, React Flow graph, Monaco code view + `user_edit` candidates, templates, publish flow. | `tests/intent` authoring specs; design review; `pnpm typecheck` with new deps. |
| G | Local delivery (§4.2): invocation service + queue + claim/heartbeat/transition APIs, client claim executor + immediate-claim, run history/detail UI. Manual triggers end-to-end. | Intent test: manual invoke → local claim → multi-node run → Server history shows node timeline + terminal result; claim-expiry sweep test. |
| H | HITL (§5.2, §8): attended node sessions, admission carve-out, wait-indefinitely semantics, in-app + OS notification, run-detail chat entry. | Intent test: approval workflow blocks, human responds in chat, typed decision output branches a choice. |
| I | Capability grants (§7): invoke-time resolution + hard fail, grant freezing, `IntegrationGrants` binding policy, Cloud gateway per-session enforcement. | Enforcement tests: out-of-grant `call_tool` denied Cloud-side; unbacked capability blocks invocation; fixtures for publish warnings. |
| J | Triggers (§4.3): trigger tables + CRUD UI, cron due-scan tick, webhook endpoint (HMAC, replay, dedup, mapping), receipts. **Cutover**: remove the frontend beta gate, flip flags on by default, strike remaining gaps, drop `Status: target` labels where drained. | Cron fires a queued invocation; webhook contract tests (signature, replay window, dedup, mapping failures); release validation checklist; founder sign-off with `release:large-feature` (human-confirmed label, repo law). |

## 10. Verification strategy

- **Conformance corpus** (stage A, grown every stage): valid/invalid
  documents with expected diagnostic codes — executed by the Python compiler
  suite, the Rust compiler suite, and (valid subset) the run-runtime
  integration tests. Templates are corpus members.
- **Builder evaluation** (conformance.md law, from FINDINGS): pack revisions
  are validated with held-out scenarios plus blinded pairwise arbitration —
  rubric scores alone saturate and mislead; two experiment promotions
  inverted on held-out data. The evaluation harness from
  `experiments/pro-54/harness` is referenced, not productized.
- **Intent tests** per stage gate (authoring, manual run, HITL, triggers) in
  `tests/intent`, following the existing workflow specs there.
- **Ops note** (from the experiment postmortem): desktop task tooling
  force-switches branches and git-cleans untracked files — evaluation runs
  live outside the repo; results are committed immediately.

## 11. Follow-up program (explicitly out of scope, planned)

Cloud execution and web authoring return after the cloud rearchitecture
(post-E2B). The seams this stack deliberately keeps substrate-neutral:

- `target` on the invocation is an enum; delivery is per-invocation transfer
  of the frozen portable plan (never definition replication). A future cloud
  runtime implements the same claim-or-push delivery against the same plan.
- The portable compiled plan, the node prompt scaffold, `submit_node_result`,
  and the `context/` contract contain no local-machine assumptions beyond
  workspace-root-relative paths.
- Grant enforcement is already Cloud-authoritative (§7), so sandbox node
  sessions inherit the same security boundary unchanged.
- Observation is already a secret-free client-push DTO ladder; a cloud
  runtime substitutes the pusher.
- The builder session is an ordinary AnyHarness session; web authoring is
  “create it on the user's cloud runtime instead” plus the same product MCP
  — no server-side inference is introduced then either (D2 holds).

Also deferred: messaging-channel HITL notifications, HITL timeouts,
org-private templates (“save as template” over Server definitions),
repo-grounded authoring (builder reading the user's repository), parallel/
map/loop node types (schema `$id` bump), per-org capability remapping.

## 12. Flagged assumptions requiring founder confirmation

1. **Managed-cloud retirement** (§4.1): delete rather than keep dormant;
   `managed-cloud-execution.md` retired to Git history. Alternative (keep
   the wiring compiling against the new plan format) costs a duplicate path.
2. **Destructive beta migration** (§4.1): legacy `workflow_definition` /
   invocation rows are dropped, not converted. Assumes no production data of
   value behind the default-off gate.
3. **HITL notification v1** = in-app + desktop OS notification only (§8).
4. **Builder workspace** = scratch + `InternalOnly` (§5.1); the builder does
   not read the user's repository in v1.
5. **`NODE_SUBMISSION_RETRIES = 1`** as the run-control constant (D6).
6. **schemaVersion stays `const 1`** for the new document kind (§3),
   accepting the historical collision with the deleted beta document.
