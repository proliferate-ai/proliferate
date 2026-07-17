# Isolated Workflow Workspace Placement

Owner: AnyHarness workspaces (placement/materialization) with a thin Workflows
coordination record.

This document is the current operating truth for how a Workflow run acquires an
isolated workspace *before* it runs. It is placement only: it materializes
exactly one visible, retained, ordinary workspace for a run UUID and returns its
`workspaceId`. It does **not** accept, schedule, or execute the run, and it adds
no cleanup or automatic deletion.

Read with:

- [`runs.md`](runs.md) for one-prompt execution in an existing workspace. The
  run's workspace-creation non-goals predate this slice; §6 of that document is
  reconciled to point here.
- [`../../../platforms/product/workspace-provisioning.md`](../../../platforms/product/workspace-provisioning.md)
  for the Cloud provisioning read path. Workflow placement is a separate,
  purpose-built AnyHarness API and does not go through the Cloud flow.

## 1. Outcome

Given one run UUID and one target-local placement request, AnyHarness
deterministically materializes exactly one isolated, visible, retained ordinary
workspace and returns its `workspaceId`. It stops before accepting or executing
the run.

```text
run UUID + placement
  -> canonical request acceptance (SQLite)
  -> immutable target path + (repo) base OID resolution before effects
  -> exact workspace ensure/adopt through the workspace-owned seam
  -> durable workspaceId
  -> later caller PUTs the Workflow run with that workspaceId
```

## 2. API

```http
PUT /v1/workflow-run-workspaces/{runId}
GET /v1/workflow-run-workspaces/{runId}
```

The PUT body is a strict, schema-version-1 discriminated union on
`placement.kind`:

- `scratch` — no user repository; carries no repository fields.
- `repositoryWorktree` — requires both `repoRootId` and `baseRef`.

Unknown top-level or nested fields, an unknown kind, `scratch` carrying
repository fields, and `repositoryWorktree` missing either field are all coded
`400`. The generated SDK encodes this as a `oneOf` with a closed `kind` enum and
exact per-variant `required` sets.

## 3. Deterministic placement

Both variants materialize at the single deterministic path:

```text
<managed-worktrees-root>/workflows/<runId>
```

No request may override this path. The managed root is resolved through the
owning seam and **fails closed** when it cannot be canonicalized (a
relative/invalid `ANYHARNESS_WORKTREES_ROOT` is rejected, never used raw). The
target parent and final component are proved to be symlink-free descendants of
the canonical root before any filesystem/Git effect or adoption.

- **Scratch**: one blank local Git repository, initial branch `main`, a stable
  AnyHarness-owned non-personal identity, exactly one empty initial commit, no
  remote.
- **Repository worktree**: `baseRef` is resolved to an exact commit OID
  (`<baseRef>^{commit}`, so an annotated tag persists the commit it points at,
  not the tag object) and persisted before any effect; the worktree is created
  from the persisted OID on branch `workflow/<runId>`. A moved mutable ref after
  acceptance cannot change retry meaning. Name-conflict policy is `Fail`: never
  suffix path or branch.

Both variants register as visible ordinary local/standard workspaces with
display name `Workflow run <runId>` and creator context `Workflow { runId }`.

## 4. Exact replay and crash reconciliation

The SQLite materialization row is the durable ownership claim and must exist
before any filesystem effect. Replay is exact:

- identical request reconciles the same record; a different placement under the
  same run UUID is `409` and changes nothing;
- terminal `ready` replays the same `workspaceId`; terminal `failed` does not
  auto-retry.

On a nonterminal replay the workspace-owned ensure/adopt seam inspects only the
deterministic path and adopts an artifact **only** on an exact match of
repo/common-dir, base OID, branch, path, scratch shape (branch, one empty
commit, no remote, stable identity, clean worktree), and `Workflow { runId }`
provenance. Any mismatch fails closed — never a delete, reset, checkout, rename,
or suffix.

## 5. Retention and visibility

Workflow-created workspaces are visible ordinary workspaces that are explicitly
excluded from generic retention eligibility by their creator context (startup
and post-create passes alike). They persist across ready, failed execution,
runtime restart, and Workflow terminality. There is **no cleanup API or
automatic deletion in this version**; a later retention product decision may add
one.

## 6. Binding to later run acceptance

Schema-version-2 run acceptance carries one narrow guard so the shared run UUID
cannot be paired with a different workspace. The HTTP/runtime preflight gives
early typed errors, but it is not the authority: the run store repeats the
classification in the same SQLite transaction that inserts the run and step.
That transaction and materialization acceptance use the shared `Db` transaction
seam, whose connection mutex is held through commit:

- no materialization row: preserve the manual existing-workspace behavior;
- materialization exists but is not ready: `409 workflow_workspace_not_ready`;
- ready materialization whose `workspaceId` differs from the request:
  `409 workflow_workspace_mismatch`;
- ready and matching: continue normal run acceptance.

The reciprocal materialization-acceptance transaction checks
`workflow_runs` before inserting a new same-ID materialization. If a run already
claimed the ID, placement fails with
`409 workflow_run_already_accepted` and creates no materialization or workspace
effect. An already-existing exact materialization remains replayable. Therefore
both possible acceptance orderings serialize to one durable claim; a stale
preflight can never allow two disagreeing rows.

The guard creates no run/session/prompt/turn and no automatic execution
coupling. Schema version 1 is behaviorally unchanged.

## 7. Failure behavior

Failure detail is bounded and secret-free: stored/logged detail excludes
prompts, arguments, credentials, environment values, arbitrary command output,
and **raw Git stderr**. Repository worktree creation routes through a
correlation-only Git seam, and the stored `failure_message` is length-bounded at
the durable boundary regardless of the caller-supplied string. Free-form
placement mismatch reasons are discarded at that boundary; the durable detail
is the fixed `placement mismatch` classification.

## 8. Explicit non-goals

Cloud repo configuration/environment resolution; Cloud delivery/background
tasks; run/session/prompt changes beyond the narrow acceptance guard; setup
scripts; hiding, deleting, pruning, or auto-cleaning Workflow workspaces; cloning
an unconfigured repository; arbitrary caller paths or branch names; and any
generalized placement provider/plugin hierarchy.
