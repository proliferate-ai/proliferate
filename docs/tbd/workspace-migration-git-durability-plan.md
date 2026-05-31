# Workspace Migration Git Durability Plan

Status: implementation in progress on `codex/workspace-migration-git-durability`.

Date: 2026-05-30.

This plan covers the product and implementation work needed to make moving a
workspace between a local worktree and a cloud sandbox reliable when code
changes exist. It started as a plan and now also records the post-implementation
critique findings that should shape the final PR.

## Mission

A user should be able to open either side of a workspace, ask an agent to make
code changes, then move the workspace to the other target without uncommitted or
unpushed changes breaking the flow.

The product stance is:

- Do not nag globally when a workspace becomes dirty.
- Intervene only after the user chooses a migration target.
- If the selected source branch is already safe, move directly.
- If the branch is clean but has unpublished commits or no remote branch, offer
  "Push and move".
- If there are uncommitted changes, show "Prepare branch for move" with an
  editable generated commit message, "Include unstaged changes" enabled by
  default, "Commit, push, and move", "Open Git panel", and "Cancel".
- After Git prep succeeds, rerun preflight and automatically continue the move
  the user already selected.
- Do not make snapshots, forks, or stashes the default escape hatch. Prefer
  commit, push, then migrate.

## Post-Critique Implementation Status

High-effort implementation critique focused on frontend workflow/state,
AnyHarness Git correctness, server/cloud mobility correctness, and end-to-end
reliability. The accepted fixes are now part of the branch:

- Dirty source state wins over "push/publish branch" recovery. A dirty and
  unpublished/ahead branch goes to branch prep, while a clean unpublished/ahead
  branch can still show "Push and move".
- Confirming a move reruns preparation/preflight instead of trusting a stale
  confirm snapshot, and prompt controls are locked while a push/prep/confirm
  action is in flight.
- Cloud-to-local now prepares the destination before freezing the source and
  only purges a destination that was created for the current handoff attempt.
- AnyHarness source preflight uses rich Git status, blocks detached heads,
  in-progress Git operations, conflicts, dirty state, and active review runs,
  and export requires clean Git state plus expected handoff, branch, and commit
  guards.
- Destination preparation validates reusable worktrees by branch, kind, surface,
  head commit, cleanliness, sessions, and terminals, and duplicate checked-out
  branch worktrees are rejected instead of forced.
- Server cloud startup no longer reuses an already-ready workspace when the
  caller asks for a specific base SHA; it requeues provisioning for the
  requested revision and validates the remote branch head before startup.
- Push now prefers the branch's configured upstream remote when available,
  rather than always defaulting to `origin`.

The intentionally deferred items are listed in "Open Decisions / Risks". They
should be visible in PR review rather than hidden as implementation TODOs.

## Source Docs Read

- `AGENTS.md`
- `docs/README.md`
- `docs/features/workspace-migration.md`
- `docs/features/cloud-dispatch.md`
- `docs/primitives/cloud-commands.md`
- `docs/structures/frontend/README.md`
- `docs/structures/frontend/guides/components.md`
- `docs/structures/frontend/guides/hooks.md`
- `docs/structures/frontend/guides/lib.md`
- `docs/structures/frontend/guides/state.md`
- `docs/structures/frontend/guides/copy.md`
- `docs/structures/frontend/guides/access.md`
- `docs/structures/anyharness/README.md`
- `docs/structures/anyharness/guides/domains.md`
- `docs/structures/anyharness/guides/api.md`
- `docs/structures/server/README.md`
- `docs/dev/reference/dev-profiles.md`

Key constraints from those docs:

- Cloud is the durable ledger for workspace identity and handoff state, but not
  a runtime target. AnyHarness on each side owns export and import
  (`docs/features/workspace-migration.md:12`).
- Snapshot/fork migration is out of scope for the move flow
  (`docs/features/workspace-migration.md:69`).
- Desktop is the V1 executor for move operations
  (`docs/features/workspace-migration.md:164`).
- Passive web/mobile UI must read from Cloud DB and not wake the sandbox; command
  and mutation paths use Cloud commands (`docs/primitives/cloud-commands.md:47`,
  `docs/primitives/cloud-commands.md:105`).
- Frontend pure product decisions belong in `lib/domain/**`; multi-step
  sequences belong in `lib/workflows/**`; hooks wire React, stores, and access
  dependencies (`docs/structures/frontend/guides/lib.md:6`,
  `docs/structures/frontend/guides/lib.md:48`,
  `docs/structures/frontend/guides/hooks.md:73`).
- Zustand stores are client-only state and must not become remote caches; remote
  Cloud/AnyHarness state stays in access hooks and TanStack Query
  (`docs/structures/frontend/guides/state.md:12`,
  `docs/structures/frontend/guides/state.md:73`).
- Components should render and delegate product decisions/workflows to
  domain/workflow hooks, while reusable copy and presentation mappings stay out
  of component bodies (`docs/structures/frontend/guides/components.md:1`,
  `docs/structures/frontend/guides/copy.md:1`).
- Product hooks should consume existing access hooks and SDK React hooks rather
  than constructing Cloud/AnyHarness clients directly
  (`docs/structures/frontend/guides/access.md:1`).
- AnyHarness API must remain transport-shaped. Product mobility rules belong in
  the mobility domain, not HTTP handlers.
- Server API/service/store boundaries should keep policy and orchestration out
  of raw route handlers.
- Full-stack validation should use named dev profiles, for example
  `make dev-init PROFILE=mobility-git` and `make dev PROFILE=mobility-git`,
  with `CLOUD_WORKER_TUNNEL=ngrok` or `AGENT_GATEWAY_TUNNEL=ngrok` when managed
  sandboxes need to reach local callbacks (`docs/dev/reference/dev-profiles.md:7`).

## Current Repo Findings

### AnyHarness mobility preflight is strict but not Git-rich enough

- `WorkspaceMobilityPreflightResponse` currently returns branch name, base commit
  SHA, blockers, sessions, and warnings, but not a full Git status snapshot
  (`anyharness/crates/anyharness-contract/src/v1/mobility.rs:60`).
- `preflight_workspace` resolves repo root, `HEAD`, and current branch
  (`anyharness/crates/anyharness-lib/src/domains/mobility/service.rs:148`,
  `anyharness/crates/anyharness-lib/src/domains/mobility/service.rs:163`).
- It currently adds a `workspace_dirty` blocker only when
  `workspace.kind == "local"` (`anyharness/crates/anyharness-lib/src/domains/mobility/service.rs:239`).
  This means local-to-cloud dirty work is blocked, but cloud-to-local dirty work
  may still rely on archive deltas instead of forcing the durable commit/push
  path.
- Export still captures a delta from the source worktree, including uncommitted
  file state, and packages it with the source `HEAD`
  (`anyharness/crates/anyharness-lib/src/domains/mobility/service.rs:403`).
- The export request currently carries only `excludePaths`, so there is no
  source-side contract saying "export exactly this commit and require clean Git
  state" (`anyharness/crates/anyharness-contract/src/v1/mobility.rs:78`).
- Install requires the destination `HEAD` to match the archive base commit and
  fails with `BaseCommitMismatch` otherwise
  (`anyharness/crates/anyharness-lib/src/domains/mobility/service.rs:449`).

Implication: the old low-level archive path can move dirty deltas, but this
product flow must not rely on that. AnyHarness export needs a required
Git-durable mode: the caller passes `expectedBaseCommitSha` plus
`requireCleanGitState`, the mobility domain rechecks branch, `HEAD`, operation,
and cleanliness immediately before archive collection, and export refuses to
smuggle dirty deltas if anything changed after frontend preflight. The strict
destination base-SHA check should remain.

### The Git status and mutation APIs already contain the right primitives

- `GitStatusSnapshot` already models branch, `headOid`, upstream, ahead/behind,
  detached, operation, conflicted, clean, changed files, and action availability
  (`anyharness/crates/anyharness-contract/src/v1/git.rs:10`).
- The AnyHarness Git service parses `git status --porcelain=v2 --branch -z`
  (`anyharness/crates/anyharness-lib/src/adapters/git/service.rs:23`).
- `can_push` already means clean and either ahead or no upstream
  (`anyharness/crates/anyharness-lib/src/adapters/git/service.rs:99`).
- Stage, commit, and push are already exposed in AnyHarness:
  `stage_paths`, `commit_staged`, and `push_current_branch`
  (`anyharness/crates/anyharness-lib/src/adapters/git/service.rs:303`,
  `anyharness/crates/anyharness-lib/src/adapters/git/service.rs:333`,
  `anyharness/crates/anyharness-lib/src/adapters/git/service.rs:369`).
- `autosave_cowork_workspace` already demonstrates "stage all and commit" for a
  background flow, but it is too blunt for migration because migration needs
  editable commit copy, an explicit user action, and an unstaged toggle
  (`anyharness/crates/anyharness-lib/src/adapters/git/service.rs:444`).

Implication: do not invent a separate Git transport. Reuse the existing status,
stage, commit, and push APIs, but extend push to target the remote that backs
the mobility workspace's GitHub owner/repo instead of silently defaulting to an
unrelated `origin`.

### Destination Git preparation needs safety hardening

- Cloud-to-local destination preparation ultimately adds a worktree for an exact
  ref and can fail if the local repo has not fetched the cloud-pushed commit
  yet (`anyharness/crates/anyharness-lib/src/workspaces/resolver.rs:220`).
- If a branch already exists locally, the current worktree path can reset it to
  the requested ref (`anyharness/crates/anyharness-lib/src/workspaces/runtime.rs:356`).

Implication: cloud-to-local needs a destination Git safety phase before
`prepare-destination`: fetch the requested branch/SHA, verify reachability,
refuse destructive branch movement, and only fast-forward an existing branch
under explicit safe conditions. Otherwise the UI should show a sync/recovery
blocker instead of moving or resetting local branch state.

### Desktop publish flow is the closest reusable UI/workflow

- `useWorkspacePublishWorkflow` owns publish dialog draft state and wires
  `useGitStatusQuery`, `useStageGitPathsMutation`, `useCommitGitMutation`, and
  `usePushGitMutation`
  (`apps/desktop/src/hooks/workspaces/workflows/use-workspace-publish-workflow.ts:29`).
- Its current `includeUnstaged` default is `false`
  (`apps/desktop/src/hooks/workspaces/workflows/use-workspace-publish-workflow.ts:38`).
  Migration prep should default it to `true`.
- `buildPublishWorkflowSteps` already stages unstaged and partial files when
  `includeUnstaged` is true, commits, then pushes
  (`apps/desktop/src/lib/domain/workspaces/creation/publish-workflow-steps.ts:98`).
- `resolvePublishDisabledReason` already blocks conflicted, detached, behind,
  missing message, and invalid PR states
  (`apps/desktop/src/lib/domain/workspaces/creation/publish-workflow-steps.ts:11`).
- The Publish dialog already has commit message UI and an Include unstaged switch
  (`apps/desktop/src/components/workspace/git/PublishDialog.tsx:162`).

Implication: extract or parameterize a branch-prep workflow from publish rather
than duplicating commit/push behavior inside mobility code.

### Desktop mobility already has the handoff stages but only a push recovery

- Desktop mobility currently supports only `"local_to_cloud"` and
  `"cloud_to_local"` in the app model
  (`apps/desktop/src/lib/domain/workspaces/mobility/types.ts:3`).
- `workspace_dirty` is already a known blocker
  (`apps/desktop/src/lib/domain/workspaces/mobility/types.ts:47`).
- Current dirty copy says "Commit or stash your changes, then try again" and
  only offers "Got it"
  (`apps/desktop/src/lib/domain/workspaces/mobility/presentation.ts:226`).
- Mobility prompt actions include confirm, GitHub auth, publish branch, push
  commits, and retry prepare, but no branch-prep action
  (`apps/desktop/src/lib/domain/workspaces/mobility/mobility-prompt.ts:30`).
- Footer prompt handling maps publish/push actions to `syncBranchForCloudMove`,
  which only pushes and reruns preparation
  (`apps/desktop/src/hooks/workspaces/mobility/use-workspace-mobility-footer-flow.ts:349`).
- `syncBranchForCloudMove` uses `usePushGitMutation` against the local workspace
  only and does not commit dirty work
  (`apps/desktop/src/hooks/workspaces/mobility/use-workspace-mobility-handoff-actions.ts:184`).
- Current mobility prompt state and branch sync are local-workspace biased; they
  do not yet bind Git status/stage/commit/push to the selected source runtime
  for cloud-to-local moves.
- Local-to-cloud preparation already ensures a mobility row, runs source
  AnyHarness preflight, runs cloud preflight, and stores a confirm snapshot
  (`apps/desktop/src/hooks/workspaces/mobility/use-local-to-cloud-handoff.ts:112`).
- Cloud-to-local preparation follows the same shape
  (`apps/desktop/src/hooks/workspaces/mobility/use-cloud-to-local-handoff.ts:115`).
- `WorkspaceMobilityUiStore` stores confirm snapshots and active prompt request
  ids, but not a pending Git-prep intent
  (`apps/desktop/src/stores/workspaces/workspace-mobility-ui-store.ts:4`).

Implication: add a source-neutral migration Git durability gate after
destination choice and before confirming handoff. `workspace_dirty` should be
treated as a soft Git-durability blocker when the source `GitStatusSnapshot` is
prepable, not as a terminal "try again later" blocker. Store only local
intent/draft/dialog state so prep can rerun preflight and continue
automatically without turning Zustand into a remote cache.

### Desktop can already target cloud AnyHarness for Git operations

- `resolveRuntimeTargetForWorkspace` maps synthetic cloud workspace ids to a
  cloud AnyHarness base URL and token
  (`apps/desktop/src/lib/access/anyharness/runtime-target.ts:57`).
- Claimed cloud workspaces can get a direct access token
  (`apps/desktop/src/lib/access/anyharness/runtime-target.ts:92`).

Implication: the same Git status, stage, commit, and push APIs can likely run
against a cloud source as long as the cloud runtime is ready and Git credentials
allow push. The implementation should verify this in real app testing because
cloud provisioning clones with a tokenized GitHub URL
(`server/proliferate/server/cloud/runtime/git_operations.py:29`).

If cloud-source Git status cannot resolve because the cloud runtime is not
ready, token access expired, or direct attach is unavailable, the migration UI
needs a first-class "cloud source not ready" recovery state rather than a thrown
query error.

### Server mobility and cloud startup have useful checks, but branch validation is asymmetric

- The current tree already has `canonical_side`, `cutover_committed`,
  `repair_required`, `cloud_workspace_move_cleanup_item`, itemized cleanup APIs,
  and a cleanup reconciler. The remaining work is hardening and connecting those
  contracts, not introducing cleanup from scratch
  (`server/proliferate/db/models/cloud/mobility.py:66`,
  `server/proliferate/db/models/cloud/mobility.py:119`,
  `server/proliferate/server/cloud/mobility/api.py:236`,
  `server/proliferate/server/cloud/mobility/reconciler.py:26`).
- Cloud mobility lifecycle has constants for future directions, but
  `VALID_HANDOFF_DIRECTIONS` currently includes only `local_to_cloud` and
  `cloud_to_local`
  (`server/proliferate/server/cloud/mobility/domain/lifecycle.py:18`).
- Cloud preflight checks GitHub branch existence and requested head mismatch only
  inside the local-to-cloud path
  (`server/proliferate/server/cloud/mobility/service.py:390`).
- `start_cloud_workspace_handoff` reruns cloud preflight before reserving the
  handoff and creates/starts a cloud workspace for local-to-cloud
  (`server/proliferate/server/cloud/mobility/service.py:474`,
  `server/proliferate/server/cloud/mobility/service.py:530`).
- Cloud mobility preflight still returns `blockers: list[str]`, and desktop
  normalizes several blockers by parsing human-readable messages
  (`server/proliferate/server/cloud/mobility/models.py:95`,
  `apps/desktop/src/lib/domain/workspaces/mobility/mobility-blockers.ts:65`).
- Cloud workspace creation already handles GitHub linked account, repo config
  bootstrapping, billing authorization, and repo limits
  (`server/proliferate/server/cloud/workspaces/service.py:1885`).
- Starting a cloud workspace validates the GitHub branch and billing before
  provisioning
  (`server/proliferate/server/cloud/workspaces/service.py:1997`).
- Cloud sandbox clone/checkout uses the requested base SHA when present and will
  fail late if the commit is not reachable from GitHub
  (`server/proliferate/server/cloud/runtime/git_operations.py:61`,
  `server/proliferate/server/cloud/runtime/git_operations.py:93`).
- `start_cloud_workspace_handoff` catches synchronous failures around scheduling
  a cloud workspace, but async provisioning failure currently surfaces through
  cloud workspace error state rather than a durable typed handoff failure.
- The desktop waiter currently reports a generic timeout if the cloud workspace
  never reaches ready
  (`apps/desktop/src/hooks/workspaces/mobility/use-cloud-workspace-readiness-waiter.ts:8`).

Implication: server preflight and start should stay strict, typed, and
idempotent. They should validate branch and requested head for every
GitHub-backed move that depends on GitHub, not only local-to-cloud, and they
should revalidate under the handoff lock before start. Errors from auth, access,
billing, provision, worker startup, runtime startup, direct access, and target
switching should become typed enough for the mobility UI to display helpful
recovery actions. Async provisioning failures need a reconciler path back to
`handoff_failed` or `repair_required`.

## Proposed UX

### Entry rule

No global dirty warning. The Git durability UI appears only after the user
chooses a migration target and the system inspects the selected source.

### Safe branch

Condition:

- Git operation is `none`.
- Not detached.
- Not conflicted.
- Clean worktree.
- `behind === 0`.
- Branch is published and GitHub head matches the source `HEAD` when the target
  depends on GitHub.
- Source and cloud/server preflights have no strict blockers.

Copy:

- Headline: "Ready to move"
- Body: "This branch is published and the destination can check out the same commit."
- Primary action: "Move to cloud" or "Bring back local"
- Secondary action: "Cancel"

Behavior: run the existing confirm path directly.

### Clean but unpublished or ahead

Condition:

- Clean worktree.
- No detached head, conflicts, or in-progress Git operation.
- Branch has no upstream or `ahead > 0`.
- `behind === 0`.

Copy:

- Headline: "Publish branch before moving"
- Body: "This branch has commits that only exist on this runtime."
- Helper: "Push it so the destination can check out the exact commit."
- Primary action: "Push and move"
- Secondary action: "Cancel"

Behavior:

1. Push the current branch with the existing Git push mutation.
2. Refetch Git status.
3. Rerun source AnyHarness preflight and cloud/server preflight.
4. If safe, continue the originally selected migration automatically.
5. If preflight now finds a different blocker, show that blocker instead of
   starting the handoff.

### Dirty worktree

Condition:

- Source has staged, unstaged, partial, deleted, renamed, or untracked changes.
- No conflicts, no in-progress merge/rebase/cherry-pick/revert, no detached head,
  and `behind === 0`.

Surface:

- Title: "Prepare branch for move"
- Body: "Commit and push these changes so the destination can check out the exact code."
- Commit message label: "Commit message"
- Generated default message: `Save workspace changes before move`
- Toggle label: "Include unstaged changes"
- Toggle default: on
- Primary action: "Commit, push, and move"
- Secondary action: "Open Git panel"
- Tertiary action: "Cancel"

Behavior:

1. Show staged/unstaged file summary using the existing publish file grouping
   model.
2. Let the user edit the commit message.
3. If "Include unstaged changes" is on, stage unstaged and partial paths, then
   commit. If it is off, commit the currently staged index only.
4. If "Include unstaged changes" is off and unstaged/partial changes would
   remain after the staged commit, disable "Commit, push, and move" and explain
   that the branch must be clean to move. Do not promise auto-move from a commit
   that will intentionally leave dirty work behind.
5. Push the resulting branch.
6. Refetch Git status.
7. Rerun the same migration preflight path for the original selected target.
8. If safe, continue automatically.

Important detail: after prep, the migration should use the new `HEAD` from the
rerun preflight, not the old pre-prep `baseCommitSha`.

`workspace_dirty` from AnyHarness source preflight is not, by itself, a hard
stop. If Git status says the source is prepable, the UI should route to this
surface. If Git status is loading or failed, show an inspection/retry state
instead of falling back to old "Commit or stash" copy.

The prep surface should be a real modal/dialog because it needs editable copy,
file review, and three actions. Opening it should close the migration popover.
During commit/push it should prevent duplicate submits and accidental close;
outside that in-flight window, cancel clears the local prep intent. "Open Git
panel" preserves no auto-continue promise unless the user reselects the move,
because the Git panel/terminal may change branch state in arbitrary ways.

### Behind or branch out of sync

Condition:

- `behind > 0`, push rejected, cloud head mismatch with no local ahead commits,
  or branch state cannot safely be reconciled by a push.

Copy:

- Headline: "Sync branch before moving"
- Body: "This branch is out of sync with GitHub."
- Helper: "Pull or rebase locally, then try again."
- Primary action: "Got it"
- Secondary action: "Cancel"

Behavior: do not auto-pull, auto-rebase, auto-merge, or stash. The current Git
panel is good for reviewing and staging changes, but it does not yet provide a
complete pull/rebase/conflict-recovery workflow. Implementation should either
add the missing recovery actions to the Git panel or route these cases to an
explicit terminal/external Git recovery surface. Do not pretend the existing
panel alone can fix behind, detached, rebase, or merge-conflict states. Until
that recovery surface exists, acknowledge the blocker and leave branch repair to
the user's local Git tools.

### Destination not at requested commit

Condition:

- The destination runtime exists but its repo `HEAD` is not the requested base
  SHA.
- The local repo has not fetched a cloud-pushed commit yet.
- An existing local branch would need destructive movement.

Copy:

- Headline: "Sync destination before moving"
- Body: "The destination cannot check out the exact commit yet."
- Helper: "Fetch or sync the branch, then try the move again."
- Primary action: "Open Git tools"
- Secondary action: "Cancel"

Behavior: validate destination Git state before freezing the source. For a cloud
destination, the action should be retry cloud prep/recheckout/rematerialize or
manage GitHub access, and it must complete before source freeze. For a local
destination, the action can fetch/open Git tools and fast-forward only under
safe conditions; otherwise block with this state.

### Strict blockers

These should remain blocking and should not be hidden behind Git prep:

- Active session running.
- Session awaiting interaction.
- Pending prompt.
- Setup still running.
- Runtime state is not normal.
- Workspace on default branch when a worktree is required.
- No branch name or detached HEAD.
- Git operation in progress.
- Merge conflicts.
- Archive too large.
- Partial subagent graph.
- Destination base commit mismatch.
- Another handoff in progress.
- Owner/canonical-side mismatch.
- Missing GitHub auth or repo access.
- Billing/start authorization failure.
- Agent auth/runtime config preflight failure.
- Cloud worker/runtime startup failure.
- Cloud workspace lost or target no longer reachable.

Unsupported sessions need a product decision before implementation. The current
AnyHarness behavior warns/skips unsupported sessions in some paths, while this
plan treats session loss as strict. For the reliable move flow, make unsupported
sessions a blocker unless the UI explicitly offers and records confirmation
that those sessions will not move.

## Proposed Data And State Model

### Add a derived migration Git durability state

Create a pure domain model under desktop mobility, for example:

`apps/desktop/src/lib/domain/workspaces/mobility/migration-git-durability.ts`

Inputs:

- `GitStatusSnapshot | null`
- source `WorkspaceMobilityPreflightResponse | null`
- cloud `WorkspaceMobilityCloudPreflightResponse | null`
- direction
- branch name and requested base SHA
- whether Git status has loaded

Outputs:

- `kind: "loading" | "safe" | "push_required" | "prepare_required" | "open_git_required" | "strict_blocked"`
- headline/body/helper/action labels
- commit draft defaults
- whether unstaged should default to included
- underlying blocker code if one exists
- selected source workspace id for Git mutations
- whether a source `workspace_dirty` blocker can be downgraded into
  `prepare_required`
- whether the destination needs Git safety work before source freeze

Reasoning: this belongs in `lib/domain/**` because it is product policy and
presentation metadata, not React behavior.

### Add local pending migration intent to UI state

Extend `WorkspaceMobilityUiStore` with short-lived client-only intent/draft
state keyed by logical workspace id:

- `logicalWorkspaceId`
- `direction`
- `sourceWorkspaceId`
- selected destination id
- prompt request id
- dialog open/closed state
- branch-prep commit message draft
- include-unstaged draft
- in-flight operation id for duplicate-submit prevention
- optional pre-prep branch/head only for telemetry/debug display, not as a
  source of truth

The intent exists so "Commit, push, and move" and "Push and move" can rerun
preflight and continue the exact move the user selected. Opening dirty prep is
an explicit transition that closes the popover while preserving the prep intent.
The intent should be cleared on cancel, ordinary popover close without opening
prep, target change, workspace selection change, owner/canonical-side flip,
"Open Git tools", successful handoff start, or any hard failure where continuing
would surprise the user.

Do not store `mobilityWorkspaceId`, source/cloud preflight responses, or cloud
workspace details as authoritative state in Zustand. Resolve/refetch those
through access hooks and workflow hooks each time continuation runs.
Any stored confirm snapshot should be treated as a preview/UI model only.
`confirmMove` should operate on a just-refetched snapshot from the workflow call
path before `startHandoff`.

### Use Git status for UI, but require AnyHarness export guards

Initial implementation should use the existing `useGitStatusQuery` for the
source workspace because it already returns rich branch/change data and works
through the runtime-target resolver for local and cloud synthetic ids.

This is not sufficient as the final correctness guard. Add required fields to
`ExportWorkspaceMobilityArchiveRequest`:

- `expectedHandoffOpId`
- `expectedBaseCommitSha`
- `expectedBranchName`
- `requireCleanGitState`

When `requireCleanGitState` is true, the AnyHarness mobility domain must reject
export unless runtime state is `FrozenForHandoff` for the same
`expectedHandoffOpId`. It must also reject if `HEAD` or branch differs from the
expected values, a Git operation is in progress, conflicts exist, or the
worktree is dirty. In this mode, the archive's `files` and `deletedPaths` should
be empty except for explicitly documented non-Git runtime artifacts. This closes
the race where a user or agent edits files after frontend prep but before
export.

Avoid adding Cloud DB persistence for dirty/ahead UI state. It is runtime-local,
short-lived, and must be recomputed immediately before handoff and again inside
AnyHarness export.

### Add durable handoff snapshots and typed blockers

Server handoff rows should durably record the source and destination facts used
for the move instead of relying on mutable mobility-row fields or phase payloads:

- source and destination owner
- source and destination cloud workspace ids where applicable
- source and destination AnyHarness workspace ids where applicable
- source and destination branch names
- source head SHA validated for the move
- requested destination base SHA
- executor/client id and idempotency key
- handoff/provision attempt id for correlating async destination startup
  failures to the correct move
- lease/heartbeat metadata used for stale repair

`cloud_workspace_mobility.cloud_workspace_id` should stay aligned with the
canonical side and flip only during finalized cutover.

Cloud preflight blockers should become typed objects, aligned with AnyHarness
blockers:

- `code`
- `message`
- `source`
- `retryAction`
- optional structured detail

Desktop UI branching should consume these codes instead of parsing strings.

## Implementation Plan

### Phase 0: Runtime and control-plane safety contracts

This should land before the UI starts auto-continuing moves.

Likely files:

- `anyharness/crates/anyharness-contract/src/v1/mobility.rs`
- `anyharness/crates/anyharness-lib/src/domains/mobility/service.rs`
- `anyharness/crates/anyharness-lib/src/domains/mobility/workspace_delta.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/resolver.rs`
- `anyharness/crates/anyharness-lib/src/workspaces/runtime.rs`
- `server/proliferate/server/cloud/mobility/models.py`
- `server/proliferate/server/cloud/mobility/service.py`
- `server/proliferate/server/cloud/mobility/domain/lifecycle.py`
- `server/proliferate/db/models/cloud/mobility.py`
- `server/proliferate/db/store/cloud_mobility.py`
- Cloud SDK generated files if API schema changes require regeneration

Plan:

- Add `expectedBaseCommitSha`, `expectedBranchName`, `expectedHandoffOpId`, and
  `requireCleanGitState` to AnyHarness export. Reject export when runtime state
  is not `FrozenForHandoff` for the expected op, or when source branch, `HEAD`,
  cleanliness, conflict state, or Git operation no longer matches the prepared
  snapshot.
- Keep install's destination base-SHA equality check. Add destination preflight
  helpers so local destinations can fetch the requested SHA, verify reachability,
  confirm clean/no-conflict/no-operation state, and refuse destructive branch
  movement before `prepare-destination`.
- Validate destination runtime `HEAD` before source freeze. Existing ready cloud
  workspaces must either recheckout/rematerialize the requested SHA or fail
  before the source is frozen.
- For GitHub-backed migration starts, require a full non-empty
  `requestedBaseSha`; do not allow start/preflight to proceed with a missing,
  short, or malformed source SHA.
- Move `remote_owned` assignment to after Cloud finalize/cutover, or add an
  explicit repair path that restores `normal` if Desktop dies while Cloud still
  says canonical side is source.
- Add typed Cloud mobility blockers and typed handoff failure codes before UI
  branching depends on them.
- Add start/finalize/cleanup idempotency keys and clarify DB uniqueness for one
  active handoff per mobility workspace and the intended per-user active-handoff
  scope.
- Store durable source/destination handoff snapshots and keep the mobility row's
  `cloud_workspace_id` aligned with `canonical_side`.
- Add a reconciler path from async destination provisioning error to handoff
  `handoff_failed` or `repair_required`. Carry a durable handoff/provision
  attempt id through scheduling/provisioning so an unrelated later workspace
  error cannot fail the wrong move.
- Preserve and redact failure causes: GitHub link missing, repo access revoked,
  branch deleted, commit unreachable, billing hold/payment/admin denial, agent
  credentials missing, runtime config not ready, worker startup timeout, direct
  access unavailable, and tokenized clone/push failures.
- Make cleanup item ownership explicit: server executes server-owned items;
  Desktop reports AnyHarness source cleanup; manual repair requires actor,
  reason, and audit fields.

### Phase 1: Shared branch-prep product/workflow extraction

Likely files:

- `apps/desktop/src/lib/domain/workspaces/creation/publish-workflow-steps.ts`
- `apps/desktop/src/lib/domain/workspaces/creation/publish-file-groups.ts`
- `apps/desktop/src/lib/workflows/workspaces/run-workspace-publish-workflow.ts`
- new `apps/desktop/src/lib/domain/workspaces/git/branch-prep-workflow*.ts` or
  migration-local equivalent if the extraction is narrower
- new `apps/desktop/src/lib/workflows/workspaces/run-branch-prep-workflow.ts`

Plan:

- Extract the commit/push-neutral pieces from publish into a branch-prep domain
  model that can power both PublishDialog and migration prep.
- Keep PR-specific logic in the publish domain.
- Add migration defaults:
  - `includeUnstaged: true`
  - default commit message `Save workspace changes before move`
  - push required after commit
- Keep disabled reasons for conflicts, detached head, behind, Git operation in
  progress, and empty commit message.
- Push to the remote that backs the mobility workspace's GitHub owner/repo.
  Surface a typed remote-mismatch blocker when the local branch remote does not
  match the mobility workspace.

### Phase 2: Desktop mobility Git durability gate

Likely files:

- new `apps/desktop/src/lib/domain/workspaces/mobility/migration-git-durability.ts`
- `apps/desktop/src/lib/domain/workspaces/mobility/types.ts`
- `apps/desktop/src/lib/domain/workspaces/mobility/presentation.ts`
- `apps/desktop/src/lib/domain/workspaces/mobility/mobility-prompt.ts`
- `apps/desktop/src/lib/domain/workspaces/mobility/mobility-warnings.ts`
- `apps/desktop/src/hooks/workspaces/mobility/use-workspace-mobility-state.ts`
- `apps/desktop/src/hooks/workspaces/mobility/use-workspace-mobility-handoff-actions.ts`
- `apps/desktop/src/hooks/workspaces/mobility/use-workspace-mobility-footer-flow.ts`
- `apps/desktop/src/stores/workspaces/workspace-mobility-ui-store.ts`
- `apps/desktop/src/components/workspace/chat/input/WorkspaceMobilityLocationPopover.tsx`
- a new component under the existing workspace/chat surface, for example
  `apps/desktop/src/components/workspace/chat/input/PrepareBranchForMoveDialog.tsx`

Plan:

- Add prompt action kinds for `prepare_branch_for_move`, `commit_push_and_move`,
  `open_git_tools`, and keep `push_commits` as "Push and move".
- Query Git status for the selected source workspace after a migration target is
  selected. For local-to-cloud, source is the local workspace id. For
  cloud-to-local, source is the cloud materialization synthetic id.
- Derive the Git durability state from source Git status plus mobility
  preflights.
- Replace the dirty blocker copy with the branch-prep surface instead of "Commit
  or stash".
- Remove dirty-archive copy such as "Uncommitted changes will move with the
  workspace" from mobility prompt and warning tests.
- Make "Push and move" use the existing push mutation, then rerun preparation and
  auto-confirm only when preflight is safe.
- Make "Commit, push, and move" run branch prep, refetch status, rerun
  preparation, and auto-confirm only when safe.
- Make dirty prep's "Open Git panel" open the existing working-tree review
  surface for inspection/staging. For behind/rebase/conflict/detached recovery,
  either add real Git recovery actions or route to terminal/external Git tools.
- Use source-neutral actions such as `syncBranchForMove(sourceWorkspaceId)` and
  `prepareBranchForMove(sourceWorkspaceId)`, not local-only
  `syncBranchForCloudMove`.
- Add explicit cloud-source states for cloud runtime not ready, direct token
  expired, repo credential missing, and push rejected.
- Keep dirty cloud-to-local prep feature-gated or hidden until Phase 5 proves
  cloud-source commit/push works reliably.
- Ensure `requestId` and logical workspace id guards still prevent stale async
  work from moving a different workspace after a target switch.
- Prevent duplicate submit/double click while commit/push/preflight continuation
  is running.

### Phase 3: Handoff guardrails and rerun semantics

Likely files:

- `apps/desktop/src/hooks/workspaces/mobility/use-local-to-cloud-handoff.ts`
- `apps/desktop/src/hooks/workspaces/mobility/use-cloud-to-local-handoff.ts`
- `apps/desktop/src/hooks/workspaces/mobility/use-workspace-mobility-handoff-actions.ts`

Plan:

- Split "prepare selected migration" from "confirm selected migration" so Git
  prep can call:
  1. prep branch,
  2. rerun source preflight,
  3. rerun cloud preflight,
  4. confirm using the fresh snapshot.
- Add a final source Git status/preflight guard immediately before start/freeze
  every time, not only when the snapshot seems stale. Require clean Git state,
  no operation, no conflicts, `headOid === sourcePreflight.baseCommitSha`, and
  matching source/destination/request id before calling `startHandoff`.
- Ensure the confirm snapshot's `baseCommitSha` always comes from the fresh
  preflight after prep.
- Pass the fresh `baseCommitSha` into AnyHarness export as
  `expectedBaseCommitSha` with `expectedHandoffOpId` and
  `requireCleanGitState: true`.
- Validate destination runtime `HEAD`, cleanliness, conflicts, and Git operation
  state before source freeze and before install.
- On prep failure, leave the workspace unfrozen and handoff unstarted.
- On push success but subsequent cloud preflight failure, show the new blocker
  and keep the committed/pushed branch as normal Git history.
- After cutover, verify selected workspace/session now point at the destination
  runtime before re-enabling the composer.

### Phase 4: Server and AnyHarness preflight hardening

Likely files:

- `anyharness/crates/anyharness-contract/src/v1/mobility.rs`
- `anyharness/crates/anyharness-lib/src/domains/mobility/service.rs`
- `server/proliferate/server/cloud/mobility/service.py`
- `server/proliferate/server/cloud/mobility/domain/lifecycle.py`
- `server/proliferate/server/cloud/workspaces/service.py`
- `server/proliferate/server/cloud/runtime/git_operations.py`
- Cloud SDK generated files if API schema changes require regeneration

Plan:

- Keep AnyHarness preflight strict for runtime/session/setup/archive blockers.
- Keep the UI Git status query for rich display, but rely on the Phase 0 export
  guard as the authoritative final source check.
- Change AnyHarness dirty policy so dirty source workspaces are surfaced
  consistently. Frontend can downgrade a prepable `workspace_dirty` blocker into
  the branch-prep UI; non-prepable dirty/unknown states remain blockers.
- Keep archive export/install base-SHA validation unchanged.
- Extend Cloud mobility preflight branch/head validation to every GitHub-backed
  direction that needs a target to check out `requestedBaseSha`, not just
  local-to-cloud.
- Replace string cloud preflight blockers with typed blocker codes. This is
  required before UI branching, not a best-effort cleanup.
- Preserve owner and active-handoff checks on `start_cloud_workspace_handoff`.
- Improve cloud startup failure surfaces:
  - GitHub link missing.
  - GitHub repo access missing.
  - branch missing.
  - requested commit missing/not reachable.
  - billing denied.
  - agent auth/runtime config not ready.
  - provision task failed.
  - worker heartbeat/runtime startup timeout.
  - target direct access unavailable.
- Reconcile existing ready cloud workspaces whose `HEAD` is stale relative to
  the requested SHA before freezing source: recheckout/rematerialize or fail
  early.
- Reusing an existing ready cloud destination must still revalidate connection
  health, billing/start policy, agent-auth/runtime-config policy, repo access,
  and exact requested SHA before source freeze.
- Tighten cleanup and repair semantics around item leases, retry counts,
  stale `in_progress`, manual resolution, and source/destination canonical copy.

### Phase 5: Cloud source push verification

Likely areas:

- cloud provisioning Git remote setup
- cloud AnyHarness direct access
- AnyHarness Git push mutation against cloud synthetic ids

Plan:

- Treat this as a blocking prerequisite for cloud-to-local dirty support.
- Verify that a cloud sandbox cloned with the tokenized GitHub URL can push
  through the existing AnyHarness Git push endpoint.
- If not, add an explicit cloud runtime Git credential setup step or a server
  mediated credential refresh for Git push from cloud runtime.
- Ensure token material is not exposed in UI, logs, screenshots, or error text.
- Ensure push errors become user-safe messages.

### Phase 6: Post-move runnable-state verification

Likely files:

- `apps/desktop/src/lib/workflows/sessions/session-runtime.ts`
- `apps/desktop/src/hooks/sessions/lifecycle/use-session-intent-dispatcher.ts`
- `apps/desktop/src/lib/access/cloud/session-commands.ts`
- `apps/desktop/src/hooks/chat/derived/use-chat-availability-state.ts`
- transcript/session selection stores and mobility cache hooks

Plan:

- Define move success as "the user can keep working," not just "cutover
  completed."
- Treat this as a release gate for enabling the move flow, not late hardening.
- After local-to-cloud and cloud-to-local, verify transcript renders, active
  workspace/session selection points at the destination, composer availability
  resolves against the destination runtime, a new prompt is accepted, agent
  execution starts, and transcript updates stream/project.
- Include web/mobile Cloud-command send after local-to-cloud because the cloud
  side must be commandable after migration.
- Surface MCP/agent-auth reconnection prompts as normal destination capability
  state rather than confusing migration failures.

## Reuse Plan

Reuse from Git publish:

- Git status query and mutation hooks.
- File grouping and partial-staging warnings.
- Stage, commit, and push workflow ordering.
- Disabled reasons for detached, conflicted, behind, and missing message.
- Existing PublishDialog controls where possible, but with migration copy and
  defaults.

Reuse from mobility:

- Destination picker and selected target state.
- Source preflight and cloud preflight calls.
- Confirm snapshot display shape, but not as authoritative remote state. Fresh
  snapshots should be built in the workflow call path before handoff start.
- Existing handoff phase updates: start, source freeze, destination ready,
  export, install, cutover, cleanup.
- Existing latency logging style.
- Existing GitHub sign-in and repo access recovery actions.
- Existing cleanup and repair states after cutover.

Reuse, but harden:

- Existing source freeze/export/install/finalize sequencing. Move
  `remote_owned` later or repair it when canonical side remains source.
- Existing cleanup APIs. Prefer itemized cleanup status and retries instead of
  hiding everything behind a single complete-cleanup action.
- Existing cloud readiness polling. It should fail fast on known `error` states
  and preserve typed startup/provisioning causes, not only time out.

Do not reuse:

- `autosave_cowork_workspace` as-is for user migration prep.
- Snapshot/fork/stash flows as default move recovery.
- Message-string parsing as the long-term source of cloud blocker identity.
- Destructive local branch reset behavior as the cloud-to-local destination
  prep default.

## Tests To Add

### Desktop domain tests

Add tests for the new migration Git durability resolver:

- safe clean published branch -> `safe`
- clean ahead branch -> `push_required`
- clean no-upstream branch -> `push_required`
- dirty unstaged branch -> `prepare_required` with include unstaged default on
- dirty staged-only branch -> `prepare_required`
- dirty plus behind -> `open_git_required`
- conflicted -> `strict_blocked`
- detached -> `strict_blocked`
- merge/rebase/cherry-pick/revert operation -> `strict_blocked`
- GitHub head mismatch plus ahead -> `push_required`
- GitHub head mismatch plus no ahead -> `open_git_required`
- `workspace_dirty` source preflight plus prepable dirty Git status ->
  `prepare_required`
- source preflight strict blocker beats Git prep
- cloud auth/access blocker maps to GitHub recovery action
- Git status loading/error does not show stale commit/push actions
- destination `HEAD` mismatch -> destination sync/recovery state

### Desktop workflow and hook tests

- Branch prep builds stage, commit, push in the right order.
- Migration prep defaults `includeUnstaged` to true.
- Turning include unstaged off commits only the staged index, and auto-move is
  disabled when unstaged/partial changes would remain dirty afterward.
- After prep success, status is refetched and migration preparation reruns.
- Auto-confirm uses the fresh confirm snapshot.
- Commit failure does not push or start handoff.
- Push failure does not start handoff.
- Request id/workspace change cancels stale continuation.
- "Open Git panel" opens the existing Git panel without starting migration.
- Edited commit message is not overwritten by Git status refetch.
- Cancel, target switch, owner flip, and workspace selection change clear local
  prep intent.
- Double-clicking "Commit, push, and move" cannot run two commits or two
  handoffs.
- Cloud-source runtime not ready, direct token expired, and cloud push rejected
  produce recoverable states.
- Final guard rejects a new dirty edit after branch prep and before handoff
  start.
- Existing ready cloud destination with stale `HEAD` blocks before source
  freeze.

### AnyHarness tests

- Mobility preflight reports dirty source work consistently for local and cloud
  source workspaces.
- Export with `requireCleanGitState` rejects when `HEAD`, branch, cleanliness,
  conflicts, or Git operation differ from expected values.
- Export with `expectedHandoffOpId` rejects when runtime state is not
  `FrozenForHandoff` for that op.
- Export in Git-durable mode does not include file/deleted deltas from dirty
  worktree state.
- Export/install still rejects destination base mismatch.
- Install/pre-install guard rejects dirty destination, conflicts, or in-progress
  Git operations before applying an archive.
- Cloud-to-local destination prep fetches requested SHA before worktree create.
- Existing local branch divergence refuses destructive reset.
- Existing local branch dirty in another worktree refuses migration prep.
- Stale `frozen_for_handoff` and `remote_owned` before cutover can be repaired
  or restored to `normal`.
- Git status contract remains accurate for ahead/no-upstream/dirty cases.
- Commit and push errors remain typed and user-safe.

### Server tests

- Cloud mobility preflight validates GitHub branch/head for cloud-to-local where
  the requested base SHA must be reachable on GitHub; local destination fetch
  reachability stays in AnyHarness/Desktop destination prep tests.
- Branch moves after preflight but before start is rejected under the handoff
  lock.
- `start_cloud_workspace_handoff` still reruns preflight and rejects on blockers.
- Duplicate start/finalize/cleanup calls with the same idempotency key return
  the same durable result; conflicting keys are rejected.
- GitHub link missing maps to a typed blocker.
- Repo access missing maps to a typed blocker.
- Branch missing maps to a typed blocker.
- Requested head mismatch maps to a typed blocker.
- Billing hold, payment/admin denial, and quota failures preserve distinct
  typed reasons.
- Async provision/startup failures are recorded on the handoff with actionable
  failure codes.
- Existing ready cloud workspace behind requested SHA is rechecked out or blocks
  before source freeze.
- Cleanup lease expiry, retry count, stale `in_progress`, and manual repair
  audit are covered.
- Server does not auto-complete Desktop-owned AnyHarness cleanup items.
- Tokenized Git clone/push failures redact tokens from logs and user errors.
- Typed blocker compatibility is generated into the Cloud SDK and consumed by
  Desktop without message parsing.

### Failure-injection matrix

Add deterministic tests at the owning layer:

- Domain unit: dirty/prepable, behind, detached, unsupported session,
  destination mismatch, typed blocker mapping.
- Desktop workflow mock: commit succeeds then push rejected, preflight changes
  after push, source freeze fails, export rejects because new dirty edit
  appeared, finalize fails after install, token expiration during cloud Git/API
  access.
- AnyHarness fake repo: missing fetched SHA, divergent existing branch,
  protected branch/worktree, export clean guard, install base mismatch.
- Server service: branch moved after preflight, async provisioning enters
  `error`, stale handoff heartbeat before and after cutover, cleanup item retry
  and manual repair.
- Full manual profile: one happy path and one injected failure per direction.

### End-to-end/manual app flows

Run against a real local dev profile and GitHub-backed repo:

Setup:

```bash
make dev-init PROFILE=mobility-git
make dev PROFILE=mobility-git
```

Use `CLOUD_WORKER_TUNNEL=ngrok` or `AGENT_GATEWAY_TUNNEL=ngrok` when managed
cloud sandboxes need to reach local worker callbacks. Use a disposable GitHub
repo with two branches and at least two local worktrees so push rejection,
branch divergence, and existing-worktree cases can be exercised without risking
real work. Remember that OAuth/deep-link login is effectively
single-profile-at-a-time.

1. Local clean/published branch -> move to cloud direct.
2. Local clean/ahead branch -> "Push and move" -> cloud checks out pushed SHA.
3. Local dirty unstaged changes -> "Prepare branch for move" -> edit message ->
   "Commit, push, and move" -> cloud starts at new commit.
4. Local staged plus unstaged partial changes -> include unstaged on/off behaves
   as previewed.
5. Local behind branch -> "Got it"; no automatic pull/rebase.
6. Cloud sandbox dirty changes -> commit/push from cloud -> bring back local at
   pushed commit.
7. Missing GitHub auth -> connect GitHub -> rerun preflight.
8. Missing repo access -> manage access -> rerun preflight.
9. Cloud provisioning timeout or failure -> actionable failure; source remains
   unfrozen if failure occurs before handoff start/freeze.
10. Failure after prep but before move -> branch remains committed/pushed; retry
    starts from fresh preflight.
11. Failure after cutover -> cleanup/repair UI, no rollback of canonical side.
12. Existing ready cloud workspace with stale `HEAD` -> blocks/rematerializes
    before source freeze.
13. After local-to-cloud, Desktop transcript renders, web/mobile can send a
    Cloud-command prompt, agent execution starts, and transcript projection
    updates.
14. After cloud-to-local, Desktop selected workspace/session point at the local
    destination, the composer is enabled only against the destination runtime,
    a new prompt is accepted, and transcript streaming works.
15. Browser/GitHub auth loops: no logged-in GitHub session, expired app grant,
    revoked repo access, private org SSO required, user grants access then
    retries preflight, user closes browser midway.
16. Git LFS or large binary repo -> push/clone/export errors remain typed and
    user-safe.

## Edge Cases And Failure Modes

- User edits files while the prep dialog is open: rerun Git status immediately
  before commit, and surface changed disabled reasons if state changed. Also
  rely on AnyHarness export's clean guard to reject edits that happen after
  commit/push but before export.
- User changes migration target while prep is running: request id guard cancels
  continuation.
- Commit succeeds but push fails: show push error; do not start handoff.
- Push succeeds but cloud preflight fails: show new blocker; do not start
  handoff.
- Push rejected due to remote updates: show "Sync branch before moving"; do not
  auto-pull or rebase.
- Branch has no upstream: push with upstream setup, then rerun preflight.
- Remote mismatch: push only to the GitHub remote backing the mobility
  workspace; otherwise block with "remote mismatch" recovery.
- Detached head: require user to switch/create a branch in a real Git recovery
  surface.
- Merge conflict or rebase in progress: require a real Git recovery surface,
  not just the current staging-only panel.
- Empty commit message: disable "Commit, push, and move".
- Nothing staged with include unstaged off: disable commit and explain that
  staged changes are required.
- LFS or large binary changes: rely on Git push errors and archive size checks;
  do not silently snapshot.
- Cloud runtime not ready when trying cloud-source Git prep: offer retry/start
  recovery, but do not lose the selected migration intent.
- Cloud runtime can commit but not push due to credentials: show repo access
  recovery, and add credential refresh if verified as a platform gap.
- Requested commit is not reachable on GitHub after push: preflight should catch
  before cloud provisioning/checkout.
- Existing ready cloud workspace at stale `HEAD`: validate before source freeze,
  then recheckout/rematerialize or block.
- Local destination has not fetched a cloud-pushed SHA: fetch and verify
  reachability before worktree creation.
- Existing local branch would be reset: refuse destructive movement unless it is
  an explicit safe fast-forward.
- Server accepts handoff, then cloud provisioning fails: handoff should record a
  typed failure code and leave user with a retryable explanation.
- Desktop dies after source freeze but before cutover: server repair should
  restore source runtime to normal when canonical side remains source.
- Desktop dies after cutover but before cleanup: destination remains canonical;
  cleanup items are retryable.
- Worker/runtime startup succeeds slowly: progress copy should say what is being
  waited on; timeout should identify cloud workspace startup, not generic move
  failure.
- Target switching after cutover but before cleanup: canonical side remains
  destination; cleanup is retryable and cannot roll back the move.
- Unsupported sessions exist: block unless the product adds an explicit
  session-loss confirmation.
- Tokenized remote leaks in logs/errors: redact and consider resetting the
  remote URL after clone if the token would otherwise persist in repo config.

## Observability

Add structured events and logs that make stranding diagnosable without exposing
secrets:

- `git_durability_resolved`
- `branch_prep_started`
- `branch_prep_succeeded`
- `branch_prep_failed`
- `push_rejected`
- `source_final_guard_failed`
- `destination_head_validated`
- `destination_head_mismatch`
- `handoff_start_idempotent_replay`
- `cloud_provision_failed_for_handoff`
- `cutover_after_finalize_failed`
- `cleanup_item_failed`
- `post_move_prompt_smoke_result`

Include direction, logical workspace id, mobility workspace id, handoff op id,
source/destination workspace ids, source/destination `HEAD`, branch, blocker
code, phase, runtime generation, and sanitized error code/message. Do not log
tokenized Git remotes, OAuth tokens, commit patch contents, or raw command
stderr without redaction.

## What Should Remain Strict

AnyHarness should remain strict about:

- Runtime state must be `Normal` before start/freeze and final source guard.
- Export must run only while runtime state is `FrozenForHandoff` for the
  expected handoff op.
- Setup cannot be running.
- Sessions cannot be active or waiting on required interaction.
- Pending prompts should not be left behind.
- Unsupported agents or partial subagent graphs cannot move unless product adds
  an explicit, audited session-loss confirmation.
- Archive size limits.
- Export in Git-durable mode must match expected branch and base commit and must
  be clean.
- Destination install base commit must match archive base commit.
- Local destination branch preparation must not silently reset or move branches.
- No silent auto-stash, auto-merge, auto-rebase, snapshot, or fork as part of
  the normal move path.

Server should remain strict about:

- User ownership and authorization.
- Valid direction and current owner/canonical side.
- Single active handoff per mobility workspace and the intended per-user
  active-handoff policy, backed by DB constraints and idempotency keys.
- GitHub account and repo access for GitHub-backed moves.
- Full source `requestedBaseSha`, branch existence, requested commit reachability
  on GitHub, and start-time branch/head revalidation under the handoff lock.
- Billing and sandbox start authorization.
- Agent auth and runtime config preflight.
- Worker/runtime startup state.
- Async provisioning failure reconciliation to handoff failure/repair.
- Cutover ordering, cleanup item durability, cleanup item ownership, and manual
  repair audit.

## Open Decisions / Risks

- AnyHarness preflight `gitState`: UI still composes separate Git status plus
  mobility preflight. Export is the correctness mechanism because it requires
  expected handoff, branch, base commit, and clean Git state.
- Cloud-source Git push: still needs a real cloud runtime verification loop. If
  tokenized cloud clones cannot push reliably, choose between cloud runtime
  credential refresh and a server-mediated credential setup endpoint before
  relying on dirty cloud-to-local prep in production.
- Push remote ownership: push now prefers the configured upstream remote, but no
  final guard verifies that the remote URL matches the mobility workspace's
  GitHub owner/repo when a branch has no upstream. Add canonical remote
  validation before treating this as fully closed.
- Async cloud provisioning failure linkage: desktop polling can surface failed
  destination provisioning while the UI is open, and stale handoff expiry handles
  abandoned attempts, but the server provision task does not yet carry a
  handoff op id all the way into failure reconciliation.
- Existing cloud destination at stale `HEAD`: source freeze is still guarded
  until destination readiness succeeds, so this should fail safe, but a ready
  cloud workspace reused for a newer requested SHA can still fall into
  provision-error recovery instead of automatically rematerializing a clean idle
  destination. Follow-up should add an explicit safe rematerialize/recheckout
  path or a typed "sync destination" blocker.
- `remote_owned` timing: source runtime ownership is still flipped immediately
  before server finalize/cutover. The client now treats post-`remote_owned`
  finalize errors as ambiguous and refuses to restore the source unless Cloud
  confirms cutover did not happen. Follow-up should still make the
  transition/finalize pair server-idempotent with operation-id repair for both
  directions.
- Cleanup/repair UI: cleanup failures are visible through existing lifecycle
  status/toasts, but there is no itemized footer recovery action yet.
- Review/reviewer state: active review runs are blocked instead of migrated.
  Completed review durable rows are not copied as first-class review state.
- Handoff concurrency: recommended V1 rule is one active handoff per mobility
  workspace, plus whatever per-user singleton policy the current store already
  intends. Make both explicit and database-backed before relying on UI guards.
- Git recovery surface: current Git panel is not enough for pull/rebase/conflict
  recovery. Either add those actions or route users to terminal/external Git
  tools for behind/detached/in-progress-operation cases.
- Push failure recovery: compact "Push and move" and dirty prep surface raw push
  errors today. Strict rerun-preflight/export guards keep migration safe, but a
  richer follow-up should classify push rejected/auth/repo-access failures into
  first-class recovery copy and actions.
- Unsupported sessions: recommended V1 behavior is to block. If product wants to
  allow partial migration, add explicit session-loss confirmation and audit.
- Default commit message: `Save workspace changes before move` is safe. Adding
  workspace or branch name is acceptable only if it stays short and editable.
- Compact popover vs dialog: keep "Push and move" in the compact popover because
  it is low-friction; dirty prep should open a dialog because it needs review,
  editable commit copy, and three actions.

## Recommended Delivery Slices

1. Land AnyHarness export clean guards, destination Git safety, and runtime-state
   ordering repair tests.
2. Land Cloud typed blockers, start-time branch/head revalidation, idempotency,
   durable handoff snapshots, and async provisioning-to-handoff reconciliation.
3. Add pure migration Git durability resolver and tests.
4. Extract/reuse branch-prep workflow with migration defaults and tests.
5. Wire Desktop mobility UI for "Push and move" and "Prepare branch for move",
   including source-neutral cloud-to-local Git prep states.
6. Add rerun-preflight-and-auto-continue semantics with final guards and
   duplicate-submit locks.
7. Verify cloud-source commit/push and add credential support if needed before
   enabling dirty cloud-to-local prep.
8. Add itemized cleanup/repair UI and post-move runnable-state verification.
9. Run the full local-to-cloud and cloud-to-local manual runbook in
   `PROFILE=mobility-git`.
