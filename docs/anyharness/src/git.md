# Git

`anyharness-lib/src/git/**` owns workspace-scoped git execution, status
normalization, and action availability for repository operations.

## Core Concepts

The git area is a focused adapter around git CLI execution.

It owns:

- repo-root resolution
- normalized status snapshots
- diff loading
- branch listing and rename
- stage / unstage / commit / push operations

It does not own workspace registration or pull-request hosting logic.

## Core Models

Core model and service files:

- `anyharness/crates/anyharness-lib/src/git/types.rs`
- `anyharness/crates/anyharness-lib/src/git/service.rs`
- `anyharness/crates/anyharness-lib/src/git/parse_status.rs`
- `anyharness/crates/anyharness-lib/src/git/executor.rs`

The main git models are:

- `GitStatusSnapshot`
- `GitStatusSummary`
- `GitChangedFile`
- `GitActionAvailability`
- `GitDiffResult`
- `GitDiffScope`
- `GitDiffFile`
- `GitBranchDiffFilesResult`
- `GitBranch`

These are runtime-owned normalized summaries built from git CLI output.

## Main Flow

### Status Flow

`GitService::status(...)`
(`anyharness/crates/anyharness-lib/src/git/service.rs`):

1. resolves the repo root
2. runs `git status --porcelain=v2 --branch -z`
3. parses the raw output into normalized file and branch state
4. detects current repository operation such as merge or rebase
5. enriches file stats with additions/deletions
6. computes action availability for commit, push, PR, and worktree creation

This is the main “what state is the repo in?” path.

### Parsing and Normalization

`parse_status.rs`
(`anyharness/crates/anyharness-lib/src/git/parse_status.rs`)
owns the porcelain-v2 parser.

It turns raw entries into:

- branch head and upstream state
- ahead/behind counts
- changed-file rows
- included vs excluded state
- conflict detection

`service.rs`
(`anyharness/crates/anyharness-lib/src/git/service.rs`)
then adds higher-level behavior like:

- clean vs dirty summary
- action availability
- suggested base branch

### Diff Flow

`diff_for_path(...)` remains the compatibility entrypoint and delegates to
`diff_for_path_with_scope(...)` with `GitDiffScope::WorkingTree`.

`diff_for_path_with_scope(...)`
(`anyharness/crates/anyharness-lib/src/git/service.rs`):

1. resolves the repo root
2. validates scope-specific arguments
3. loads patch and numstat from the same comparison
4. truncates oversized patch bodies

Scopes are explicit:

- `working_tree`: public compatibility fallback. It returns unstaged patch and
  stats when present, otherwise staged patch and stats, otherwise an empty diff.
- `unstaged`: `git diff -- <path>`.
- `staged`: `git diff --cached -- <path>`.
- `branch`: committed branch changes from
  `git diff --find-renames --find-copies <merge-base> HEAD -- <path> [oldPath]`.

`branch_diff_files(...)` lists committed files for the branch comparison using
matching `--name-status -z` and `--numstat -z` commands. Rename/copy rows keep
both `oldPath` and `path`; per-file branch diffs should pass both paths so git
can preserve rename/copy detection.

Branch base refs are intentionally concrete branch refs only. The resolver
accepts local heads and remote-tracking refs, validates them to commit OIDs, and
uses OIDs for merge-base and diff commands. It does not accept tags, raw OIDs,
or revision expressions.

### Mutating Flows

The git service also owns:

- `stage_paths`
- `unstage_paths`
- `commit_staged`
- `push_current_branch`
- `rename_branch`

These are still git-boundary operations. They do not become higher-level
workflow orchestration.

Command execution itself is kept in:

- `anyharness/crates/anyharness-lib/src/git/executor.rs`

## Boundaries

### Git Owns

- running git commands
- parsing and normalizing git output
- repo-root resolution
- commit/push error normalization
- action availability derived from git state

### Git Does Not Own

- workspace identity and registration
- pull-request provider integrations
- session or editor state
- file read/write safety

## Important Invariants

- The git area should operate against the actual repo root, not arbitrary cwd
  assumptions.
- Status parsing must stay deterministic and transport-friendly.
- Action availability must reflect repository reality, especially around
  conflicts, detached HEAD, and upstream state.
- Hosting or PR logic should not leak into the core git service.

## Extension Points

Add behavior here when it changes git normalization or git CLI operations, for
example:

- new status metadata
- richer diff behavior
- additional branch operations

Do not add behavior here when it belongs to workspaces or hosting-provider
boundaries.
