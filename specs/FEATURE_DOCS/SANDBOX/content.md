# Sandbox Content

Status: target. This document describes the accepted destination for
user-valuable state inside a cloud sandbox. The body is written in the ideal
state. Every difference from `main` today is listed in
[Current gaps](#current-gaps); the list shrinks as follow-up PRs land, and the
label comes off when it is empty.

## Purpose

The sandbox content platform owns the lifecycle of what the user put in the
box: shared repository clones, the workspace worktrees cut from them, the git
identity commits carry, and the disk all of it consumes. Boundary law with
the lifecycle platform: lifecycle owns the box, content owns what the user
put in it. Test for new state: would the user care if it vanished — content;
would we redeploy it anyway — lifecycle.

Fences, one owner per concern:

- The container — the E2B VM, its states, the provisioning engine,
  pause/resume, runtime binaries — belongs to
  [lifecycle.md](lifecycle.md). Lifecycle transports the
  resource-pressure measurement; content owns what spends the disk.
- Cloud workspace creation choreography — request validation, GitHub
  authority checks, row transactions — belongs to
  [../../codebase/platforms/product/workspace-provisioning.md](../../codebase/platforms/product/workspace-provisioning.md). This document owns
  what that choreography puts on disk, the two records that describe it,
  and when it all leaves.
- GitHub *authority* — tokens, credential leases, the credential helper —
  belongs to [github-auth.md](github-auth.md). This document
  owns *identity*: who the commit says it is by.
- Workflow-run placement has its own contract
  ([WORKFLOWS.md](../WORKFLOWS.md));
  workflow worktrees are deliberately invisible to retention here.
- Disk is bounded and observable, never billed; billing math stays in
  [specs/FEATURE_DOCS/BILLING.md](../BILLING.md).

## The disk, one picture

```text
/home/user/
├── workspace/
│   ├── repos/<owner>/<repo>/     one shared clone per repository environment
│   └── worktrees/...             the managed worktrees root: every workspace
│                                 worktree, placed by AnyHarness
└── .proliferate/                 machinery (binaries, runtime state) — lifecycle's
```

Clone paths are computed by
[paths.py](../../../server/proliferate/server/cloud/materialization/paths.py).
The worktrees root is AnyHarness's managed root
([managed_root.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/managed_root.rs)),
declared by `ANYHARNESS_WORKTREES_ROOT` in the sandbox launch env
([bootstrap.py](../../../server/proliferate/server/cloud/runtime/bootstrap.py))
exactly as local dev profiles already declare it — one fence, every
environment. The clone is per-repository-environment, not per-workspace: ten
workspaces on one repo cost one clone plus ten worktrees sharing its object
store.

## The content laws

- **A workspace is born fresh, then owned.** Worktree creation itself
  fetches the base branch and bases the worktree on the fetched
  remote-tracking ref. After creation the worktree is the user's: nothing
  ever fetches, rebases, or resets it behind them.
- **User work is never silently destroyed.** Clone refresh fails closed on
  dirty/ahead state; reclaim refuses paths outside the managed root;
  retention skips live sessions and workflow worktrees.
- **Cloud row lifecycle does not imply disk deletion.** Archive, restore, and
  delete mutate only the Cloud product row. AnyHarness owns explicit archive,
  unarchive, and purge of its runtime workspace and checkout.
- **Commits attribute to the human.** An agent writing on the user's behalf
  writes as the user.
- **The VM is disposable; pushed work is not.** GitHub is the durable store;
  everything on the sandbox disk is reproducible cache except unpushed
  commits and uncommitted edits — so unpushed work is kept visible (the
  inventory's ahead/dirty counts) rather than assumed safe.

## Shared repository clones

### Create and refresh

One idempotent script, run over the sandbox exec channel by repository
materialization
([repo_environment.py](../../../server/proliferate/server/cloud/materialization/materialize/repo_environment.py)),
is the only writer of the shared clone:

1. `git clone https://github.com/<owner>/<repo>.git` — only if no `.git`
   exists yet (authority: the credential helper,
   [github-auth.md](github-auth.md)).
2. `git fetch --prune origin` — always.
3. Refuse rather than reset: a dirty checkout exits 43, local commits ahead
   of the remote exit 44; both map to a typed checkout error (HTTP 409 with
   an actionable message,
   [workspaces/service.py](../../../server/proliferate/server/cloud/workspaces/service.py))
   instead of a hard reset that eats work. Only exit 42 (not a git repo) and
   these two are classified; the clone's own working tree is expected to sit
   clean on the default branch, because user changes belong in worktrees.
4. `git checkout <default>` (or create it tracking origin), then
   `git reset --hard origin/<default>`.

Triggers, each refreshing as a side effect: repository-environment save
([repositories/service.py](../../../server/proliferate/server/cloud/repositories/service.py)),
GitHub App install/reauth completion
([github_app/service.py](../../../server/proliferate/server/github/service.py)),
sandbox bootstrap preclone of every configured environment
([materialize/sandbox.py](../../../server/proliferate/server/cloud/materialization/materialize/sandbox.py)),
and workspace creation (synchronously, in-request). (Gen-1 managed workflow
delivery was a further trigger until that lane was deleted —
`delivery/cull-sweep/delivery-spec-delete-gen1-workflows.md`.)
Concurrent triggers serialize on the per-sandbox materialization lock; lock
timeout is a typed busy error (503), never a second concurrent refresh.

### Reclaim

Deleting a repository environment is refused (409
`cloud_repository_in_use`) while any workspace or automation references it
([repositories/service.py](../../../server/proliferate/server/cloud/repositories/service.py)),
so a successful delete proves no worktree depends on the clone. The delete
soft-deletes the row, then reclaims the clone directory from the VM after
commit, best-effort — the same commit-then-reclaim pattern lifecycle uses
for VM destruction, with retention as the backstop for a miss.

## Worktrees

### Materialize

Workspace creation ends in `POST /v1/workspaces/worktrees`
([workspaces_worktrees.rs](../../../anyharness/crates/anyharness-lib/src/api/http/workspaces_worktrees.rs)):
repo root id, new branch name, base branch, optional setup script, checkout
mode (`NewBranch` | `DetachedRef`), and a name-conflict policy. **Callers do
not supply a path.** AnyHarness places every worktree under its managed
root, the way workflow placement already does
(`<managed root>/workflows/<run_id>`,
[workflow_placement.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/workflow_placement.rs));
placement is the runtime's concern, identical local and cloud, which is what
makes retire and retention able to operate on everything they should.

Creation performs the born-fresh fetch itself, environment-neutrally:

- `git fetch origin <base-branch>` before `git worktree add`, bounded by the
  same timeout wrapper the push path uses
  ([executor.rs](../../../anyharness/crates/anyharness-lib/src/adapters/git/executor.rs))
  and with `GIT_TERMINAL_PROMPT=0`, so a hung network or missing credential
  can never stall creation or prompt.
- On fetch success the worktree bases on the fetched remote-tracking ref,
  not the clone's possibly-stale local branch.
- On fetch failure creation proceeds on local state and the failure is
  classified and surfaced in the creation result — best-effort, never
  silent. Fail-closed is wrong here: local Desktop runtimes are entitled to
  work offline, and their fetch credentials are ambient (the user's own
  agent/keychain), unlike cloud where the credential helper makes fetch
  reliable.

The exact-ref path (`POST /v1/repo-roots/{id}/workspace-materializations`,
used when adding a Cloud copy of an existing checkout) stays pinned, not
fresh: the server verifies the expected head SHA against GitHub, and
AnyHarness fetches then requires that exact commit
([operations/worktrees.rs](../../../anyharness/crates/anyharness-lib/src/adapters/git/operations/worktrees.rs),
`create_worktree_at_ref`). Client-supplied state never names a base.

### Archive and delete ownership

Cloud workspace archive, restore, and delete mutate only the Cloud product
row; they do not call into the runtime or mutate an AnyHarness workspace or
checkout
([workspace-provisioning.md](../../codebase/platforms/product/workspace-provisioning.md)).
AnyHarness owns its separate user-requested archive, unarchive, and purge
operations. Cloud provider loss is also separate: it marks affected product
rows lost rather than pretending their runtime content can be restored.

There is no longer a backstop retention pass. Automatic pruning was the
retire lifecycle's sweeper, and both left together when `retired` was
absorbed into `archived` — the runtime no longer deletes a checkout the user
did not ask it to delete. A workspace's recorded path stays reserved for its
lifetime, so creation refuses any path an archived row still claims
([store/lookups.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/store/lookups.rs),
`find_archived_by_path_and_kind`).

## One workspace, two records

**The runtime record.** AnyHarness records every workspace it creates in its
own store
([model.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/model.rs),
persisted by
[store/row.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/store/row.rs)):
kind, repo root, path, branches, display name, lifecycle and cleanup state.
This record is the runtime truth in every environment — the same
`POST /v1/workspaces/worktrees` call, the same row, whether the runtime is a
Desktop process or a cloud VM. The runtime knows nothing above itself: no
field, import, or code path in the AnyHarness crate references the Cloud
database.

**The product record.** Cloud workspace creation wraps that same runtime
call in a product-plane transaction
([workspaces/service.py](../../../server/proliferate/server/cloud/workspaces/service.py)):
a `cloud_workspace` row — owner, kind, repository environment, display name,
branch, base branch
([db/models/cloud/workspaces.py](../../../server/proliferate/db/models/cloud/workspaces.py))
— commits first, the runtime call follows, and the returned runtime
workspace id is stamped back onto the row. The row deliberately duplicates
the naming and branch metadata the runtime also keeps; the link between the
planes is that one opaque id, written server-to-runtime-and-back, never
synced in reverse.

Local creation writes no product record: the client calls the runtime
directly
([use-workspace-actions.ts](../../../apps/packages/product-client/src/hooks/workspaces/workflows/use-workspace-actions.ts))
and the runtime record is the only record. The asymmetry is the point:

- A local runtime lives on the same machine as the client — alive exactly
  when the app is — so listing local workspaces just asks the runtime
  ([use-workspaces.ts](../../../apps/packages/product-client/src/hooks/workspaces/cache/use-workspaces.ts));
  a durable second record would only be a cache that can go stale.
- A cloud runtime is usually *not* reachable: paused, killed, or the app is
  a web tab with no VM awake. The cloud list endpoint
  ([workspaces/api.py](../../../server/proliferate/server/cloud/workspaces/api.py))
  reads Postgres only — runtime status derives from the stored sandbox row,
  never a live health call — so the product renders every cloud workspace,
  with an honest status badge, whether or not any VM exists. The row is
  also what makes creation optimistic: it commits before the runtime is
  even asked, so the workspace appears under its target immediately (the
  client seeds the same collections cache local list results land in,
  [collections.ts](../../../apps/packages/product-client/src/lib/domain/workspaces/cloud/collections.ts)).
- The row is the durable half of the marked-lost design (below): when the
  VM dies the runtime record dies with it, and the `cloud_workspace` row is
  what survives to say this workspace existed and its content is lost.

Worktrees born inside the runtime with no product row — workflow placements,
anything created straight through the runtime API — are runtime-plane only:
invisible to the cloud workspace list by design, retention's to collect,
never the product's to display. There is no reconciliation job scanning the
runtime for them, and none is planned; the product plane records what the
product created, not everything the runtime holds.

## Git identity

**Every commit from a cloud sandbox is the user's commit.** A workspace
branch fills with commits made by agents, and those commits leave the
sandbox — pushed to GitHub, opened as PRs, counted in contribution graphs,
read by teammates deciding who to ask about a change. An unattributed
commit is a small permanent lie in the user's repository history, and it is
not repairable after push. So identity is materialized before the first
commit is possible, and a user with no resolvable identity fails typed
rather than committing as nobody.

Resolution happens server-side, once per user per sandbox:

- email: GitHub account email, else the Proliferate account email, else a
  typed `git_identity_required` failure — never an anonymous fallback;
- name: display name, else the email local-part.

The write is deliberately boring: two keys, `user.name` and `user.email`,
set by an idempotent `git config --global` script run over the sandbox exec
channel during repository materialization — the same channel and shape as
the credential-helper configuration step
([github_credentials.py](../../../server/proliferate/server/cloud/materialization/materialize/github_credentials.py)),
which already writes global git config on every sandbox
(`credential.https://github.com.helper`, the SSH→HTTPS `insteadOf`
rewrites). Global scope is correct because the VM is single-user, and
materialization runs before the first workspace exists, so identity is in
place before the first commit is possible.

The credential-helper script itself never touches identity. The helper
(`~/.proliferate/bin/proliferate-git-credential-helper`, reading the lease
files under `~/.proliferate/git/github.com/`) is a push-time *authority*
mechanism: git invokes it when it needs a token. Identity is static
*attribution* config, written once and read by every `git commit`. Authority
says who may push; identity says who the commit is by; they share the global
config file and nothing else.

Commit signing is deliberately not configured: sandbox commits are
attributed, not attested; the push authority chain
([github-auth.md](github-auth.md)) is the integrity
boundary. Two bot identities stay repo-local by design and cannot leak onto
user commits: the cowork root repo (`AnyHarness <anyharness@local.invalid>`,
[cowork/runtime.rs](../../../anyharness/crates/anyharness-lib/src/domains/cowork/runtime.rs))
and workflow scratch repos (`AnyHarness Workflow
<workflow@anyharness.local>`, signing disabled,
[operations/scratch.rs](../../../anyharness/crates/anyharness-lib/src/adapters/git/operations/scratch.rs)).

## Disk

**The disk is observable before it is fatal.** The budget is fixed by the
E2B plan at template build time (the build declares CPU and memory only,
[build-template.mjs](../../../scripts/build-template.mjs); E2B has no
per-sandbox disk knob), so the lever is observation plus the paired-reclaim
law. The runtime measures its own disk — one code path, local and cloud:

- The resource-pressure collector
  ([resource_pressure.rs](../../../anyharness/crates/anyharness-lib/src/observability/resource_pressure.rs))
  reports a disk axis (used/total/available bytes, percent) alongside its
  CPU (`loadAverage1m`, `normalizedPercent`) and memory (`usedBytes`,
  `totalBytes`, `percent`) axes, through the health endpoint clients
  already poll (10 s cloud / 30 s local through the gateway or directly).
  E2B's own `Sandbox.get_metrics()` is an operator cross-check, not the
  product path.
- `GET /v1/worktrees/inventory`
  ([inventory.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/inventory.rs))
  itemizes the spend per worktree: state
  (`associated | orphan_checkout | missing_checkout | conflict`), `managed`,
  measured `storage` bytes (directory walk plus per-workspace SQLite
  estimate), `gitStatus` (dirty/untracked counts, ahead/behind — the
  unpushed-work signal of the durability law), last activity, and
  `availableActions` (prune checkout, delete history, retry purge, delete
  orphan) already wired to delete flows in the client.
- Disk-full during materialization is typed as disk exhaustion in the
  failure receipt
  ([failures.py](../../../server/proliferate/server/cloud/materialization/failures.py))
  with a delete-content remedy — the generic "runtime did not become ready,
  retry later" is worse than useless for ENOSPC, because retrying cannot
  free disk.

Consumption of these signals is client-side and pull-plus-threshold: the
composer status card shows the worktree list with sizes and the cloud
CPU/memory/disk rows
([EnvironmentStatusCard.tsx](../../../apps/packages/product-client/src/components/workspace/chat/input/EnvironmentStatusCard.tsx));
when disk crosses the pressure threshold the client surfaces "your cloud
machine is running low — here are your worktrees" backed by the inventory
and its delete actions. No server-side notification job exists or is
planned; the screens and copy belong to
[cloud-workspace.md](../../codebase/systems/product/workspaces/cloud-workspace.md).

## When the VM dies

Kill is terminal at the provider: no snapshot is taken and a killed sandbox
cannot be resumed — pause is the only state-preserving transition
([E2B persistence](https://e2b.dev/docs/sandbox/persistence)). Resource
exhaustion does not kill the VM: E2B documents no exhaustion-kill anywhere,
and the resource ceilings act inside the guest — a fixed vCPU count
saturates (slow, not dead), the guest kernel's OOM killer takes the
offending process (which the Supervisor restarts when it is one of ours),
and a full disk fails writes (the typed ENOSPC receipt above). If the VM is
killed anyway — provider incident, account action, our own kill — the
`killed` webhook detaches the binding and the logical sandbox survives
([lifecycle.md](lifecycle.md)); the content does not.

**A killed VM is a fresh start, not a restore.** The replacement VM begins
as a new sandbox: the environment layer rebuilds itself on demand (clones
re-clone on the next materialization, identity re-materializes), but the
workspaces are not rebuilt. The work inside them — the only thing that made
each worktree worth having — died with the VM, and re-cutting empty
worktrees under the old names would dress the loss up as recovery. Instead
the loss is surfaced honestly: workspaces bound to the lost VM are marked
lost, the product shows them as such, and the user starts new workspaces on
the replacement. What survives is exactly what the durability law bounds —
everything pushed to GitHub — which is why the ahead/dirty signal stays
visible in the same status surface as disk, and why nothing in this
platform ever treats sandbox disk as the only copy of anything.

## A repository's first week, worked

1. The user saves a cloud repository environment: the script clones
   `workspace/repos/<owner>/<repo>`, fetches, resets to the remote default.
2. Monday: workspace A. Creation fetches the base branch and cuts A's
   worktree from the fetched ref under the managed root. Commits carry the
   user's own name and GitHub email.
3. Thursday: workspace B — based on Thursday's head, while A still sits
   exactly where Monday plus the user's own work left it. Born fresh, then
   owned.
4. Friday: archive A. The Cloud row leaves active product lists, while its
   AnyHarness workspace and checkout are unchanged; restoring the row does
   not need to reconstruct runtime state.
5. Weeks later, experiments accumulate: runtime-status shows disk pressure
   rising and the runtime's explicit workspace actions let the user choose
   what to purge. Cloud row deletion remains independent of that disk action.

## Code map

```text
server/proliferate/
├── server/cloud/materialization/
│   ├── paths.py                          clone path layout on the VM
│   └── materialize/
│       ├── repo_environment.py           clone create/refresh script (fetch, reset, exit codes)
│       ├── sandbox.py                    bootstrap preclone
│       └── github_credentials.py         credential helper wiring (authority, not identity)
├── server/cloud/repositories/service.py  repo-environment save/delete, in-use guard
├── server/cloud/workspaces/
│   ├── service.py                        create flow: refresh, base validation, exact-ref proof
│   └── provisioning.py                   worktree create call
├── db/store/cloud_workspaces.py          archive/delete row writes
└── integrations/anyharness/
    ├── workspaces.py                     worktree create + exact-ref clients
    └── worktrees.py                      retention run + policy clients
anyharness/crates/anyharness-lib/src/
├── adapters/git/
│   ├── executor.rs                       bounded-timeout git subprocess wrapper
│   └── operations/
│       ├── clone.rs                      clone primitive + failed-clone cleanup
│       ├── worktrees.rs                  worktree add / at-ref / remove / prune + fetch
│       └── scratch.rs                    workflow scratch bot identity
├── observability/resource_pressure.rs    CPU/memory/disk pressure collector
├── domains/workspaces/
│   ├── managed_root.rs                   the managed worktrees root fence
│   ├── runtime/
│   │   ├── worktrees.rs                  create flow: placement, fetch, conflict policy
│   │   ├── workflow_placement.rs         runtime-chosen deterministic placement
│   │   └── materialization.rs            retire_worktree_materialization
│   ├── inventory.rs                      per-worktree storage + git status + actions
│   ├── retention.rs                      the retention pass (caps, exclusions, fencing)
│   ├── retention_policy.rs               per-repo cap: default 20, bounds 10–100
│   └── purge.rs                          session-admitted workspace purge
└── api/http/
    ├── workspaces_worktrees.rs           POST /v1/workspaces/worktrees
    └── worktrees.rs                      inventory + retention run/policy routes
apps/packages/product-client/src/
├── components/workspace/chat/input/EnvironmentStatusCard.tsx   composer resource card
├── hooks/workspaces/facade/use-worktree-settings-targets.ts    local + cloud target discovery
└── lib/access/cloud/cloud-sandbox-gateway.ts                   inventory/health via the gateway
```

## Failure modes

- Clone dirty or ahead at refresh: typed checkout error (exit 43/44 → 409);
  never a silent reset. First response:
  [cloud-provisioning-failure.md](../../../guides/operating/cloud-provisioning-failure.md).
- Base-branch fetch fails at worktree create: creation proceeds on local
  state with the failure classified and surfaced; offline Desktop use is a
  legitimate instance of this path, not an error to block on.
- Concurrent creates on one sandbox: serialized by the materialization
  lock; timeout is a typed 503.
- Runtime create fails after the product row commits: the optimistic row
  survives with no runtime id stamped and renders as unhydrated rather than
  pretending to be a workspace; nothing was fabricated on the runtime side.
- Create fails after the worktree exists: an orphan worktree with no
  committed row; retention collects it, correlated through the runtime's
  workspace record.
- Cloud row archive/delete never reaches the runtime: runtime unavailability
  cannot turn the row write into a cleanup failure, and the checkout remains
  runtime-owned.
- Out of disk: typed disk-exhaustion receipt with a delete-content remedy;
  pressure was visible before the failure.
- Identity resolution finds no email: typed `git_identity_required`; no
  anonymous commit.
- VM killed: content lost, sandbox row survives; bound workspaces are
  marked lost rather than restored empty; unpushed work is gone and was
  visibly flagged while it existed.

## Proof

- Clone refresh, exit-code classification, transaction boundaries:
  [test_cloud_repo_materialization_transactions.py](../../../server/tests/integration/test_cloud_repo_materialization_transactions.py),
  [test_cloud_workspace_materialization_service.py](../../../server/tests/integration/test_cloud_workspace_materialization_service.py).
- Exact-ref source verification:
  [test_cloud_workspace_exact_ref_source.py](../../../server/tests/integration/test_cloud_workspace_exact_ref_source.py).
- Purge fencing:
  [purge_tests.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/deletion/tests/purge_tests.rs),
  [deletion/tests/mod.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/deletion/tests/mod.rs).
- Cloud row-only lifecycle proof:
  [test_cloud_workspace_row_lifecycle.py](../../../server/tests/unit/test_cloud_workspace_row_lifecycle.py).
- Pending, landing with the remaining gap PRs: fetch-on-create
  classification tests; repository-environment delete reclaim; a live disk
  axis reading end to end.

Corridor H — content reclaim and the disk story's tail. Named, binary
assertions; the corridor is done when they are green. IDs are stable —
tests reference them by name:

- **H1** Repository-environment delete reclaims its clone through the
  clone-delete primitive, which refuses paths outside the managed fence.
  (Rust tests + pytest)
- **H2** The inventory row carries last activity. (Rust test)
- **H3** Crossing the disk threshold surfaces the worktrees copy
  pointing into the delete dialog (surface owned by
  [cloud-workspace.md](../../codebase/systems/product/workspaces/cloud-workspace.md)).
  (frontend test)
- **H4** The cloud clone flow rides `acquire_repo_root`; grep-gate: the
  standalone clone-script path stays deleted. (Rust + pytest)
- **H5** `workerDegraded` has a consumer: the runtime-status badge
  renders it. (frontend test)

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] Repository-environment delete reclaims nothing and no clone-delete
      primitive exists anywhere in AnyHarness (no route, no store method).
      Build the clone-delete primitive under the managed-root fence, then pair
      repository-environment deletion with an after-commit reclaim.
- [ ] The inventory row carries no last-activity timestamp
      ([inventory.rs](../../../anyharness/crates/anyharness-lib/src/domains/workspaces/inventory.rs)),
      so the disk-pressure surface cannot suggest *stale* worktrees to
      delete, only big ones. Add last activity to the inventory row.
- [ ] The clone create/refresh script bypasses AnyHarness's own repo-root
      acquisition (`acquire_repo_root` /
      [clone.rs](../../../anyharness/crates/anyharness-lib/src/adapters/git/operations/clone.rs)),
      so two independent "make a clone exist" code paths coexist. Fold the
      cloud clone flow into the runtime's acquisition primitives so clone
      mechanics are environment-neutral like everything else here.
