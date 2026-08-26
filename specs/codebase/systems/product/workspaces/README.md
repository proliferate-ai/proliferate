# Workspace Surface

Everything around the chat column: the shell (sidebar, header tabs, right
panel), the files sidebar and viewer, terminals, git review and publish,
repo setup / workspace creation, and the session-selection contract that
decides which chat the shell shows. A **client composition surface**: it
owns layout and selection state, and consumes the runtime's workspace,
file, terminal, git, and session contracts. The focused documents below are
its sections.

| Section | Document |
| --- | --- |
| Files sidebar, viewer, diffs, changes | [files.md](files.md) |
| Terminal pane and the creation grid | [terminals.md](terminals.md) |
| Which session anchors an open workspace; the visible-tab invariant | [session-selection.md](session-selection.md) |
| Pending workspace entry and projected session shell | [pending-shell.md](pending-shell.md) |
| Cloud workspace experience (target; client surfaces culled) | [cloud-workspace.md](cloud-workspace.md) |
| Product migration absence + runtime mobility boundary | [migration.md](migration.md) |
| Sidebar row activation, held-key switching, loading hero | [../ux-latency-transitions.md](../ux-latency-transitions.md) |

## Purpose

Give a person one place per repository to work: open a workspace, see and
switch its sessions, browse and edit its files, run terminals, review and
publish its git changes, and create the next workspace — with the runtime as
the only authority on what exists on disk.

## Owned state

UI and selection state only; the runtime owns workspaces, worktrees, files,
terminals, and git.

| Store | Holds | Code |
| --- | --- | --- |
| Editor | Open viewer tabs, file buffers, file tree expansion, git panel UI | [stores/editor/](../../../../../apps/packages/product-client/src/stores/editor/workspace-editor-state.ts) |
| Terminal | Terminal records per workspace, active terminal, viewport state | [terminal-store.ts](../../../../../apps/packages/product-client/src/stores/terminal/terminal-store.ts) |
| Search | In-workspace content search state | [content-search-store.ts](../../../../../apps/packages/product-client/src/stores/search/content-search-store.ts) |
| Workspace UI preferences | Sidebar, right panel, pins, chat-tab visibility, git-status observations, dismissals — persisted per user | [workspace-ui-store.ts](../../../../../apps/packages/product-client/src/stores/preferences/workspace-ui-store.ts) |
| Selection | Selected session per workspace, directory of known sessions | [session-selection-store.ts](../../../../../apps/packages/product-client/src/stores/sessions/session-selection-store.ts), [session-directory-store.ts](../../../../../apps/packages/product-client/src/stores/sessions/session-directory-store.ts) |
| Shell transients | Archive visibility, sidebar switch cursor, "show more", new-workspace command scope, add-repo flow | [stores/workspaces/](../../../../../apps/packages/product-client/src/stores/workspaces/workspace-archive-visibility-store.ts), [add-repo-flow-store.ts](../../../../../apps/packages/product-client/src/stores/ui/add-repo-flow-store.ts) |

## Public surface

- [`MainScreen`](../../../../../apps/packages/product-client/src/components/workspace/shell/screen/MainScreen.tsx)
  and [`StandardWorkspaceShell`](../../../../../apps/packages/product-client/src/components/workspace/shell/screen/StandardWorkspaceShell.tsx)
  — the authenticated product's main route body
  ([MainPage.tsx](../../../../../apps/packages/product-client/src/pages/MainPage.tsx)).
- [`MainSidebarPageShell`](../../../../../apps/packages/product-client/src/components/workspace/shell/screen/MainSidebarPageShell.tsx)
  — the sidebar-bearing page frame other routes (workflows, workspaces list)
  mount inside.
- Open-target fulfilment: chat, command palette, and git rows ask this
  surface to open a file, diff, or terminal through
  [use-workspace-file-actions.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/facade/files/use-workspace-file-actions.ts)
  and the right-panel controller
  ([use-right-panel-controller.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/facade/use-right-panel-controller.ts)).
- Workspace entry: the Home screen and app commands create or open
  workspaces only through
  [use-workspace-entry-flow.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/workflows/use-workspace-entry-flow.ts)
  (which routes creation through the managed
  [workspace-provisioning](../../../platforms/product/workspace-provisioning.md) path).

## Consumes

All from the runtime through `@anyharness/sdk-react` unless noted; raw
clients only under
[lib/access/anyharness/](../../../../../apps/packages/product-client/src/lib/access/anyharness/workspaces.ts):

| Runtime contract | Used for | Hooks |
| --- | --- | --- |
| `workspaces`, `worktrees`, `repoRoots` | inventory, create/open/archive/purge, worktree settings, repo-root detection and materialization | `useWorkspaceSessionsQuery`, `useRepoRootsQuery`, `useMaterializeRepoRootMutation`, `useMaterializeWorkspaceAtRefMutation`, `useDetectRepoRootSetupQuery`, `useRerunSetupMutation` |
| `files` (+ [workspace-file-transport.ts](../../../../../apps/packages/product-client/src/lib/access/anyharness/workspace-file-transport.ts)) | tree, stat, read/write, search | `useWorkspaceFilesQuery`, `useStatWorkspaceFileQuery`, `useReadWorkspaceFileQuery`, `useSearchWorkspaceFilesQuery` |
| `terminals` | create/close/resize/run, streams | `useTerminalsQuery`, [use-terminal-stream-controller.ts](../../../../../apps/packages/product-client/src/hooks/terminals/lifecycle/use-terminal-stream-controller.ts) |
| git ([git-diff-patches.ts](../../../../../apps/packages/product-client/src/lib/access/anyharness/git-diff-patches.ts), `pullRequests`, `reviews`) | status, diffs, stage, revert, publish, PR status | `useGitStatusQuery`, `useGitDiffQuery`, `useStageGitPathsMutation`, `useRevertGitPatchesMutation`, `useCurrentPullRequestQuery` |
| `sessions` (selection only) | session list per workspace, dismiss/restore, title | `useWorkspaceSessionsQuery`, `useDismissSessionMutation` |
| `runtime` health | runtime pressure indicator, readiness gates | `useRuntimeHealthQuery` |
| Desktop bridge (host, not runtime) | native context menus, open-in-editor, file drop, paths | [desktop-bridge.ts](../../../../../apps/packages/product-client/src/host/desktop-bridge.ts) |
| Cloud (`@proliferate/cloud-sdk`) | GitHub App state and PR identity, workspace display names, cloud repo branches | [use-github-app-state-invalidation.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/cache/use-github-app-state-invalidation.ts), [use-workspace-display-name-actions.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/workflows/use-workspace-display-name-actions.ts) |

The cloud-workspace client paths under `hooks/cloud/` and
`domain/workspaces/cloud-work-*` still compile against
`@proliferate/cloud-sdk/client/workspaces` and `cloud-sandboxes`. They are
gated dark in production and are deleted by the dark-cloud cull's second
half (`delivery/cull-sweep/delivery-spec-delete-dark-cloud.md`, part 2,
pending); [cloud-workspace.md](cloud-workspace.md) is the target contract
that outlives them.

## Laws

- **One visible session per open workspace.** Opening resolves exactly one
  session; a remembered valid session wins, else prompted-then-recent
  ordering; an unused session is still valid
  ([session-selection.md](session-selection.md),
  [run-workspace-selection.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/workflows/selection/run-workspace-selection.ts)).
- **Creation goes through provisioning, never a component.** Every new
  workspace — Home, sidebar, command palette, add-repo — calls the entry flow,
  which uses the managed provisioning path and the pending shell to remap
  to durable ids ([pending-shell.md](pending-shell.md),
  [use-pending-workspace-session-materialization.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/workflows/use-pending-workspace-session-materialization.ts)).
- **The runtime is the file authority.** Buffers are local copies; a write
  the runtime rejects keeps the person's edits and marks the buffer
  `conflict` (runtime `VERSION_MISMATCH`) or `error`, never silently
  overwriting either side
  ([use-workspace-file-buffer-actions.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/workflows/files/use-workspace-file-buffer-actions.ts));
  the tree never fabricates entries.
- **Terminals are records first.** A terminal exists when the runtime says
  so; the store mirrors runtime records and the viewport attaches to a
  stream ([terminal-record-workflows.ts](../../../../../apps/packages/product-client/src/lib/workflows/terminals/terminal-record-workflows.ts)).
- **Publish is a workflow with a receipt.** Branch/PR publication runs the
  publish workflow and shows the runtime's result; it never assumes success
  ([run-workspace-publish-workflow.ts](../../../../../apps/packages/product-client/src/lib/workflows/workspaces/run-workspace-publish-workflow.ts)).
- **Persisted UI state is per user and never authoritative for existence.**
  Pins, tab visibility, and dismissals in the workspace-ui store are
  reconciled against runtime inventory on load
  ([use-workspace-pin-intent-reconciliation.ts](../../../../../apps/packages/product-client/src/hooks/sessions/lifecycle/use-workspace-pin-intent-reconciliation.ts)).

## Emits

- Active session identity (context) to chat; open-target fulfilment results.
- Workspace activity acknowledgement and sidebar activity indicators
  ([use-workspace-activity-acknowledgement.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/lifecycle/use-workspace-activity-acknowledgement.ts)).
- Toasts for repo added, archive settlement, publish results.
- Latency marks for workspace switch and shell activation
  ([workspace-shell-activation-measurement.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/workflows/tabs/workspace-shell-activation-measurement.ts)).

## Fences

- **Chat** owns the transcript and composer inside the content column
  ([../chat/README.md](../chat/README.md)).
- **Agents** owns the subagent hierarchy the header tabs display
  ([../agents/delegated-work.md](../agents/delegated-work.md)).
- **Settings** owns repository configuration, worktree storage, and
  environment panes — the sidebar links there
  ([../settings/README.md](../settings/README.md)).
- **Runs triage** (target) owns background work, goals, and loops; the
  right-panel Background pane and activity rosters are its migration source
  ([../runs-triage/README.md](../runs-triage/README.md)).
- **Workspace provisioning** (platform) owns creation semantics; this surface
  is a caller ([workspace-provisioning.md](../../../platforms/product/workspace-provisioning.md)).
- **AnyHarness** owns worktrees, files, terminals, git, and the runtime
  mobility boundary ([anyharness/README.md](../../../../anyharness/README.md),
  [migration.md](migration.md)).
- Layer law and frozen directory edges as in
  [frontend/README.md](../../../../frontend/README.md#what-goes-where) and
  [FE-FENCE-001](../../../../../lints/frontend/fences.toml).

## Code map

```text
apps/packages/product-client/src/
├── lib/access/anyharness/
│   ├── workspaces.ts · worktrees.ts · resolve-workspace-connection.ts   inventory + connection
│   ├── workspace-file-transport.ts · git-diff-patches.ts                 files + git transport
│   ├── terminals.ts · pull-requests.ts · reviews.ts
├── domain/workspaces/ · domain/repos/ · domain/environments/            PURE inventory/readiness models
├── lib/domain/workspaces/{cloud,tabs,sidebar,creation,selection}/        connected-client rules
├── lib/workflows/workspaces/ · lib/workflows/terminals/                  non-React sequences
├── stores/{editor,terminal,search,workspaces}/ · stores/preferences/workspace-ui-*
├── hooks/workspaces/
│   ├── cache/        collections, archived, PR statuses, selection cache
│   ├── derived/      sidebar/status/git-panel/right-panel view models
│   ├── workflows/    entry flow, selection, tabs, files, publish, archive, add-repo
│   ├── lifecycle/    persistence, metadata sync, reconcilers, prefetch
│   ├── ui/           tabs drag/layout, right-panel focus, native menus, shell geometry
│   └── facade/       header tabs, right panel, command palette
├── hooks/terminals/ · hooks/editor/
├── components/workspace/
│   ├── shell/        screen/ (MainScreen, StandardWorkspaceShell) · sidebar/ · topbar/ · tabs/ · right-panel/ · command-palette/
│   ├── files/        tree/ · viewer/ · editor
│   ├── terminals/    TerminalPanel · TerminalViewport · TerminalTopBar
│   ├── git/          GitPanel review + PublishDialog
│   ├── repo-setup/   AddRepoFlow, cloud repo picker, inventory + reconciliation
│   ├── open-target/ · pane/ · scratch/ · search/ · file-references/
└── pages/MainPage.tsx · pages/WorkspacesPage.tsx
```

Target moves (later sweep wave): `components/workspace/shell` +
`hooks/workspaces` → `systems/workspace/`; the sessions stores/hooks split
out into a `sessions` client system shared with chat; cloud-work domain
files die with the dark-cloud cull part 2.

## Proof

- Unit: `hooks/workspaces/workflows` (25), `lib/domain/workspaces/cloud` (28),
  `lib/domain/workspaces/tabs` (19), `lib/domain/workspaces/sidebar` (14),
  `lib/domain/workspaces/creation` (12), `components/workspace/shell/sidebar`
  (12), `lib/domain/files` (8) test files; the home launch flow (local +
  cloud) is pinned by
  [HomeNextScreen.test.tsx](../../../../../apps/packages/product-client/src/components/home/screen/HomeNextScreen.test.tsx).
  `pnpm --filter @proliferate/product-client test`.
- Rendered: the file-viewer qualification lane
  (`test:file-viewer`, Playwright against a real renderer).
- Typecheck and structure checkers as for [chat](../chat/README.md#proof);
  the primitives closure and Radix containment in
  [check_frontend_boundaries.py](../../../../../scripts/check_frontend_boundaries.py).
- Manual: workspace, files, terminal, and git rows of
  [manual-release-qa.md](../../../../TESTING/manual-release-qa.md).

## Known gaps / follow-ups

- [terminals.md](terminals.md) and [files.md](files.md) still cite
  `apps/desktop/src/components/...` paths from before the ProductClient move;
  the code lives under `apps/packages/product-client/src/components/workspace/`.
  Re-anchor when those documents next change.
- The cloud-work inventory domain (`domain/workspaces/cloud-work-*`,
  `inventory-cloud.ts`) is dark and scheduled for deletion; until part 2 of
  the dark-cloud cull lands it is dead weight in the Mobile-safe domain tier.
- `repo-setup/` mixes local add-repo with the culled cloud repo picker
  (`CloudRepoPicker`, `CloudRepoActionDialogHost`); the split follows the
  same deletion.
