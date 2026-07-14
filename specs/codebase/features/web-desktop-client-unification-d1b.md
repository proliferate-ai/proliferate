# Desktop Native UI Adoption (D1b)

Status: **current implementation scope**.

- Revision: `D1b-r2`
- Approved starting scope: 2026-07-13
- Exact implementation base:
  `28cf310c913ff677b1ed87d01dc1eeda8006bb60`
- Prior implementation: PR #1157, reviewed head
  `90926523c3662067e02f8511db6c8e0058e119f1`, merge
  `a76ab5911e2af39593b4b31530535f0811a3558b`
- Parent architecture:
  [`web-desktop-client-unification.md`](web-desktop-client-unification.md)
- Prior completed contract:
  [`web-desktop-client-unification-d1a.md`](web-desktop-client-unification-d1a.md)
- Pipeline ledger:
  [`../../developing/deploying/web-desktop-unification-rollout.md`](../../developing/deploying/web-desktop-unification-rollout.md)

This is the current implementation contract for Desktop Native UI Adoption
only. The founder and implementation agent may update it together when code
evidence requires a material adjustment; record that decision before
broadening the slice.

## 1. Observable outcome

Every product-owned use of Desktop native UI in this slice reaches the
existing concrete `DesktopBridge.nativeUi` through the mounted `ProductHost`:

- native context menus;
- commands delivered from the native application menu;
- Dock/workspace attention;
- Desktop WebView zoom; and
- the already-adopted running-agent count export.

All product source remains under `apps/desktop`. Desktop and Web are not
cut over to ProductClient in this slice.

When `host.desktop` is `null`, no Desktop-native listener or lifecycle mounts.
Browser keyboard shortcuts, document appearance, and DOM context-menu
fallbacks remain available because they are shared product behavior.

## 2. Founder-approved boundary

The founder approved these decisions:

1. This slice adopts only `DesktopBridge.nativeUi`. Every other bridge and
   ProductHost group remains later work.
2. Existing menu content, accelerators, callbacks, positioning, and visible
   fallback behavior remain unchanged.
3. Browser keyboard handling remains shared. Only native menu-command
   subscription moves behind `host.desktop`.
4. Document theme, font, window-zoom CSS tokens, and system-color-mode
   behavior remain shared. Only native WebView zoom moves behind
   `host.desktop`.
5. Workspace activity calculation remains product-owned. Only its Dock export
   is Desktop-gated.
6. Product menu builders adopt ProductClient's `NativeMenuItem`,
   `NativeMenuIcon`, and `MenuPosition` types without redesigning menus.
7. `MacWindowControlsSafeArea` and raw native window setup remain Desktop-host
   bootstrap behavior.
8. Browser-only Desktop development keeps the real non-null Desktop bridge.
   When native menus are unavailable, the first attempt returns `false`,
   redispatches one DOM context-menu event in the next microtask, and disables
   later native attempts for that hook instance. This slice adds no
   availability capability and does not make the Desktop bridge nullable
   outside Tauri.

## 3. Non-goals

This slice does not:

- move product pages, routes, components, hooks, stores, providers, or logic
  into ProductClient;
- change Web, CSS, assets, or visual design;
- adopt the files, runtime, credentials, updater, worker, SSH, scratch, or
  diagnostics bridge groups;
- change ProductHost auth, links, storage, clipboard, telemetry, deployment,
  or cache behavior;
- change shortcut mappings, menu contents, Dock semantics, appearance
  settings, or error UX;
- move raw Tauri bootstrap, Mac window chrome, dev-handoff transport, or local
  AnyHarness startup;
- add a native-menu availability method or another host/bridge abstraction;
  or
- perform unrelated correctness or hardening work.

## 4. Reconciliation record

Reconciliation against the prior accepted implementation is **Yellow** with
targeted specification edits only. No architecture decision was reopened.

At the exact implementation base:

- `apps/desktop/src/providers/DesktopProductHostProvider.tsx` supplies the
  module-constant `desktopBridge` through the real ProductHost;
- `apps/desktop/src/providers/DesktopProductLifecycleRoot.tsx` already gates
  running-agent export on `host.desktop`;
- `apps/desktop/src/lib/access/tauri/desktop-bridge.ts` exposes stable thin
  `nativeUi` adapters for `showContextMenu`, `subscribeMenuCommands`,
  `setRunningAgentCount`, `setWorkspaceActivity`, and `setZoom`;
- the native menu-command adapter already exposes a race-safe synchronous
  unsubscribe over the underlying asynchronous Tauri registration;
- host replacement with the same bridge is already tested not to duplicate
  running-agent work; and
- removing the bridge/unmounting is already tested to clean the existing
  lifecycle subscription.

The commits after PR #1157's merge and through the exact base change only
testing or migration authority; they do not alter the relevant product,
provider, bridge, or native-UI code.

No ProductClient contract change is required.

## 5. Current and target ownership

### 5.1 Current

```text
AppRuntime
  -> useShortcutDispatcher
       -> browser keyboard listener
       -> Tauri menu-event access hook
  -> useAppearancePreferenceLifecycle
       -> document theme/font/system-mode behavior
       -> raw Tauri WebView zoom
  -> WorkspaceActivityIndicatorMount
       -> product activity calculation
       -> Tauri Dock access hook
  -> DesktopProductLifecycleRoot
       -> running-agent count export only

Product context-menu hooks
  -> raw Tauri context-menu module
```

### 5.2 Target

```text
AppRuntime keeps shared behavior
  -> browser keyboard listener
  -> document theme/font/system-mode lifecycle

DesktopProductLifecycleRoot reads host.desktop
  -> null: mount no native behavior
  -> bridge: mount one Desktop native-UI lifecycle group
       -> running-agent count export
       -> native menu-command subscription
       -> Dock/workspace attention export
       -> Desktop WebView zoom export

Product context-menu hooks
  -> useProductHost()
  -> host.desktop?.nativeUi.showContextMenu(...)
  -> existing DOM fallback when native UI is absent or returns false
```

This extends the existing lifecycle root. It does not create a second root.

## 6. Context-menu adoption

`useNativeContextMenu` and `useNativeMenu` stop importing raw Tauri
context-menu access. They read `host.desktop?.nativeUi` and call
`showContextMenu`.

The behavior is exact:

- `desktop === null`, an already-disabled hook instance, or no menu items:
  leave the original browser event untouched;
- a native menu is shown: preserve the current capture interception;
- the first native `false`: disable native attempts for that hook instance,
  redispatch one equivalent DOM `contextmenu` event in the next microtask, and
  do not recursively intercept the redispatched event;
- later events on the disabled hook instance: fall through untouched without
  rebuilding items or calling the bridge;
- the imperative `useNativeMenu` path uses the same disabled-instance state;
  and
- item construction remains lazy so transient closure state is preserved.

The nine product menu-builder hooks change only their type imports. The raw
Tauri menu implementation remains Desktop-owned behind `desktopBridge`.

## 7. Menu-command and keyboard ownership

`useShortcutDispatcher` becomes browser-keyboard-only and remains mounted in
`AppRuntime`.

A separate Desktop lifecycle receives
`desktop.nativeUi.subscribeMenuCommands` and mounts only inside
`DesktopProductLifecycleRoot`. It must:

- ignore values that fail `isShortcutId`;
- call `runShortcutHandler(id, { source: "menu" })` for valid ids;
- emit `SHORTCUT_REVEAL_RESET_EVENT` only when the handler consumes the
  command; and
- synchronously unsubscribe on bridge removal or unmount.

Product code must not add a second async-listener race mechanism. The concrete
Desktop adapter owns late native registration.

The single-consumer `hooks/access/tauri/use-menu-events.ts` wrapper is deleted.

## 8. Dock/workspace attention

`useWorkspaceActivityIndicator` receives
`DesktopNativeUiBridge["setWorkspaceActivity"]` as a dependency instead of
reading a Tauri hook.

It preserves:

- workspace/session hydration gates;
- activity and attention calculation;
- successful-payload deduplication across remounts;
- the pending-call signature;
- retry only after a later relevant state change following failure; and
- the existing before/after boot-diagnostic milestones.

Unmount does not promise cancellation of an already-issued native promise and
does not force the same successful payload to re-export after remount.

`WorkspaceActivityIndicatorMount` is removed from `App.tsx`; the lifecycle
mounts inside `DesktopProductLifecycleRoot`. The single-consumer
`hooks/access/tauri/dock/use-dock-actions.ts` wrapper is deleted.

## 9. Shared appearance and Desktop zoom

`useAppearancePreferenceLifecycle` retains document theme/font tokens,
window-zoom dataset/CSS variables, preference subscription, and system color
mode observation. It stops calling raw Tauri zoom.

A new Desktop-only zoom lifecycle receives
`DesktopNativeUiBridge["setZoom"]`, resolves the same stored zoom factor, and
preserves:

- initial native zoom application;
- native zoom updates when the preference changes; and
- the current non-fatal handling of native zoom rejection.

## 10. Exact file plan

```text
apps/desktop/src/
  App.tsx                                                   [modify]

  providers/
    DesktopProductLifecycleRoot.tsx                        [modify]
    DesktopProductLifecycleRoot.test.tsx                   [modify]

  hooks/access/tauri/
    use-menu-events.ts                                     [delete]
    dock/use-dock-actions.ts                               [delete]
    use-window-actions.ts                                  [modify]

  hooks/app/lifecycle/
    use-workspace-activity-indicator.ts                    [modify]
    use-workspace-activity-indicator.test.tsx               [modify]

  hooks/preferences/lifecycle/
    use-appearance-preference-lifecycle.ts                 [modify]
    use-appearance-preference-lifecycle.test.tsx            [modify]
    use-desktop-zoom-preference-lifecycle.ts               [new]
    use-desktop-zoom-preference-lifecycle.test.tsx          [new]

  hooks/shortcuts/lifecycle/
    use-shortcut-dispatcher.ts                             [modify]
    use-shortcut-dispatcher.test.tsx                        [modify]
    use-native-menu-command-dispatcher.ts                  [new]
    use-native-menu-command-dispatcher.test.tsx             [new]

  hooks/ui/native/
    use-native-context-menu.ts                             [modify]
    use-native-context-menu.test.tsx                        [new]

  components/content/ui/diff/
    ChatDiffLineWrapContextMenu.test.tsx                   [modify]

  components/content/ui/
    DiffViewer.test.tsx                                   [modify]
    FileDiffCard.test.tsx                                 [modify]

  components/playground/
    PlaygroundSidebarGitDiff.test.tsx                     [modify]

  components/workspace/chat/tool-calls/
    CollapsedActions.test.tsx                              [modify]
    FileChangeCall.test.tsx                                [modify]

  components/workspace/chat/transcript/
    TranscriptToolCallItemBlock.test.tsx                   [modify]
    TurnDiffPanel.test.tsx                                 [modify]

  components/workspace/shell/sidebar/
    WorkspaceItem.test.tsx                                 [modify]

  components/workspace/shell/topbar/
    HeaderChatTab.test.tsx                                 [modify]

  hooks/cowork/ui/use-cowork-session-native-context-menu.ts                 [modify]
  hooks/editor/ui/use-file-tree-native-context-menu.ts                      [modify]
  hooks/terminals/ui/use-terminal-tab-native-context-menu.ts                [modify]
  hooks/ui/native/use-chat-diff-line-wrap-native-context-menu.ts            [modify]
  hooks/workspaces/ui/files/use-file-reference-native-context-menu.ts       [modify]
  hooks/workspaces/ui/tabs/use-workspace-tab-native-context-menu.ts         [modify]
  hooks/workspaces/ui/use-repo-group-native-context-menu.ts                 [modify]
  hooks/workspaces/ui/use-workspace-actions-native-menu.ts                  [modify]
  hooks/workspaces/ui/use-workspace-sidebar-native-context-menu.ts          [modify]
```

`use-window-actions.ts` removes only its now-unused running-agent member and
keeps Mac window-chrome behavior intact.

The provider-dependent component tests mount a ProductHost test fixture:

- `ChatDiffLineWrapContextMenu.test.tsx`;
- `WorkspaceItem.test.tsx`, replacing its stale raw context-menu mock;
- `CollapsedActions.test.tsx`;
- `FileChangeCall.test.tsx`;
- `TranscriptToolCallItemBlock.test.tsx`;
- `HeaderChatTab.test.tsx`;
- `DiffViewer.test.tsx`;
- `FileDiffCard.test.tsx`;
- `PlaygroundSidebarGitDiff.test.tsx`; and
- `TurnDiffPanel.test.tsx`.

The latter eight are recorded because their nested menu consumers now require
the real host boundary even though the test's primary subject is broader than
native UI.

Raw implementations under `lib/access/tauri/{context-menu,menu,dock,window}.ts`
remain in place. No ProductClient package file changes.

## 11. Representative failure path

In browser-only Desktop development, `host.desktop` remains the concrete
Desktop bridge but Tauri menus are unavailable:

```text
capture right-click
  -> call desktop.nativeUi.showContextMenu(items)
  -> raw Desktop implementation returns false
  -> mark this hook instance native-disabled
  -> redispatch one equivalent DOM context-menu event in a microtask
  -> existing DOM fallback opens
  -> later right-clicks fall through directly
```

This adds no retry, persistence, queue, availability probe, or nullable
Desktop host. The visible menu and callback behavior remain unchanged.

Other failure behavior:

- `desktop === null` is normal and mounts no native lifecycles;
- unsupported native command ids remain ignored;
- Dock and zoom failures remain non-fatal; and
- a new bridge capability, another bridge group, contract redesign, or
  user-visible behavior change is a stop condition.

## 12. Acceptance proof

### 12.1 Focused automated behavior

Tests must prove:

- native context-menu interception with a real bridge;
- untouched DOM behavior with `desktop === null` or no items;
- exactly one fallback dispatch on the original descendant target when the
  bridge returns `false`;
- first refusal disables both capture and imperative native attempts for that
  hook instance without rebuilding items or recalling the bridge;
- native menu commands dispatch once and unsubscribe cleanly;
- invalid native command ids are ignored and the reveal-reset event fires only
  for consumed commands;
- keyboard shortcuts still work with `desktop === null`;
- Dock activity uses `setWorkspaceActivity` with existing hydration,
  deduplication, pending-call, remount, and later-retry behavior;
- document appearance still updates with `desktop === null`;
- native zoom uses `setZoom` only when a Desktop bridge exists;
- host replacement with the same stable bridge does not duplicate native
  subscriptions or exports;
- bridge removal unmounts Desktop-native lifecycles and cleans subscriptions;
- the obsolete menu/Dock access hooks are deleted; and
- no product-owned file in scope imports raw native-UI types or the replaced
  Tauri hooks.

Existing bridge and running-count tests remain green.

### 12.2 Required commands

Run and record:

```bash
pnpm --filter @proliferate/product-client build

pnpm --dir apps/desktop exec vitest run \
  src/providers/DesktopProductLifecycleRoot.test.tsx \
  src/hooks/app/lifecycle/use-export-running-agent-count.test.tsx \
  src/hooks/app/lifecycle/use-workspace-activity-indicator.test.tsx \
  src/hooks/preferences/lifecycle/use-appearance-preference-lifecycle.test.tsx \
  src/hooks/preferences/lifecycle/use-desktop-zoom-preference-lifecycle.test.tsx \
  src/hooks/shortcuts/lifecycle/use-shortcut-dispatcher.test.tsx \
  src/hooks/shortcuts/lifecycle/use-native-menu-command-dispatcher.test.tsx \
  src/hooks/ui/native/use-native-context-menu.test.tsx \
  src/components/content/ui/diff/ChatDiffLineWrapContextMenu.test.tsx \
  src/components/content/ui/DiffViewer.test.tsx \
  src/components/content/ui/FileDiffCard.test.tsx \
  src/components/playground/PlaygroundSidebarGitDiff.test.tsx \
  src/components/workspace/chat/tool-calls/CollapsedActions.test.tsx \
  src/components/workspace/chat/tool-calls/FileChangeCall.test.tsx \
  src/components/workspace/chat/transcript/TranscriptToolCallItemBlock.test.tsx \
  src/components/workspace/chat/transcript/TurnDiffPanel.test.tsx \
  src/components/workspace/shell/sidebar/WorkspaceItem.test.tsx \
  src/components/workspace/shell/topbar/HeaderChatTab.test.tsx \
  src/hooks/cowork/ui/use-cowork-session-native-context-menu.test.ts \
  src/hooks/editor/ui/use-file-tree-native-context-menu.test.ts \
  src/hooks/terminals/ui/use-terminal-tab-native-context-menu.test.ts \
  src/hooks/workspaces/ui/files/use-file-reference-native-context-menu.test.ts \
  src/hooks/workspaces/ui/use-repo-group-native-context-menu.test.ts \
  src/hooks/workspaces/ui/use-workspace-actions-native-menu.test.ts \
  src/hooks/workspaces/ui/use-workspace-sidebar-native-context-menu.test.ts \
  src/lib/access/tauri/desktop-bridge.test.ts

pnpm --dir apps/desktop test
pnpm --dir apps/desktop build
python3 scripts/report_frontend_structure.py --strict --summary-only

USE_EXISTING_POSTGRES=1 \
USE_EXISTING_REDIS=1 \
LOCAL_PGHOST=127.0.0.1 \
TIER2_INTENT_SKIP_RUNTIME=1 \
CI=true \
pnpm -C tests/intent exec playwright test specs/workflow-definitions.spec.ts

git diff --check
```

The exact full Desktop test command must be reported truthfully. The prior
base-equivalent design-system pretest waiver carries only when its failure is
identical to the exact base and every touched/focused test is green. It never
covers a new failure.

### 12.3 Named-profile Desktop smoke

Using a unique profile per `specs/developing/local/dev-profiles.md`, prove:

- Desktop starts without a missing host/provider error;
- browser keyboard shortcuts still dispatch;
- native menu commands dispatch exactly once;
- a real native context menu opens in Tauri;
- browser-development/DOM fallback behavior follows §11;
- changing the zoom preference updates Desktop WebView zoom while document
  appearance remains correct;
- Dock attention and running-agent export still update; and
- no duplicate native listener/export appears after an auth-driven host
  snapshot replacement.

This is a Desktop/native-UI smoke, not a Web or full release-qualification run.

## 13. Completion and stop conditions

The PR is complete only when the observable outcome, exact file plan,
preserved behavior, focused tests, required commands, and named-profile smoke
are satisfied in one reviewable implementation PR.

Stop and return to specification if implementation requires:

- changing ProductHost or DesktopBridge types;
- adding a native menu availability capability;
- adopting another bridge group;
- redesigning a native access implementation;
- changing menu, shortcut, Dock, or appearance behavior;
- moving product source;
- touching Web or CSS; or
- unrelated hardening.

After implementation is reviewed and accepted, reconcile the next
capability-focused bridge-adoption slice. Do not begin it from this contract.
