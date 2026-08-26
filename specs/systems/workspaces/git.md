# Git

`anyharness-lib/src/adapters/git/**` owns workspace-scoped git execution, status normalization, and action availability for repository operations.

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

- `anyharness/crates/anyharness-lib/src/adapters/git/types.rs`
- `anyharness/crates/anyharness-lib/src/adapters/git/service.rs`
- `anyharness/crates/anyharness-lib/src/adapters/git/parse_status.rs`
- `anyharness/crates/anyharness-lib/src/adapters/git/executor.rs`
- `anyharness/crates/anyharness-lib/src/adapters/git/operations/**`
- `anyharness/crates/anyharness-lib/src/adapters/git/operations/snapshot.rs`
- `anyharness/crates/anyharness-lib/src/adapters/git/operations/snapshot_restore.rs`
- `anyharness/crates/anyharness-lib/src/adapters/git/operations/worktree_branch.rs`

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

`GitService::status(...)` delegates to `anyharness/crates/anyharness-lib/src/adapters/git/operations/status.rs`:

1. resolves the repo root
2. runs `git status --porcelain=v2 --branch -z`
3. parses the raw output into normalized file and branch state
4. detects current repository operation such as merge or rebase
5. enriches file stats with additions/deletions from `git diff --numstat -z`
   (unstaged) and `git diff --cached --numstat -z` (staged), keyed by each
   file's current path so renamed entries resolve correctly; untracked files
   are outside `git diff`, so their additions come from a direct line count
   of the file on disk (capped at 5MB; binary or unreadable files stay at 0)
6. computes action availability for commit, push, PR, and worktree creation

This is the main “what state is the repo in?” path.

### Parsing and Normalization

`parse_status.rs` (`anyharness/crates/anyharness-lib/src/adapters/git/parse_status.rs`) owns the porcelain-v2 parser.

It turns raw entries into:

- branch head and upstream state
- ahead/behind counts
- changed-file rows
- included vs excluded state
- conflict detection

`operations/status.rs` then adds higher-level git-derived behavior like:

- clean vs dirty summary
- action availability
- suggested base branch

### Diff Flow

`diff_for_path(...)` remains the compatibility entrypoint and delegates to `diff_for_path_with_scope(...)` with `GitDiffScope::WorkingTree`.

`diff_for_path_with_scope(...)` delegates to `anyharness/crates/anyharness-lib/src/adapters/git/operations/diff.rs`:

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
- `base_worktree`: selected base merge-base to current workspace state. It is
  intended for right-sidebar review surfaces that need committed, staged,
  index-only, unstaged, deleted, renamed, and untracked changes in one current
  comparison.

`branch_diff_files(...)` delegates to `anyharness/crates/anyharness-lib/src/adapters/git/operations/diff_files.rs` and lists committed files for the branch comparison using matching `--name-status -z` and `--numstat -z` commands. Rename/copy rows keep both `oldPath` and `path`; per-file branch diffs should pass both paths so git can preserve rename/copy detection.

`base_worktree_diff_files(...)` delegates to the same diff-files operation and lists current workspace changes relative to the selected base merge-base. It combines git status with diff/name-status/numstat comparisons so index-only staged changes are not lost, and it handles untracked files with add-file diffs against `/dev/null` instead of relying on plain `git diff <base>`.

Branch base refs are intentionally concrete branch refs only. The resolver accepts local heads and remote-tracking refs, validates them to commit OIDs, and uses OIDs for merge-base and diff commands. It does not accept tags, raw OIDs, or revision expressions.

### Mutating Flows

The git service also owns:

- `stage_paths`
- `unstage_paths`
- `commit_staged`
- `commit_all_if_dirty`
- `push_current_branch`
- `rename_branch`

These delegate to named files under `anyharness/crates/anyharness-lib/src/adapters/git/operations/**` and remain git-boundary operations. They do not become higher-level workflow orchestration.

Command execution itself is kept in:

- `anyharness/crates/anyharness-lib/src/adapters/git/executor.rs`

### Archive snapshot, restore, and refusal probes

`operations/snapshot.rs`, `operations/snapshot_restore.rs`, and their shared sentinel table in `operations/status_operation.rs` implement the pure-git half of the archiving-workspaces feature (Archiving Workspaces ADR §3). They are dark by construction in this rung: nothing in the product calls them yet.

- `GitService::snapshot_workspace(workspace_path)` captures a workspace's
  exact git state into a `WorkspaceSnapshot`: `head_sha`, `branch` (`None`
  when detached), the staged tree (`index_tree`, Tindex), the working tree
  (`work_tree`, Twork — staged ∪ unstaged ∪ untracked non-ignored), and
  `SnapshotNotice`s for anything that could not fully round-trip
  (`dirty_submodule`, `embedded_repo`, `partial_capture_tracked`,
  `partial_capture_untracked`). It refuses via typed `SnapshotError` on a
  hollow checkout, a conflict-bearing git operation in progress, or an
  unborn HEAD.
- `GitService::probe_refusals(workspace_path)` exposes the same three
  business-rule refusals read-only, so a caller can refuse before quiescing
  anything. It never writes to the worktree. Lock files are deliberately not
  a probe refusal; `repair_kill_debris` reaps them after quiesce.
- `GitService::repair_kill_debris(workspace_path, quiesce)` runs after
  quiesce and before capture. Given a `QuiesceReport` (killed process
  counts and completion time), it aborts (or `--quit`-and-settles) a
  conflict sentinel that quiesce's own kills produced, and reaps lock files
  left behind by killed git processes, per the risk-ordered rules in the
  spec. Bisect sentinels are never auto-repaired.
- `GitService::restore_snapshot(workspace_path, snap)` and the tree-source
  variant `GitService::restore_trees(workspace_path, work_tree, index_tree)`
  restore a captured snapshot into a worktree whose HEAD is already at the
  archived SHA: `read-tree --reset -u <Twork>`, then `clean -fd`, then
  `read-tree --reset <Tindex>` — Tindex must come last because `read-tree`
  always rewrites the index.
- When a capture's working tree contains LFS pointer files, `Twork` (and,
  symmetrically, `Tindex`) are wrapped in a parentless anchor commit rather
  than shipped as a bare tree (`WorkspaceSnapshot::work_tree_anchor` /
  `index_tree_anchor`, `work_tree_ref_oid()` / `index_tree_ref_oid()`).
  Content consumers always peel `^{tree}`, which resolves both shapes.

`status_operation.rs` gains `sequencer/`, `BISECT_LOG`, and a `git ls-files -u` belt-and-braces check on top of its existing sentinel table, all resolved per-worktree via `git -C <worktree> rev-parse --git-path <name>`. The existing `detect_operation(repo_root) -> GitOperation` keeps its exact signature and five-variant mapping — its three live callers (`status.rs`, `status_summary.rs`, `revert_patches.rs`) see byte-identical behavior. `probe_refusals`/`snapshot_workspace`'s conflict detection is a second, richer projection over the same table, not a second detector.

### Hardened worktree verbs

- `GitService::remove_worktree_force(repo_root, worktree_path)` returns
  `WorktreeRemoveOutcome::{Removed, AlreadyGone}` instead of the old
  `GitWorktreeRemoveOutput { success, stderr }`. It runs `git worktree
  remove --force --force`; on a real failure it `rm -rf`s the directory and
  retries, which clears the registration. `AlreadyGone` maps from exit 128
  only when a post-call stat finds nothing at the path — exit 128 is
  byte-identical whether the directory survives or not, so the stat is
  load-bearing. No path in this verb ever runs a repo-global `git worktree
  prune`.
- `GitService::restore_worktree(source_repo_root, target_path, options)`
  takes a `WorktreeRestoreOptions` struct: `branch` (`None` restores
  detached), `no_checkout` (`worktree add --no-checkout`, for callers that
  write the working tree and index themselves next), and
  `prune_target_registration`, which prunes ONLY the target path's own stale
  registration instead of refusing on it (off preserves today's
  `RegistrationConflict` refusal, which is what the live restore route
  passes). A SIBLING path's prunable registration is a refusal in both
  modes: it belongs to another workspace, and deleting it is the one
  destructive cross-workspace interaction this design forbids. A detached
  restore (`branch: None`) runs the same validate-and-prune block a
  branch-ful restore runs. The target-path-only registration prune
  (`operations/worktree_restore_registry.rs`) removes exactly the admin
  directory whose recorded `gitdir` resolves to the target path, never a
  repo-global prune.
- `GitService::create_branch_at_sha_uniquified(source_repo_root,
  desired_branch, sha)` creates a new branch at `sha`, uniquifying the name
  on collision (`feature-x-archived-2`, ...). It never moves, fetches, or
  fast-forwards an existing ref — unlike `create_worktree_at_ref`, whose
  fast-forward path runs `git branch --force`.

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

Add behavior here when it changes git normalization or git CLI operations, for example:

- new status metadata
- richer diff behavior
- additional branch operations

Do not add behavior here when it belongs to workspaces or hosting-provider boundaries.
