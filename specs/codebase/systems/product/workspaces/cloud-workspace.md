# Cloud Workspace

Status: target. This document describes the accepted destination for the
end-to-end cloud workspace experience: what the user sees and does from
create to delete. The body is written in the ideal state. Every difference
from `main` today is listed in [Current gaps](#current-gaps).

## Purpose

This is the system document that stitches the cloud-sandbox platform specs
into one user journey. It owns the screens, copy, and flow decisions; every
mechanism it mentions is some platform's contract, consumed by link:

- The box (states, wake, provisioning engine, webhooks, orphan reaping):
  [sandbox-lifecycle.md](../../../platforms/product/sandbox-lifecycle.md).
- What is in the box (clones, worktrees, identity, disk, the two workspace
  records): [sandbox-content.md](../../../platforms/product/sandbox-content.md).
- The wire: [sandbox-gateway.md](../../../platforms/product/sandbox-gateway.md).
- The caller contract (gating layers, ensure→resolve choreography):
  [sandbox-access.md](../../../platforms/product/sandbox-access.md).
- Create-request choreography (validation, row transactions, branch retry):
  [workspace-provisioning.md](../../../platforms/product/workspace-provisioning.md).
- The composer panel stack is [composer.md](../chat/composer.md)'s anatomy;
  this document names which panels appear when, never how panels work.

## Create

Entry points: the sidebar's new-workspace actions and the repo-setup
dialogs ([MainSidebar.tsx](../../../../../apps/packages/product-client/src/components/workspace/shell/sidebar/MainSidebar.tsx),
[AddRepoFlowHost.tsx](../../../../../apps/packages/product-client/src/components/workspace/repo-setup/AddRepoFlowHost.tsx)).
All converge on one flow
([use-create-cloud-workspace.ts](../../../../../apps/packages/product-client/src/hooks/cloud/workflows/use-create-cloud-workspace.ts)):

1. **The workspace appears before the network answers.** A pending entry
   seeds the sidebar (stage `submitting`) before the create request is
   sent — this is the product face of the optimistic `cloud_workspace` row
   (content spec, "One workspace, two records"): the row commits first, so
   the product can show the workspace tied to its target immediately.
2. Branch-name conflicts retry silently (3 attempts, server-generated
   names); the user never sees a naming collision.
3. If the response is already `ready`, the user enters chat directly. If
   it is still `pending`/`materializing`, the workspace opens onto the
   status panel (below) at stage `awaiting-cloud-ready` and auto-advances
   when materialization completes. A prompt typed while waiting is queued:
   "Queued prompt will send when this cloud workspace is ready."
4. Hard failure fails the pending entry with a specific message; the row
   survives and renders in the error state with a retry action.

## The status panel

One panel owns every not-usable-yet state:
`WorkspaceArrivalCloudPanel`, a composer-attached panel (stack position per
[composer.md](../chat/composer.md)), driven by one model builder
([cloud-workspace-status-presentation.ts](../../../../../apps/packages/product-client/src/lib/domain/workspaces/cloud/cloud-workspace-status-presentation.ts))
over one gate
([cloud-workspace-status.ts](../../../../../apps/packages/product-client/src/lib/domain/workspaces/cloud/cloud-workspace-status.ts)).
Five modes, exhaustive:

| Mode | When | Copy and affordance |
| --- | --- | --- |
| pending | `pending` / `materializing` | Steps: Queued → Preparing runtime → Ready; auto-refresh footer; spinner |
| blocked | subject-layer billing block | Title by reason ("Sandbox limit reached" / "Cloud usage is paused"); reason-specific description; no retry button — the block clears server-side |
| error | `error` | "Provisioning failed" + the receipt (`lastError`); "Retry provisioning" action; "The workspace record is kept and we will retry setup from there." |
| lost | `lost` | "Workspace lost"; explains that the sandbox was killed and the workspace contents are gone; delete action |
| archived | `archived` | "This cloud workspace has been archived."; status footer only |

Post-ready transitions ("Applying tracked files N/M", "Starting cloud
setup") reuse the pending mode with their own titles. The blocked mode's
trigger is the access spec's subject layer — the typed 402 and its reason —
not a workspace-row field; the seven reason strings and their copy live in
the presentation module and nowhere else.

Reconnect is not a mode: opening a workspace whose VM is paused just
works — the first gateway call wakes it (access spec choreography, roughly
a second) — so there is no "waking" screen, only the ordinary connecting
affordance of `CloudRuntimeAttachedPanel`.

## Archive, delete, unarchive

- Archive and unarchive are row-lifecycle writes surfaced in the sidebar;
  archived rows show "Archived chats are available in Settings." Archiving
  pairs with a worktree retire on the sandbox (content spec's paired
  reclaim); the branch and pushed work are untouched.
- Delete removes the workspace from the product and retires its worktree.
  The confirmation states what survives: git commits, branches, pull
  requests. Deleting the *sandbox* (settings-level action) never deletes
  workspace rows — workspaces are marked lost and render as such (content
  spec, "When the VM dies").
- All three clear cached gateway connections and collections entries
  ([use-cloud-workspace-actions.ts](../../../../../apps/packages/product-client/src/hooks/cloud/workflows/use-cloud-workspace-actions.ts)).

## Resources: the disk story's product end

The composer environment status card
([EnvironmentStatusCard.tsx](../../../../../apps/packages/product-client/src/components/workspace/chat/input/EnvironmentStatusCard.tsx))
is the one resource surface, for local and cloud targets alike:

- A worktrees row (count, total size, hover list with per-worktree size and
  git state) opening the worktrees dialog
  ([RuntimePressureDetailsDialog.tsx](../../../../../apps/packages/product-client/src/components/workspace/chat/input/RuntimePressureDetailsDialog.tsx))
  with its delete actions — the delete confirmation names what is kept.
- For cloud targets: CPU, Memory, and Disk rows from the runtime's
  resource-pressure axes (content spec owns the measurement; this card is
  the consumer).
- **The threshold notification**: when the disk axis crosses its pressure
  threshold, the client surfaces "your cloud machine is running low on
  space — here are your worktrees" pointing into the same dialog and its
  delete actions. Client-side pull-plus-threshold only; no email, no
  background job (founder ruling, content spec).

## A workspace's life, worked

1. Create from the sidebar: entry appears instantly; panel shows Queued →
   Preparing runtime; the queued prompt fires on ready.
2. Days of work; the VM pauses at idle. Reopening wakes it under the first
   request — no screen for this.
3. Credits run out mid-week: the panel shows the blocked mode with the
   exact reason; nothing is lost, nothing retries client-side.
4. Disk pressure crosses the threshold: the status card offers the
   worktree list; the user deletes two stale workspaces — each delete
   retires its worktree and frees the space.
5. The user archives the workspace; weeks later deletes it. The branch and
   PR history remain on GitHub; the confirmation said exactly that.

## Code map

```text
apps/packages/product-client/src/
├── hooks/cloud/workflows/
│   ├── use-create-cloud-workspace.ts        create flow, optimistic pending entry
│   └── use-cloud-workspace-actions.ts       archive/delete/unarchive + cache clears
├── lib/domain/workspaces/cloud/
│   ├── cloud-workspace-status.ts            the status gate
│   └── cloud-workspace-status-presentation.ts   the five modes, all copy
└── components/workspace/
    ├── chat/panels/WorkspaceArrivalCloudPanel.tsx   the status panel
    └── chat/input/
        ├── EnvironmentStatusCard.tsx        resources card (worktrees, CPU/mem/disk)
        └── RuntimePressureDetailsDialog.tsx worktrees dialog + delete confirmation
```

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] No Disk row and no threshold notification: the card shows CPU/Memory
      only for cloud targets, and no surface is proactive — pull-only.
      Lands with the disk axis
      ([sandbox-content.md](../../../platforms/product/sandbox-content.md)
      gap).
