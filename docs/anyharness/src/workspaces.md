# Workspaces

`anyharness-lib/src/workspaces/**` owns execution-surface identity, workspace
registration from paths, worktree creation, and workspace-derived environment.

`anyharness-lib/src/repo_roots/**` owns repo-root identity and repo-level
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
- runtime env derivation from workspace + repo-root metadata

## Core Models

Core model and runtime files:

- `anyharness/crates/anyharness-lib/src/workspaces/model.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/runtime.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/service.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/store.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/resolver.rs`

### `WorkspaceRecord` (`anyharness/crates/anyharness-lib/src/workspaces/model.rs`)

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

now lives on `RepoRootRecord` in `repo_roots/**`, not on `WorkspaceRecord`.

### `ResolvedGitContext` (`anyharness/crates/anyharness-lib/src/workspaces/model.rs`)

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
(`anyharness/crates/anyharness-lib/src/workspaces/runtime.rs`)
is the idempotent lookup-or-create path.

It:

1. canonicalizes the input path
2. resolves git context
3. ensures a repo root exists for the canonical repo root path
4. checks for an existing workspace by canonical path
5. if the path is a worktree:
   - creates or returns a `kind=worktree` workspace for that repo root
6. otherwise creates or returns a `kind=local` workspace for that repo root

This is the main registration path when a client points AnyHarness at a repo.

### Create Workspace

`create_workspace(...)`
(`anyharness/crates/anyharness-lib/src/workspaces/runtime.rs`)
is the explicit create path and follows the same
local-vs-worktree logic without the early return for an existing record.

### Create Worktree

`create_worktree(...)`
(`anyharness/crates/anyharness-lib/src/workspaces/runtime.rs`):

1. loads the repo root and requires it to resolve to a managed repo path
2. runs `git worktree add -b ...`
3. resolves git context for the new path
4. inserts a new durable worktree workspace record
5. optionally runs a setup script inside the new worktree

The returned result includes both the new workspace and optional setup-script
execution output.

### Workspace Environment

`workspace_env(...)`
(`anyharness/crates/anyharness-lib/src/workspaces/runtime.rs`)
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

The underlying git-context and worktree helpers live in:

- `anyharness/crates/anyharness-lib/src/workspaces/resolver.rs`

The durable workspace rows are loaded and stored through:

- `anyharness/crates/anyharness-lib/src/workspaces/store.rs`

## Boundaries

### Workspaces Owns

- canonical execution-surface identity
- local vs worktree distinction
- worktree creation
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

Add behavior to `repo_roots/**` instead when it changes repo-level durable
metadata or repo-root lookup semantics.

Do not add behavior here when it belongs to git status, file safety, repo-root
durability, or live session execution.
