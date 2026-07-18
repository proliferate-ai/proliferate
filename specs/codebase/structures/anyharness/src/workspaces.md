# Workspaces

`anyharness-lib/src/domains/workspaces/**` owns execution-surface identity, workspace
registration from paths, worktree creation, and workspace-derived environment.

`anyharness-lib/src/domains/repo_roots/**` owns repo-root identity and repo-level
metadata.

## Core Concepts

A workspace in AnyHarness is not just an arbitrary path.

It is a durable runtime record describing an execution surface:

- a local workspace
- a worktree workspace

The workspaces area owns:

- identifying the canonical repo root for a path
- distinguishing local roots from git worktrees
- durable workspace records
- linking each workspace to a repo root
- worktree creation
- identity-preserving restoration of a missing worktree checkout
- runtime env derivation from workspace + repo-root metadata

## Core Models

Core model and runtime files:

- `anyharness/crates/anyharness-lib/src/domains/workspaces/model.rs`
- `anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/mod.rs` with
  workflow files for identity, worktree creation, materialization, lifecycle,
  env, access, repo metadata, and mobility-destination preparation
- `anyharness/crates/anyharness-lib/src/domains/workspaces/service/mod.rs` with
  durable rule files for identity, worktree registration, metadata, env, and
  record construction
- `anyharness/crates/anyharness-lib/src/domains/workspaces/store/mod.rs` with SQL split
  into lookups, listings, mutations, and row mapping
- `anyharness/crates/anyharness-lib/src/domains/workspaces/resolver.rs` for
  filesystem path to git-context discovery

### `WorkspaceRecord` (`anyharness/crates/anyharness-lib/src/domains/workspaces/model.rs`)

`WorkspaceRecord` is the durable workspace row.

It includes:

- `id`
- `kind`
- `repo_root_id`
- `path`
- `surface`
- original branch
- current branch
- display name
- timestamps

This is the source of truth for workspace identity inside the runtime.

Repo-level metadata such as:

- canonical repo path
- remote provider/owner/repo
- remote URL
- default branch

now lives on `RepoRootRecord` in `domains/repo_roots/**`, not on `WorkspaceRecord`.

### `ResolvedGitContext` (`anyharness/crates/anyharness-lib/src/domains/workspaces/model.rs`)

`ResolvedGitContext` is the discovery result from an arbitrary input path.

It captures:

- canonical repo root
- whether the path is a worktree
- main worktree path when applicable
- current branch
- remote URL

This is the bridge from raw filesystem path to durable workspace record.

## Main Flow

### Resolve From Path

`resolve_from_path(...)`
(`anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/identity.rs`)
is the idempotent lookup-or-create path.

It:

1. canonicalizes the input path
2. resolves git context
3. ensures a repo root exists for the canonical repo root path
4. checks for an existing active workspace by canonical path and kind using
   `created_at ASC, id ASC` ordering
5. if the path is a worktree:
   - creates or returns a `kind=worktree` workspace for that repo root
6. otherwise creates or returns a `kind=local` workspace for that repo root

This is the main registration path when a client points AnyHarness at a repo.
It is also the endpoint used by `proliferate-worker` for
`materialize_workspace(mode=existing_path)`.

For local workspaces, duplicate active rows may share the same canonical path.
`resolve_from_path(...)` still returns the deterministic first active local row
for that path. The runtime does not expose a canonical-vs-sibling concept for
these duplicates; desktop reconstructs that projection from the returned local
workspace rows.

Desktop projection rule (sidebar logical workspaces): duplicate local rows
sharing the same `path + branch` each become their own sidebar entry when they
have their own chats (sessions) or are the current selection — so a user can keep
multiple distinct "project/feature threads" over the same checkout, and a newly
created local workspace (selected immediately, no chats yet) shows right away.
Only genuinely-empty, unselected (setup-only / stale) duplicate rows are folded
behind the first distinct entry — hidden as a junk row but still resolvable via
alias lookup. This lives in `collapseExactLocalWorkspaceDuplicates`
(`apps/desktop/src/lib/domain/workspaces/cloud/logical-workspaces.ts`); distinct
entries get `local-slot` logical ids and `#2`/`#3` sidebar name suffixes.

### Create Workspace

`create_workspace(...)`
(`anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/identity.rs`)
is the explicit create path.

For `kind=local`, create is intentionally non-idempotent by path: creating a
local workspace for a repo path that already has an active local workspace
inserts a fresh workspace row. These duplicate local workspaces share the same
checkout and git state, but have distinct workspace ids and therefore distinct
session lists and runtime session state.

For `kind=worktree`, create remains path-unique. A worktree workspace owns its
materialized checkout path, so active worktree path collisions and pending
retired cleanup for the same worktree path still block creation.

### Create Worktree

`create_worktree(...)`
(`anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/worktrees.rs`):

1. loads the repo root and requires it to resolve to a managed repo path
2. resolves the worktree path and branch candidate
3. runs `git worktree add -b ...`
4. resolves git context for the new path
5. inserts a new durable worktree workspace record
6. schedules setup script execution for the new worktree when requested

By default, worktree creation is strict: an existing path or branch is an
error. Generated-name callers may opt into `nameConflictPolicy`:

- `suffix_path` retries path collisions by suffixing only the worktree path
  leaf.
- `suffix_path_and_branch` retries path or branch collisions by suffixing both
  the worktree path leaf and the branch leaf with the same number.

Explicit user-provided branch/path requests should keep the default strict
policy. Generated local workspace creation may use `suffix_path_and_branch`;
Cloud materialization should usually use `suffix_path` because Cloud preflight
has already reserved the final branch name.

The HTTP worktree creation response returns the new workspace identity. Setup
script execution is asynchronous in the current API surface; callers should not
expect synchronous setup-script output in the creation response.

`proliferate-worker` uses this endpoint for
`materialize_workspace(mode=worktree)`. If worktree creation returns a
non-success response that could represent a compatible existing worktree, the
worker may recover by calling `/v1/workspaces/resolve` for the requested target
path and accepting only matching worktree identity.

### Restore Missing Worktree

`restore_worktree(...)`
(`anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/restore.rs`)
recreates the checkout for an existing active `kind=worktree` workspace. It is
not a create flow: the durable workspace row, workspace id, and attached
sessions remain unchanged.

`POST /v1/workspaces/{workspace_id}/worktree/restore` serializes requests for
the workspace through the operation gate. A request that follows or overlaps a
successful restore returns `outcome=already_present`, so callers may safely
retry without creating another workspace or checkout.

The Git adapter owns the filesystem and Git-registration safety checks. Before
materializing anything, it requires:

- the recorded repository root to exist and resolve unambiguously
- a non-detached recorded current branch to exist locally
- the recorded destination to be absent
- no other active runtime workspace to own that path
- no incompatible, locked, detached, or duplicate Git worktree registration
- the recorded current branch not to be checked out at another path

An exactly matching stale registration for the recorded current branch at the
recorded path may be pruned and recreated. Detached workspaces and legacy
`HEAD` sentinels are ineligible because silently attaching them to an original
or base branch would change checkout semantics. Every other occupied-path or
ambiguous-registration state fails closed with a typed conflict. Restore never
removes or overwrites the destination. It reconstructs committed branch state
only; files or edits that were uncommitted when the checkout was deleted are
not recoverable.

To close the path-occupation race, Git first creates the worktree under a
private sibling staging directory whose checkout has the recorded target's
leaf name. `git worktree move` then moves that checkout into the recorded
parent. Git atomically refuses the move if the target appeared, including as an
empty directory; the runtime removes only its own private staged checkout and
returns the occupied-path conflict.

### Workspace Environment

`workspace_env(...)`
(`anyharness/crates/anyharness-lib/src/domains/workspaces/runtime/env.rs`)
derives the runtime env for workspace-scoped operations from the durable
workspace row plus its owning repo root.

It includes metadata such as:

- workspace id and kind
- workspace dir
- repo dir
- runtime home
- repo root id
- repo name
- branch
- base ref when present
- git provider/owner/repo
- worktree dir for worktree workspaces

This is how workspace identity is carried into lower-level operations and agent
launch env.

The underlying git-context discovery lives in:

- `anyharness/crates/anyharness-lib/src/domains/workspaces/resolver.rs`

Generic git worktree mechanics live in:

- `anyharness/crates/anyharness-lib/src/adapters/git/operations/worktrees.rs`
- `anyharness/crates/anyharness-lib/src/adapters/git/operations/worktree_restore.rs`

The durable workspace rows are loaded and stored through:

- `anyharness/crates/anyharness-lib/src/domains/workspaces/store/**`

## Boundaries

### Workspaces Owns

- canonical execution-surface identity
- local vs worktree distinction
- worktree creation
- missing-worktree restoration for an existing durable workspace
- workspace-derived env
- setup-script execution for new worktrees

### Workspaces Does Not Own

- repo-root durable metadata
- git status and diff normalization
- session validation or live runtime state
- file path safety
- hosting-provider PR operations

## Important Invariants

- Local and worktree workspaces are different durable kinds.
- Multiple active local workspace rows may point at the same canonical repo
  path. This is only allowed for explicit local create; path resolve stays
  deterministic and idempotent.
- Active worktree workspace paths remain unique because worktree cleanup may
  remove the materialized checkout.
- Restoring a missing worktree preserves the existing workspace and session
  identities and never creates a replacement durable row.
- Worktree restoration never removes or overwrites an occupied destination and
  treats ambiguous Git registration state as a conflict.
- Every workspace must point at exactly one repo root.
- Workspace paths should be canonicalized before identity decisions.
- Workspace env should be derived from durable workspace + repo-root records,
  not reconstructed ad hoc by callers.
- Worktree retention policy is enforced only by AnyHarness. Desktop and cloud
  control planes may store desired policy, but they must sync it through the
  runtime retention policy API before triggering cleanup.
- Managed launchers may set `ANYHARNESS_DEFER_STARTUP_RETENTION=1` to skip only
  the automatic startup retention pass until the desired policy is applied.
  This is distinct from `ANYHARNESS_DISABLE_WORKTREE_RETENTION`, which disables
  retention more broadly. Post-create and manual retention runs stay enabled
  when startup retention is deferred.

## Extension Points

Add behavior here when it changes workspace identity or workspace setup, for
example:

- richer worktree setup behavior
- more workspace execution metadata
- different setup-script policy
- new worktree creation behavior

Add behavior to `domains/repo_roots/**` instead when it changes repo-level durable
metadata or repo-root lookup semantics.

Do not add behavior here when it belongs to git status, file safety, repo-root
durability, or live session execution.
