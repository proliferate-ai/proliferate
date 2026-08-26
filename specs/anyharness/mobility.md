# Mobility

> Ownership: this document is the depth reference for the **workspaces** system spec ([README.md](../codebase/systems/runtime/workspaces/README.md)). Laws, owned state, fences and the checked code map are authoritative there; flow-level detail stays here.

`anyharness-lib/src/domains/mobility/**`,
`anyharness-lib/src/api/http/mobility.rs`, and the repo-root mobility helpers
own target-local workspace safety, clean archive export, exact destination
preparation, install, and source destruction. They do not own product
orchestration or cross-runtime authority.

## Product Boundary

AnyHarness can move runnable workspace/session data only when an external
orchestrator supplies the handoff id, exact base commit, destination, and
source-destruction authority. The runtime cannot choose a destination, persist
a durable product cutover, recover an interrupted cross-runtime move, or prove
that another runtime is canonical.

## Preflight

Source preflight requires a workspace that exists, is a Git workspace, and is
in `normal` runtime mode. Movement is blocked by detached HEAD, unresolved
default branch for a local workspace, source on the default branch, in-progress
Git operation, conflicts, dirty state, setup in progress, active review,
starting/running session, pending interaction, or pending prompt.

Only Claude and Codex session bundles are supported. An unsupported session or
partial linked-session/subagent graph blocks the archive. Active terminals are
warnings during preflight; source destruction force-closes them later. Archive
size is estimated only after other blockers clear. The transport cap is 128 MiB
and an individual file, attachment, or artifact cap is 16 MiB.

Runtime state is target-local access control:

```text
normal
frozen_for_handoff(handoff_op_id)
remote_owned
repair_blocked
```

`frozen_for_handoff` and `remote_owned` prevent ordinary mutations/live starts
through the access gate. HTTP export requires the exact frozen handoff id.
Source destruction requires `remote_owned`.

## Clean Export And Install

HTTP export requires `requireCleanGitState=true` plus non-empty
`expectedHandoffOpId`, `expectedBaseCommitSha`, and `expectedBranchName`.
Export rechecks the frozen state, branch, `HEAD`, Git operation, conflicts,
cleanliness, and runtime state before returning.

Although the archive schema still has `files` and `deletedPaths`, current HTTP
export rejects a dirty source and requires those Git deltas to be empty. It
does not transport uncommitted work.

The archive carries supported durable session records, live-config snapshot,
pending config changes/prompts and attachments, transcript events, native agent
artifacts, and the complete included session-link graph. Raw provider
notifications are included only behind their existing environment gate.
Subagent links carry the optional `subagentClosedAt` operability marker; older
archives without that field import the relationship as Open.
New archives carry each session's authoritative pending-prompt sequence cursor.
Install restores the maximum of that cursor and every archived queue identity,
including pending rows, scalar and reordered queue events, completion
projections, and delivery-held active or retired prompts. Older archives without
the cursor field use the same durable identities as a conservative fallback, so
an empty imported queue cannot reuse an identity that a later event may target.
The authoritative cursor and every fallback identity must remain below
`i64::MAX`. That ceiling is reserved as non-allocatable so cursor increments
cannot overflow SQLite integer storage; the greatest accepted identity is a
clean exhausted state rather than a value the allocator increments again.
Install rejects cross-session events and event columns whose type disagrees with
their payload tag before writing session state.

Pending and enqueued subagent-completion deliveries, plus delivered rows with
an unacknowledged completion-wake removal intent, are archived by parent
session id independently of whether the child or relationship still exists.
Their stable delivery and retired queue identities survive install, while
in-flight worker leases do not. A destination worker therefore finishes a
removal that was interrupted before export. An executable retired-wake intent
must match the state produced by completed-wake retirement: paired retired
identity fields on a delivered successful completion, cleared active prompt and
turn references, the delivery's canonical prompt id, and no active parent queue
row at the retired sequence. Older archives without delivery, retired-queue, or
prompt-provenance fields import with empty/default values.

Export clears workspace-local MCP binding ciphertext but may retain binding
summaries. Installation clears both ciphertext and summaries, resets imported
policy, and inherits the destination workspace's bindings. Imported sessions
clear native session id so a later run establishes destination-native state.

Install requires a mutable, clean destination at the archive's exact base
commit with no setup, destination sessions, or active terminals. Archive paths
and linked-session graph are validated before writes. A non-empty install
`operationId` makes a completed install replay return its recorded summary
instead of applying the archive again.

Same-runtime session IDs may be relocated only when the existing session
belongs to the archive source by id/path and that source is frozen or
remote-owned. Unrelated duplicate IDs remain conflicts.

## Destination Preparation

Repo-root preparation creates or reuses a standard worktree under
`<runtime-home>/mobility/destinations/<repo-root-id>/` for one requested branch
and exact requested commit.

With an explicit destination id, it may return the matching active worktree or
adopt the matching on-disk worktree. Without one, it may reuse an existing
managed mobility destination. Reuse or adoption requires the requested branch,
exact resolved `HEAD`, a clean worktree, no destination sessions or active
terminals, and no retired workspace with incomplete cleanup owning that path.

Destination creation may best-effort fetch the requested origin branch and,
when an existing local branch differs, clean-check its worktrees and
fast-forward that branch to the exact requested ref. If creation made a new
local branch and an origin exists, branch publication is also best effort.
Wrong branch or commit fails reuse/adoption; dirty state, an occupied
destination, or unsafe path ownership fails closed. The helper does not reset,
merge, rebase, stash, or provide interactive recovery.

## Source Destruction

`destroy-source` requires `remote_owned`. It closes active terminals, deletes
source sessions and native agent artifacts, deletes checkpoint refs and rows,
then destroys the old workspace materialization and workspace row. The caller
holds one exclusive workspace lease across that sequence. Checkpoint cleanup
must finish while the workspace row still identifies its repository root; a
cleanup failure aborts before materialization destruction so a moved source
cannot strand private refs that no later sweep can attribute. The residual
runtime has no cross-runtime proof that another destination is canonical; a
future orchestrator must establish that authority before marking a source
remote-owned.
