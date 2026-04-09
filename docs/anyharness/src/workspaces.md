# Workspaces

`anyharness-lib/src/workspaces/**` owns workspace identity, repo vs worktree
semantics, registration from paths, worktree creation, and workspace-derived
environment.

## Core Concepts

A workspace in AnyHarness is not just an arbitrary path.

It is a durable runtime record describing either:

- a repo workspace
- a worktree workspace

The workspaces area owns:

- identifying the canonical repo root for a path
- distinguishing repo roots from git worktrees
- durable workspace records
- source-workspace relationships
- worktree creation
- runtime env derivation from workspace metadata

## Core Models

Core model and service files:

- `anyharness/crates/anyharness-lib/src/workspaces/model.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/service.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/store.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/resolver.rs`

### `WorkspaceRecord` (`anyharness/crates/anyharness-lib/src/workspaces/model.rs`)

`WorkspaceRecord` is the durable workspace row.

It includes:

- `id`
- `kind`
- `path`
- `source_repo_root_path`
- `source_workspace_id`
- git provider/owner/repo metadata
- original branch
- timestamps

This is the source of truth for workspace identity inside the runtime.

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
(`anyharness/crates/anyharness-lib/src/workspaces/service.rs`)
is the idempotent lookup-or-create path.

It:

1. canonicalizes the input path
2. resolves git context
3. checks for an existing workspace by canonical path
4. if the path is a worktree:
   - ensures the source repo workspace exists
   - creates a worktree record linked to the source workspace
5. otherwise creates a repo record

This is the main registration path when a client points AnyHarness at a repo.

### Create Workspace

`create_workspace(...)`
(`anyharness/crates/anyharness-lib/src/workspaces/service.rs`)
is the explicit create path and follows the same
repo-vs-worktree logic without the early return for an existing record.

### Create Worktree

`create_worktree(...)`
(`anyharness/crates/anyharness-lib/src/workspaces/service.rs`):

1. loads the source workspace and requires it to be a repo workspace
2. runs `git worktree add -b ...`
3. resolves git context for the new path
4. inserts a new durable worktree workspace record
5. optionally runs a setup script inside the new worktree

The returned result includes both the new workspace and optional setup-script
execution output.

### Workspace Environment

`workspace_env(...)`
(`anyharness/crates/anyharness-lib/src/workspaces/service.rs`)
derives the runtime env for workspace-scoped operations.

It includes metadata such as:

- workspace id and kind
- workspace dir
- repo dir
- runtime home
- repo name
- branch
- base ref when present
- source workspace id
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

- canonical workspace identity
- repo vs worktree distinction
- remote parsing into provider/owner/repo metadata
- worktree creation
- workspace-derived env
- setup-script execution for new worktrees

### Workspaces Does Not Own

- git status and diff normalization
- session validation or live runtime state
- file path safety
- hosting-provider PR operations

## Important Invariants

- Repo and worktree workspaces are different durable kinds.
- A worktree workspace must point back to its source repo workspace.
- Workspace paths should be canonicalized before identity decisions.
- Workspace env should be derived from the durable record, not reconstructed
  ad hoc by callers.

## Extension Points

Add behavior here when it changes workspace identity or workspace setup, for
example:

- richer remote parsing
- more workspace metadata
- different setup-script policy
- new worktree creation behavior

Do not add behavior here when it belongs to git status, file safety, or live
session execution.
