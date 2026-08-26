# Cloud Workspace

Status: target. This document describes the accepted destination for the
end-to-end cloud workspace experience: what the user sees and does from
create to delete. The body is written in the ideal state. Every difference
from `main` today is listed in [Current gaps](#current-gaps).

## Cloud surfaces culled on the desktop client (PRO-10), backend dormant

Every user-facing cloud-workspace surface on the desktop client (`apps/desktop`
and `apps/packages/product-client`) is removed or host-gated to web. The backend
provisioning machinery, the shared runtime providers, and the local/cloud
reconciliation bridge stay in place but dormant: no desktop surface reaches
them, so the journeys below describe the destination and the still-live web
surface, not what the desktop client presents today.

- Existing `cloud_workspace` rows and cloud-only repos are filtered out of every
  client list at a single data-source seam, so legacy state never resurrects a
  surface.
- Cloud deep links resolve to a neutral not-found state.
- Cloud-target automations the user authored stay listed, badged "target no
  longer available"; the picker no longer offers a fresh cloud target.
- Web keeps its cloud affordances, gated by the host capability.

## Purpose

This is the system document that stitches the cloud-sandbox platform specs
into one user journey. It owns the screens, copy, and flow decisions; every
mechanism it mentions is some platform's contract, consumed by link:

- The box (states, wake, provisioning engine, webhooks, orphan reaping):
  [lifecycle.md](../../../../FEATURE_DOCS/SANDBOX/lifecycle.md).
- What is in the box (clones, worktrees, identity, disk, the two workspace
  records): [content.md](../../../../FEATURE_DOCS/SANDBOX/content.md).
- The wire: [gateway.md](../../../../FEATURE_DOCS/SANDBOX/gateway.md).
- The caller contract (gating layers, ensure→resolve choreography):
  [access.md](../../../../FEATURE_DOCS/SANDBOX/access.md).
- Create-request choreography (validation, row transactions, branch retry):
  `workspace-provisioning.md` (deleted, cull part 2).
- The composer panel stack is [composer.md](../chat/composer.md)'s anatomy;
  this document names which panels appear when, never how panels work.

## Create

Entry points: the sidebar's new-workspace actions and the repo-setup
dialogs ([MainSidebar.tsx](../../../../../apps/packages/product-client/src/components/workspace/shell/sidebar/MainSidebar.tsx),
[AddRepoFlowHost.tsx](../../../../../apps/packages/product-client/src/components/workspace/repo-setup/AddRepoFlowHost.tsx)).
All converge on one flow
(`use-create-cloud-workspace.ts`):

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

## The status takeover

One surface owns every not-usable-yet state: the blocked-status composer
takeover (`useComposerBlockedState`, rendering rules per
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
a second) — so there is no "waking" screen, only the ordinary
runtime-connecting takeover line in the composer.

## Archive, delete, unarchive

- Archive, unarchive, and delete are Cloud row-lifecycle writes surfaced in
  the sidebar. They do not archive, purge, rename, or delete the AnyHarness
  workspace or its checkout. Archived rows show "Archived chats are available
  in Settings."
- Delete removes the workspace from the Cloud product. Deleting the *sandbox*
  (settings-level action) never deletes workspace rows — workspaces are marked
  lost and render as such (content spec, "When the VM dies").
- All three clear cached gateway connections and collections entries
  (`use-cloud-workspace-actions.ts`).

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
4. Disk pressure crosses the threshold: the status card offers the runtime
   worktree list; the user explicitly purges two stale AnyHarness workspaces
   and frees the space.
5. The user archives the Cloud workspace; weeks later deletes its product
   row. Those row operations do not mutate the AnyHarness checkout, branch,
   or PR history.

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
    └── chat/input/
        ├── EnvironmentStatusCard.tsx        resources card (worktrees, CPU/mem/disk)
        └── RuntimePressureDetailsDialog.tsx worktrees dialog + delete confirmation
```

## Current gaps

Deltas between this document and `main`, each struck by its follow-up PR:

- [ ] The threshold notification is unbuilt: the status card shows the
      cloud CPU/Memory/Disk rows, but nothing watches the disk axis for
      the pressure threshold or surfaces "your cloud machine is running
      low on space — here are your worktrees"
      ([EnvironmentStatusCard.tsx](../../../../../apps/packages/product-client/src/components/workspace/chat/input/EnvironmentStatusCard.tsx)).
      Build the client-side threshold trigger and copy, pointing into the
      existing worktrees dialog and its delete actions (pull-plus-
      threshold only — founder ruling, content spec).
