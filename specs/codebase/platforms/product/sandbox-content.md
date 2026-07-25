# Sandbox Content

Status: target. This document describes the accepted destination for
user-valuable state inside a cloud sandbox. The body is written in the ideal
state. Every difference from `main` today is listed in
[Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and the
label comes off when it is empty.

## Purpose

The sandbox content platform owns the lifecycle of what the user put in the
box: the shared repository clones, the workspace worktrees cut from them, the
git identity their commits carry, and the disk all of it consumes. The
boundary law with the lifecycle platform: lifecycle owns the box, content
owns what the user put in it. The test for any new state: would the user care
if it vanished — content; would we redeploy it anyway — lifecycle.

Fences, one owner per concern:

- The container itself — the E2B VM, its states, the provisioning engine,
  pause/resume, runtime binaries and rendered machinery files — belongs to
  [sandbox-lifecycle.md](sandbox-lifecycle.md). Lifecycle declares what disk
  exists; content owns what spends it.
- The product choreography of creating a Cloud workspace — request
  validation, GitHub authority checks, row transactions, idempotency —
  belongs to [workspace-provisioning.md](workspace-provisioning.md). This
  document owns what that choreography puts on the sandbox disk and when it
  leaves.
- GitHub *authority* — tokens, the credential helper, whether a push is
  allowed — belongs to
  [sandbox-github-auth.md](sandbox-github-auth.md). This document owns
  *identity*: who the commit says it is by.
- Workflow-run workspace placement has its own purpose-built contract
  ([workspace-placement.md](../../systems/product/workflows/workspace-placement.md));
  workflow-created worktrees are deliberately invisible to the retention
  described here.
- Compute billing is untouched by any of this; disk is not billed, only
  bounded. Billing math stays in [billing.md](billing.md).

## The disk, one picture

Everything content owns lives under one home directory on the VM, in
data-flow order — clones first, worktrees cut from them:

```text
/home/user/
├── workspace/
│   ├── repos/<owner>/<repo>/          one shared clone per repository
│   │                                  environment; created on first
│   │                                  materialization, refreshed on every one
│   └── worktrees/<owner>/<repo>/
│       └── <branch>-<workspace-id-8>/ one git worktree per Cloud workspace,
│                                      cut from the shared clone
└── .proliferate/                      machinery (binaries, runtime state) —
                                       lifecycle's, not content's
```

Path constants:
[paths.py](../../../../server/proliferate/server/cloud/materialization/paths.py)
(clone root), workspace worktree placement in
[provisioning.py](../../../../server/proliferate/server/cloud/workspaces/provisioning.py).
The shared clone is one-per-repository-environment, not per-workspace: ten
workspaces on one repo cost one clone plus ten worktrees, and every worktree
shares the clone's object store.

## The content laws

- **A workspace is born fresh and then owned.** Creating a workspace
  synchronously refreshes the shared clone (`git fetch --prune` then
  `git reset --hard origin/<default>`) before the worktree is cut, so its
  base is the remote's state at creation time — never whatever a previous
  materialization happened to leave behind. After creation the worktree
  belongs to the user: no process ever fetches, rebases, or resets it behind
  them; catching up with the base branch is an explicit git action by the
  user or their agent.
- **User work is never silently destroyed.** The clone refresh fails closed
  with a typed error when the shared checkout is dirty or holds local
  commits ahead of the remote, instead of hard-resetting over them. Reclaim
  primitives refuse any path outside the managed worktrees root. Retention
  never removes a worktree with an admitted live session, and never touches
  workflow-created worktrees at all.
- **Every create has a paired reclaim.** A workspace delete retires its
  worktree; a repository-environment delete reclaims its shared clone.
  Retention is the backstop for reclaims that were missed (a paused VM, a
  crashed request), not the mechanism of first resort. Without this law the
  disk is an append-only log and every sandbox eventually fills.
- **Commits attribute to the human.** A commit made in a user's workspace
  carries that user's name and email — resolved from their GitHub account,
  falling back to their Proliferate account — materialized into the sandbox
  before their first commit is possible. An agent writing on the user's
  behalf writes as the user, the same way their laptop would.

## Shared repository clones

### Create and refresh

One shell script, executed over the sandbox connection by repository
materialization
([repo_environment.py](../../../../server/proliferate/server/cloud/materialization/materialize/repo_environment.py)),
is the only writer of the shared clone. It clones
`https://github.com/<owner>/<repo>.git` only if the clone does not exist yet,
then always runs `git fetch --prune origin`, checks out the default branch,
and hard-resets it to `origin/<default>` — create and refresh are one
idempotent operation, so callers never reason about "is the clone there
yet". Authority to fetch comes from the credential helper, which is
[sandbox-github-auth.md](sandbox-github-auth.md)'s concern.

The fail-closed half of the never-silently-destroyed law lives in this
script: a dirty shared checkout exits 43, local commits ahead of the remote
exit 44, and both surface as a typed checkout error (HTTP 409 with an
actionable message,
[workspaces/service.py](../../../../server/proliferate/server/cloud/workspaces/service.py))
instead of a reset that eats the work. The shared clone's own working tree
is expected to sit on the default branch; user changes belong in worktrees.

Every trigger of repository materialization refreshes the clone as a side
effect:

| Trigger | Where | Why it refreshes |
| --- | --- | --- |
| Repository environment saved | [repositories/service.py](../../../../server/proliferate/server/cloud/repositories/service.py) | New settings should apply to a current base |
| GitHub App install or reauth completes | [github_app/service.py](../../../../server/proliferate/server/cloud/github_app/service.py) | Newly granted repos become cloneable; preclone them |
| Sandbox bootstrap | [materialize/sandbox.py](../../../../server/proliferate/server/cloud/materialization/materialize/sandbox.py) | A fresh VM preclones every configured environment so first workspace create is fast |
| Workspace create (synchronous, in-request) | [workspaces/service.py](../../../../server/proliferate/server/cloud/workspaces/service.py) | The born-fresh law: the new worktree's base must be current |
| Workflow delivery (frozen base ref) | [delivery.py](../../../../server/proliferate/server/workflows/worker/delivery.py) | Pins the exact ref the run was frozen at rather than the branch head |

Concurrent triggers serialize on the per-sandbox materialization lock; a
lock timeout is a typed busy error, not a second concurrent refresh.

### Reclaim

Deleting a repository environment is refused (409) while any Cloud workspace
or automation still references it
([repositories/service.py](../../../../server/proliferate/server/cloud/repositories/service.py)),
so by the time a delete succeeds, no worktree depends on the shared clone.
The delete then soft-deletes the row and reclaims the clone from the VM:
the server asks the runtime to remove the clone directory after the row
delete commits, best-effort, with retention as the backstop for a miss
(paused VM, crashed request). This is the same commit-then-reclaim pattern
the lifecycle platform uses for VM destruction (row first, provider kill
after commit, reaper as backstop).

## Worktrees

### Materialize

Workspace creation (choreography in
[workspace-provisioning.md](workspace-provisioning.md)) ends with one call
to the runtime: `POST /v1/workspaces/worktrees`
([workspaces_worktrees.rs](../../../../anyharness/crates/anyharness-lib/src/api/http/workspaces_worktrees.rs)),
carrying the server-chosen target path, the new branch name, the validated
base branch, and optionally the environment's setup script. AnyHarness runs
`git worktree add -b <branch> <target> <base>` against the shared clone
([operations/worktrees.rs](../../../../anyharness/crates/anyharness-lib/src/adapters/git/operations/worktrees.rs))
and records the workspace. The worktree-add itself never fetches; freshness
is the synchronous clone refresh that ran moments earlier in the same
request, under the same lock — which is why the born-fresh law names
workspace creation, not worktree creation, as the freshness point.

The exact-ref path is the one deliberate exception: adding a Cloud copy of
an existing local checkout must land on a proven commit, not a branch head,
so the server first verifies the expected head SHA against GitHub and then
calls `POST /v1/repo-roots/{id}/workspace-materializations`, whose
implementation fetches the branch inside AnyHarness and pins the exact ref
([operations/worktrees.rs](../../../../anyharness/crates/anyharness-lib/src/adapters/git/operations/worktrees.rs),
`create_worktree_at_ref`). Client-supplied state is never trusted to name a
base.

### Retire

The reclaim primitive is `retire_worktree_materialization`
([materialization.rs](../../../../anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/materialization.rs)):
it refuses any path outside the canonical managed worktrees root
([managed_root.rs](../../../../anyharness/crates/anyharness-lib/src/domains/workspaces/managed_root.rs)),
then `git worktree remove --force` against the shared clone. The managed
root is declared by `ANYHARNESS_WORKTREES_ROOT` in the sandbox launch env
and matches where the server places worktrees, so the primitive can operate
on every Cloud worktree — the fence exists to make "delete a worktree" a
bounded operation that can never escape into arbitrary filesystem removal.

Retire runs in two ways, per the paired-reclaim law:

- **Paired**: deleting or archiving a Cloud workspace retires its worktree —
  row write first, runtime retire after commit, best-effort. A miss (the VM
  is paused, the request dies) leaves an orphan worktree for the backstop.
- **Backstop**: the retention pass
  ([retention.rs](../../../../anyharness/crates/anyharness-lib/src/domains/workspaces/retention.rs))
  keeps the N most-recently-active worktrees per repository (default 20,
  bounded 10–100, adjustable at runtime via
  `PUT /v1/worktrees/retention-policy`) and retires the rest. It runs at
  runtime startup, after every worktree create, and on demand via
  `POST /v1/worktrees/retention/run`; every pass is capped (20 removals, 50
  attempts, 200 considered) so no single pass can stall the runtime. It
  skips paths outside the managed root, worktrees with admitted live
  sessions, and all workflow-created worktrees.

## Git identity

Commits attribute to the human. The identity is resolved server-side, once
per user per sandbox:

- email: the user's GitHub account email, falling back to their Proliferate
  account email; if neither exists, identity materialization fails typed
  (`git_identity_required`) rather than committing as nobody;
- name: the user's display name, falling back to the email local-part.

It is written as sandbox-global git config (`git config --global`) during
repository materialization — the VM is single-user, so global scope is
correct, and it lands before the first workspace exists, so no commit can
precede it. Commit signing is deliberately not configured: sandbox commits
are attributed, not attested, and the push authority chain
([sandbox-github-auth.md](sandbox-github-auth.md)) is the integrity
boundary.

Two internal bot identities exist and stay repo-local by design, so they can
never leak onto user commits: the cowork root repo commits as `AnyHarness
<anyharness@local.invalid>`
([cowork/runtime.rs](../../../../anyharness/crates/anyharness-lib/src/domains/cowork/runtime.rs))
and workflow scratch repos commit as `AnyHarness Workflow
<workflow@anyharness.local>` with signing explicitly disabled
([operations/scratch.rs](../../../../anyharness/crates/anyharness-lib/src/adapters/git/operations/scratch.rs)).
Machinery commits as machinery; user worktrees commit as the user.

## Disk budget

**The disk budget is observable before it is fatal.** The budget itself is
fixed at template build time by the E2B plan (the template build declares
CPU and memory only,
[build-template.mjs](../../../../scripts/build-template.mjs); E2B exposes no
per-sandbox disk knob), so the lever is not sizing — it is the paired-reclaim
law plus observation:

- The server reads disk usage from E2B's sandbox metrics
  (`Sandbox.get_metrics()`, 5-second cadence, `disk_used`/`disk_total` in
  the pinned SDK) and projects a disk axis alongside CPU and memory into the
  workspace runtime-status payload, so clients can warn before writes fail.
  The lifecycle platform transports the measurement; this document owns what
  spends it.
- An out-of-disk failure during materialization is typed as such in the
  failure receipt
  ([failures.py](../../../../server/proliferate/server/cloud/materialization/failures.py)) —
  "your sandbox is full, delete workspaces or repositories" is actionable;
  the generic "runtime did not become ready, retry later" it would otherwise
  flatten into is worse than useless, because retrying cannot free disk.

## A repository's first week, worked

The laws in sequence, for one user and one repository:

1. The user saves a cloud repository environment. Materialization runs: no
   clone exists, so the script clones into
   `workspace/repos/<owner>/<repo>`, fetches, and hard-resets to the remote
   default branch. Idempotent create-or-refresh means nobody ever asks "is
   the clone there yet".
2. Monday: the user creates workspace A. The same script runs first —
   fetch, reset — then the worktree is cut at
   `workspace/worktrees/<owner>/<repo>/feature-a-1a2b3c4d`, based on
   Monday's remote head. Their commits in it carry their own name and
   GitHub email, because identity was materialized before any workspace
   existed.
3. Thursday: they create workspace B. The clone refreshes again, so B's
   base is Thursday's head — while A still sits exactly where Monday plus
   their own work left it. Born fresh, then owned: nothing synced A behind
   them, and bringing A up to date is their own rebase when they choose.
4. Friday: they delete workspace A. The row delete commits, then the
   runtime retires A's worktree — `git worktree remove --force`, disk
   returned. Had the VM been paused at that moment, the retire would miss
   and the next retention pass would collect A instead: paired reclaim
   first, backstop second.
5. Months later the sandbox accumulates experiments faster than deletes.
   Runtime-status shows disk pressure rising before anything breaks, and
   retention holds the worktree count at the policy cap — the disk is
   observable and bounded, so the failure mode "sandbox silently fills and
   every materialization starts failing with a generic error" cannot
   happen.

## Code map

```text
server/proliferate/
├── server/cloud/materialization/
│   ├── paths.py                          clone and workspace path layout on the VM
│   └── materialize/
│       ├── repo_environment.py           the clone create/refresh script (fetch, reset, exit codes)
│       ├── sandbox.py                    bootstrap preclone of every configured environment
│       └── github_credentials.py         credential helper wiring (authority, not identity)
├── server/cloud/repositories/service.py  repo-environment save/delete, in-use guard
├── server/cloud/workspaces/
│   ├── service.py                        create flow: refresh, base validation, exact-ref proof
│   └── provisioning.py                   worktree target path + branch naming
├── server/workflows/worker/delivery.py   frozen-base materialization for workflow runs
├── db/store/cloud_workspaces.py          archive/delete row writes
└── integrations/anyharness/
    ├── workspaces.py                     worktree create + exact-ref materialization clients
    └── worktrees.py                      retention run + policy clients
anyharness/crates/anyharness-lib/src/
├── adapters/git/operations/
│   ├── clone.rs                          clone primitive + failed-clone cleanup
│   ├── worktrees.rs                      worktree add / at-ref / remove / prune primitives
│   └── scratch.rs                        workflow scratch repo bot identity
├── domains/workspaces/
│   ├── managed_root.rs                   the managed worktrees root fence
│   ├── runtime/materialization.rs        retire_worktree_materialization
│   ├── retention.rs                      the retention pass (caps, exclusions, fencing)
│   ├── retention_policy.rs               per-repo cap: default 20, bounds 10–100
│   └── purge.rs                          session-admitted workspace purge
└── api/http/
    ├── workspaces_worktrees.rs           POST /v1/workspaces/worktrees
    └── worktrees.rs                      retention run/policy + inventory routes
```

## Failure modes

- Shared clone dirty or ahead at refresh: typed checkout error (exit 43/44),
  HTTP 409 with an actionable message; never a silent hard reset. First
  response:
  [cloud-provisioning-failure.md](../../../developing/operating/cloud-provisioning-failure.md).
- Concurrent creates on one sandbox: serialized by the materialization
  lock; timeout is a typed busy error (503), not a concurrent refresh.
- Workspace create fails after the worktree exists: an orphan worktree with
  no committed row; collected by retention, correlated by the workspace-id
  suffix in its path ([workspace-provisioning.md](workspace-provisioning.md)
  owns the choreography evidence).
- Paired retire misses (VM paused, request died): orphan worktree until the
  next retention pass; the miss is logged, never silent.
- Retire asked for a path outside the managed root: refused; this is the
  fence working, and it indicates a placement bug upstream, not a cleanup
  bug.
- Out of disk: typed in the materialization receipt as disk exhaustion with
  a delete-content remedy; runtime-status showed the pressure climbing
  before the failure.
- Identity resolution finds no email: typed `git_identity_required` failure
  at materialization; no commit is ever made as an anonymous fallback
  identity.

## Proof

- Clone refresh, exit-code classification, and transaction boundaries:
  [test_cloud_repo_materialization_transactions.py](../../../../server/tests/integration/test_cloud_repo_materialization_transactions.py),
  [test_cloud_workspace_materialization_service.py](../../../../server/tests/integration/test_cloud_workspace_materialization_service.py).
- Exact-ref source verification:
  [test_cloud_workspace_exact_ref_source.py](../../../../server/tests/integration/test_cloud_workspace_exact_ref_source.py).
- Retention pass behavior (caps, exclusions, admitted-session fencing):
  [retention_tests.rs](../../../../anyharness/crates/anyharness-lib/src/domains/workspaces/retention_tests.rs),
  [retire_preflight_tests.rs](../../../../anyharness/crates/anyharness-lib/src/domains/workspaces/retire_preflight_tests.rs),
  [deletion_tests.rs](../../../../anyharness/crates/anyharness-lib/src/domains/workspaces/deletion_tests.rs).
- Pending: an integration proof that workspace delete retires the worktree
  and repo-environment delete reclaims the clone (lands with the reclaim
  gap PRs below), and a live disk-axis reading through runtime-status.

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] Workspace delete and archive reclaim nothing:
      [cloud_workspaces.py](../../../../server/proliferate/db/store/cloud_workspaces.py)
      only writes rows (`archived_at`, row delete); no AnyHarness retire is
      ever called. Add the after-commit best-effort retire to both.
- [ ] Repository-environment delete reclaims nothing, and no clone-delete
      primitive exists at all: the delete soft-deletes the row
      ([repositories.py](../../../../server/proliferate/db/store/repositories.py))
      and AnyHarness has no repo-root delete route or store method. Build
      the primitive (same managed-fence discipline as worktree retire),
      then call it after commit.
- [ ] Retention never runs in a cloud sandbox: the enabling env
      (`ANYHARNESS_ENABLE_AUTOMATIC_WORKTREE_RETENTION`) is never set —
      the launch env sets only the defer flag
      ([bootstrap.py](../../../../server/proliferate/server/cloud/runtime/bootstrap.py)) —
      and the server-side trigger clients
      ([worktrees.py](../../../../server/proliferate/integrations/anyharness/worktrees.py))
      have zero callers. Enable the pass in the cloud launch env.
- [ ] Even enabled, retention could not touch a single cloud worktree: the
      server places them under `/home/user/workspace/worktrees` while the
      managed root defaults to `/home/user/.proliferate/worktrees`, so the
      fence skips them ("checkout is outside managed worktrees root") and
      retire refuses them. Declare `ANYHARNESS_WORKTREES_ROOT` in the cloud
      launch env to match the server's placement.
- [ ] Git identity is not materialized at all: the only implementation was
      deleted with its parked domain (#823), the pipeline stage that called
      it survives as unimportable dead code
      ([git_identity.py](../../../../server/proliferate/server/automations/worker/cloud_execution/stages/git_identity.py)),
      and every user commit today carries git's own auto-derived fallback
      (`user <user@<sandbox-hostname>>`). Reintroduce identity
      materialization with the resolution rules above; delete the dead
      stage and the orphaned `configure_git_identity` /
      `ensure_repo_checkout` command kinds
      ([constants/cloud.py](../../../../server/proliferate/constants/cloud.py)).
- [ ] No disk observability: `Sandbox.get_metrics()` is never called, the
      Worker heartbeat carries only status and versions, and the
      runtime-status payload has no resource axis
      ([workspaces/models.py](../../../../server/proliferate/server/cloud/workspaces/models.py)).
      Wire the disk axis end to end.
- [ ] Disk exhaustion is untyped: only three checkout exit codes are
      classified
      ([repo_environment.py](../../../../server/proliferate/server/cloud/materialization/materialize/repo_environment.py));
      ENOSPC from any in-sandbox command flattens into the generic
      runtime-not-ready receipt
      ([failures.py](../../../../server/proliferate/server/cloud/materialization/failures.py)).
      Detect and type it.
- [ ] The `prune_workspace_worktree` cloud command kind is dead: an enum
      member and DB-constraint slot with no producer, no payload type, and
      no consumer anywhere
      ([constants/cloud.py](../../../../server/proliferate/constants/cloud.py)).
      Delete it; the paired retire above is the real mechanism.
