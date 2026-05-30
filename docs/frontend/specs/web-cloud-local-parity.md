# Web Cloud/Local Parity Spec

Status: product and implementation spec.

Date: 2026-05-25

Scope:

- `apps/web/src/**`
- `apps/mobile/src/**`
- `apps/desktop/src/**` only when extracting presentation or model code without
  changing Desktop behavior
- `apps/packages/product-ui/src/**`
- `apps/packages/product-domain/src/**`
- `apps/packages/design/**` and `apps/packages/ui/**` when shared primitives need small
  extensions
- cloud command/session/workspace SDK types only when UI parity exposes a
  missing contract

Read this before implementing Web cloud workspace navigation, Web chat/session
parity, Web settings migration, or mobile cloud UI cleanup.

## Why This Exists

The product now has several ways to interact with the same work:

- Desktop local workspaces and sessions.
- Desktop workspaces exposed to Cloud for Web/mobile access.
- Cloud-hosted workspaces running in a managed sandbox.
- Web/mobile sessions dispatched through Cloud commands.
- Automation-originated workspaces and sessions.

Those are related, but they are not the same product state. The current Web UI
can make a synced local Desktop workspace look like a cloud sandbox workspace,
and a new session inside an existing workspace can feel like an unrelated new
workspace. This spec defines the product model and UI shape that removes that
ambiguity.

The strict goal is:

> A user should always know which workspace they are in, where it is running,
> how Cloud is involved, which session they are viewing, and whether a new
> chat creates a new workspace or a new session in the current workspace.

## Source Material

This spec composes existing frontend specs instead of replacing them:

- `docs/frontend/specs/mobile-cloud-client.md` is the mobile behavior-parity
  reference.
- `docs/frontend/specs/chat-composer.md` and
  `docs/frontend/specs/chat-transcript.md` remain authoritative for composer
  and transcript behavior.

## Vocabulary

Use these terms consistently in code, copy, and review notes.

- **Workspace**: the durable unit of repo/branch/files/runtime context.
- **Session**: one agent conversation projected inside a workspace. A workspace
  may have zero, one, or many sessions.
- **Cloud workspace record**: the Cloud control-plane representation of a
  workspace. It does not by itself mean "cloud sandbox".
- **Cloud-hosted workspace**: a workspace whose runtime target is a managed
  cloud sandbox.
- **Desktop-exposed workspace**: a local Desktop workspace that has a Cloud
  record and active exposure so Web/mobile can route commands through the local
  desktop worker.
- **Source**: why or where this workspace/session entered the user's recent
  work list: Desktop/local, Web access, mobile dispatch, personal automation,
  team automation, Slack, API, or another integration.
- **Runtime location**: where commands execute now: local Desktop target,
  cloud sandbox target, SSH target, offline target, or unknown.
- **Active exposure**: the Cloud server has a current exposure for a workspace
  and an online target capable of leasing commands for it.

## Current Code Map

### Web Chat

- `apps/web/src/components/chat/screen/ChatScreen.tsx` is the Web cloud chat
  controller. It reads snapshots and live events, derives sessions, dispatches
  commands, manages pending prompt/config state, and renders the shared-ish
  `CloudChatSurface`.
- `apps/packages/product-ui/src/chat/CloudChatSurface.tsx` is the current Web chat
  shell. It owns header layout, workspace chips, session switcher placement,
  transcript placement, composer placement, and empty/no-session messaging.
- `apps/packages/product-ui/src/chat/CloudChatComposer.tsx` and
  `apps/packages/product-domain/src/chats/cloud/composer-controls.ts` own the current
  Web/cloud composer approximation.
- Desktop source components for the target composer behavior live under
  `apps/desktop/src/components/workspace/chat/input/**`.

### Web Sidebar And Workspace List

- `apps/web/src/components/app/navigation/WebSidebarController.tsx` maps cloud
  workspaces and session summaries into `ProductSidebar`.
- `apps/web/src/lib/domain/sidebar/cloud-sidebar-model.ts` owns current Web sidebar
  grouping/sorting/source labels.
- `apps/packages/product-domain/src/workspaces/cloud-work-inventory.ts` and
  `apps/packages/product-domain/src/workspaces/inventory-cloud.ts` already contain
  related cloud workspace inventory rules.
- `apps/packages/product-ui/src/sidebar/ProductSidebar.tsx` is the shared sidebar
  presentation currently used by Web.
- `apps/web/src/components/workspaces/screen/WorkspacesScreen.tsx` and
  `apps/packages/product-ui/src/workspaces/WorkspacesSurface.tsx` own the current
  Web workspaces inventory.

### Desktop Reference Points

- `apps/desktop/src/components/workspace/shell/topbar/HeaderTabs.tsx` and
  `apps/desktop/src/hooks/workspaces/tabs/use-workspace-header-tabs-view-model.ts`
  show how Desktop makes multiple sessions/tabs in one workspace explicit.
- `apps/desktop/src/components/workspaces/inventory/CloudWorkspacesScreen.tsx`
  already consumes the shared `WorkspacesSurface`.
- Desktop settings live under `apps/desktop/src/components/settings/**`,
  `apps/desktop/src/hooks/settings/**`, and `apps/desktop/src/config/settings.ts`.

### Web Settings

- `apps/web/src/components/settings/screen/SettingsScreen.tsx` is a Web route
  screen with a separate section model and Web-only data wiring.
- `apps/packages/product-ui/src/settings/**` contains reusable settings UI pieces,
  but the Web settings experience is not yet the same IA as Desktop in a modal.
- `apps/desktop/src/components/settings/shared/**` already re-exports some shared
  settings primitives from `apps/packages/product-ui/src/settings/**`; the migration
  should extend those primitives instead of re-extracting them as if they do
  not exist.

### Mobile

- `apps/mobile/src/**` is a native client and must preserve behavior parity, not DOM
  component reuse. Its cloud client contract is defined in
  `docs/frontend/specs/mobile-cloud-client.md`.

## Product Principles

1. **Workspace identity is primary.** A new chat from inside a workspace is a
   new session in that workspace, not a new workspace. The UI must say this.
2. **Runtime location is separate from Cloud sync.** A Cloud record can point to
   a local Desktop exposure or a cloud sandbox. Icons, copy, and routing must
   represent the runtime location, not just the existence of a Cloud row.
3. **Source is a small left-edge signal, not a status badge soup.** Recents
   should remain readable, with source/type conveyed by compact icons and
   tooltips.
4. **Desktop is the visual source of truth for chat.** Web should use shared
   Desktop-grade presentation and Web-only cloud adapters.
5. **Settings should share structure and components, not transport hooks.**
   Cross-client settings sharing belongs in pure section models and
   presentational components. Client-specific data loading stays in each app.
6. **Mobile gets the same product model with native layout.** Mobile should not
   import DOM components, but it should share product-domain rules and cloud
   command/session semantics.

## Shared View Models And API Contract

Do not add a third workspace/sidebar model. The implementation should
consolidate overlapping rules currently spread across
`apps/web/src/lib/domain/sidebar/cloud-sidebar-model.ts`,
`apps/packages/product-domain/src/workspaces/cloud-work-inventory.ts`, and
`apps/packages/product-domain/src/workspaces/inventory-cloud.ts`.

The new shared owner should live under `apps/packages/product-domain/src/workspaces/**`
and should emit serializable semantic view models only. It may emit semantic
ids such as `sourceKind: "desktop_exposed"` or
`runtimeLocation: "cloud_sandbox"`, but not React components, Lucide icons,
DOM classes, native icons, routes, query hooks, or client actions.
`apps/packages/product-ui` maps semantic ids to DOM icons and styling. Mobile maps
the same semantic ids to native icons and styling.

### Recent Work Item

The default Recents list is a mixed recent-work list. Rows may represent either
a workspace or a specific session, and the row type must be explicit.

Target view model:

```ts
type RecentWorkItemView = {
  id: string;
  rowKind: "workspace" | "session" | "pending-session";
  workspaceId: string;
  sessionId: string | null;
  pendingSessionKey?: string;
  openTarget:
    | { kind: "workspace"; workspaceId: string }
    | { kind: "session"; workspaceId: string; sessionId: string }
    | { kind: "pending-session"; workspaceId: string; pendingSessionKey: string };
  title: string;
  subtitle?: string;
  repoLabel?: string;
  branchLabel?: string;
  sourceKind:
    | "desktop_exposed"
    | "cloud_sandbox"
    | "web"
    | "mobile"
    | "personal_automation"
    | "team_automation"
    | "slack"
    | "api"
    | "unknown";
  runtimeLocation:
    | "local_desktop"
    | "cloud_sandbox"
    | "ssh_remote"
    | "offline"
    | "unknown";
  cloudAccessState: "enabled" | "not_enabled" | "unknown";
  commandability: "commandable" | "not_commandable" | "stale" | "unknown";
  ownership: "mine" | "team" | "unclaimed" | "unknown";
  lastActivityAt: string | null;
  lastActivityLabel: string;
  state: "idle" | "running" | "review" | "blocked" | "done" | "pending" | "unknown";
};
```

### Cloud Field Mapping

The first implementation slice must include an API/SDK contract preflight. If
the fields below are absent from the SDK shape, add or regenerate the owning
server/SDK contracts instead of guessing in Web UI code.

| Product fact | Candidate source fields |
| --- | --- |
| Cloud-hosted vs Desktop-exposed vs SSH/self-hosted | `sandboxType`, `directTargetContext.targetKind`, target kind, runtime environment target kind |
| Human/Web/mobile/automation/Slack/API origin | `origin.entrypoint`, `creatorContext.kind`, automation run metadata, command source |
| Personal/team/unclaimed | `visibility`, claim state, workspace owner/org fields |
| Active exposure | `exposureState`, active exposure id/revision, exposure status |
| Can lease commands now | `exposure.commandable`, target online/heartbeat state, worker status |
| Runtime health | `runtime.status`, target health/status, last heartbeat |
| Branch/repo identity | repo config, `repoFullName`, branch/default branch fields |
| Cloud access capability | existence of active or inactive exposure/mobility mapping, not runtime location |

The UI must not infer "cloud sandbox" from the mere presence of a Cloud
workspace id.

## Target Experience

### 1. Sidebar And Recents

The sidebar should follow the spirit of
`/Users/pablohansen/delete/basic_chats_sidebar.html`:

- Primary list: **Recents**.
- Rows are compact, scan-friendly, and stable in height.
- Each row has a leftmost source/type indicator, workspace/session title, and
  last activity time.
- The active row is obvious without using loud color.
- The default sidebar should not permanently group by every taxonomy.
- A group/filter popover lets the user temporarily slice by source, owner,
  status, repo, runtime location, or attention state.
- A "Show more" or "All workspaces" action navigates to the Workspaces view
  instead of expanding the sidebar into a second inventory product.
- Session rows and workspace rows may appear together, but each row must carry
  a clear row kind. Opening a session row opens that session. Opening a
  workspace row opens the workspace with its best/default session selected, or
  the no-session start surface if none exists.

Required source indicators:

- Desktop/local exposed workspace.
- Cloud sandbox workspace.
- Web access.
- Mobile dispatch.
- Personal automation.
- Team automation.
- Slack/API/integration dispatch.

Required runtime indicators:

- Running locally through Desktop.
- Running in Cloud.
- Running on SSH/remote target, if represented in Cloud.
- Offline or no active exposure.
- Unknown or stale state.

The sidebar should not show a green cloud indicator merely because Cloud access
is enabled. Cloud access is a capability, not proof that the runtime is healthy
or cloud-hosted.

### 2. Workspace Inventory

The Workspaces view is the full inventory. The top of the view should align
with the sidebar model:

- It should preserve the same source/runtime vocabulary as Recents.
- It should provide richer filtering, grouping, and sorting than the sidebar.
- It should make "local Desktop exposure" versus "cloud sandbox" visible.
- Opening a row should land in the workspace, with the best session selected
  by default when one exists.
- If no session exists, the empty state should be "Start a session in this
  workspace", not "No active session" with no workspace context.

The top area of the Workspaces view and the chat header should use the same
workspace/session identity components where possible.

### 3. Chat Header And Session Switching

Inside a cloud workspace route, the header must answer:

- Which workspace is this?
- Which repo/branch/runtime location is this?
- Is Cloud access enabled?
- Is the active runtime currently online?
- Which session am I viewing?
- Can I switch sessions?
- Does "new chat" mean a new session in this workspace?

Target behavior:

- Header shows workspace name as the primary object.
- Runtime and Cloud access are separate chips/indicators.
- Session switcher is a first-class control, not a tiny ambiguous select.
- Session rows show a useful label, last activity, state, and source when
  available.
- "New session" copy includes the workspace name or appears inside a workspace
  session menu so the relationship is obvious.
- The empty state for a workspace with zero sessions uses copy like
  "Start the first session in Bramble".
- A pending newly-created session appears in the switcher immediately and then
  reconciles to the projected session id.

Desktop reference:

- Use Desktop's workspace/tab/session identity patterns as the source of truth
  for visual density and hierarchy.
- Do not copy Desktop controller hooks into Web. The shared DOM layer may own
  presentational components such as `WorkspaceIdentityHeader` and
  `SessionSwitcher` that accept view models and callbacks. Desktop keeps
  `use-workspace-header-tabs-view-model.ts` and other local/Tauri controllers.
  Web maps Cloud snapshots, command state, and routes into the shared
  presentation from its controller.

### 4. Web Composer And Transcript

Web should stop drifting as a parallel chat UI.

Required target:

- Composer dock, textarea, control buttons, popovers, footer row, config
  controls, pending config indicators, and disabled states use extracted shared
  presentation from Desktop where possible.
- Transcript user/assistant/system/error rows, copy affordances, reasoning
  rows, tool rows, and plan rows use Desktop-grade shared presentation.
- Web controllers remain responsible for cloud command dispatch, claim state,
  pending prompt persistence, snapshot/live event subscription, and retry/error
  handling.
- Shared product-domain code owns pure reconciliation rules that apply to both
  Web and Mobile:
  - pending first prompt before a session id exists
  - pending new session inside an existing workspace
  - optimistic user row echo removal
  - assistant waiting row removal
  - command accepted/rejected/expired/superseded presentation state
  - config pending/confirmed/failed state

The Web composer must distinguish:

- New cloud workspace from New Chat/Home.
- New session in an existing workspace.
- Prompt in an existing session.
- Workspace open but no active exposure.
- Workspace open but target/runtime config missing.

### 5. Command Flows

Web and Mobile should treat commands as remote intent, not direct local API
calls.

Before any command is enqueued, the client must classify the workspace runtime:

- **Managed personal cloud sandbox**: ensure managed/free credits where
  required, ensure target config/materialization is ready, then enqueue.
- **Managed shared or unclaimed workspace**: require claim/access state before
  prompt/config commands, then follow managed target readiness.
- **Desktop-exposed local workspace**: require an active, commandable exposure
  and online target/worker. Do not show cloud sandbox resume copy.
- **SSH/self-hosted target**: require target config, target health, and
  commandability.
- **Offline/stale/unknown exposure**: do not enqueue prompt/config commands.
  Keep the workspace visible and show the blocked runtime state.

For a new session in an existing workspace:

1. User sends the first prompt from the workspace route.
2. UI creates a pending session view scoped to that workspace.
3. Client performs the runtime preflight above.
4. Client enqueues `start_session` for the workspace with an idempotency key
   and a client intent id.
5. If the command result includes a session id before the workspace snapshot
   projection catches up, the UI may route to a temporary session projection.
   That temporary projection must reconcile with the later snapshot projection
   without duplicating the session row.
6. Client enqueues `send_prompt` against that session with a correlated
   idempotency key.
7. Transcript reconciles optimistic rows with live/projected events.

For an existing session:

1. User sends prompt.
2. UI clears input and shows optimistic user/waiting rows immediately.
3. Client performs runtime readiness checks. Web and Mobile should both ensure
   managed target config readiness before `send_prompt` when the workspace is a
   managed cloud workspace.
4. Client enqueues `send_prompt`.
5. Accepted command reconciles with events.
6. Rejected command leaves an inspectable failed row.

For session config:

1. User changes model/mode/reasoning/config.
2. UI shows pending config immediately.
3. Client enqueues `update_session_config` with the observed session state.
4. Live config confirmation clears pending state.
5. Rejection rolls back or marks failed with explicit copy.

Command enqueue failures must be mapped to product states:

- `cloud_command_exposure_not_active`: the local/Desktop exposure or target is
  offline. Show that this is the same workspace but commands cannot be leased.
- `cloud_command_workspace_not_found`: the Cloud workspace record and target
  mapping are out of sync. Offer reload/backfill/remediation when available.
- `cloud_command_target_config_required`: target materialization/config is
  missing. Keep the workspace open and explain the blocked send.
- Permission/claim failures: keep the workspace visible and expose claim or
  access copy.
- `expired`, `superseded`, and delivery failures: keep the user's intent
  visible, suppress duplicate retries, and expose retry/re-send only when the
  command state is terminal.

Pending command state must survive reload for the flows that can span runtime
startup:

- queued first prompt before a session id exists
- `start_session` accepted before snapshot projection catches up
- session id known before first transcript event
- `send_prompt` accepted before assistant progress
- `start_session` succeeds and `send_prompt` fails
- config command pending while live config catches up

Persist only the client-owned intent metadata needed to reconcile:
`clientIntentId`, idempotency keys, command ids, workspace id, optional session
id, optional pending session key, prompt/config payload summary, and observed
sequence where applicable. Web owns browser/local persistence. Mobile owns
native/mobile persistence. Shared product-domain may own the pure state machine
and duplicate suppression rules.

### 6. Settings Modal

Web settings should become a modal that uses the same structure and component
logic as Desktop where the setting has Cloud meaning.

Required shape:

- Settings opens as a modal/sheet over the current Web route.
- The modal uses the same high-level shell pattern as Desktop settings:
  sidebar/section nav, section header, rows/cards, loading/error boundaries,
  footer actions where needed.
- Web settings should not remain a separate full route as the primary entry.
- Settings state should preserve the current workspace/chat route underneath.
- Route contract: Web should use background-location modal routing, with direct
  `/settings/:sectionId?` reloads falling back to a standalone settings modal
  host. Opening settings from an existing route preserves the background route.
  Browser Back closes the modal and restores that route. Closing with Escape or
  the close button returns to the preserved `returnTo` route. Billing checkout
  query params must continue to open the billing section and preserve checkout
  result copy.
- The modal must trap focus while open, restore focus on close, and keep
  route/content scroll from leaking behind it.

Settings sections to include in Web by default:

- `account`: account and sign-in/provider status.
- `organization`: organization/team memberships. Preserve `teams` as a
  compatibility alias while old links exist.
- `billing`: plan, managed credits, checkout result, and customer portal state.
- `environments`: Cloud repo/environment configuration where relevant.
- `support`: support/about/legal as appropriate.

Conditional/deferred Web sections:

- Agent defaults.
- Review.
- Slack bot.
- Shared environments/shared sandbox.

These sections appear only when their Cloud/Web capability exists. Otherwise
they are filtered out, not shown as disabled placeholder rows.

Settings sections to exclude from Web:

- General Desktop preferences.
- Appearance.
- Keyboard.
- Compute.
- Worktrees.
- Non-cloud local environments.
- Agent Harness local auth sync.
- Desktop-only local filesystem or native app preferences.

Sharing model:

- Extend the existing shared settings primitives in
  `apps/packages/product-ui/src/settings/**`. Shared settings UI owns only
  presentational shells/nav/card/row/modal surfaces that accept section
  descriptors, statuses, disabled reasons, slots, and callbacks.
- Move section definitions, ordering, search/filter labels, and capability
  gating to `apps/packages/product-domain/src/settings/**` if they are pure. The
  product-domain layer may own icon tokens, but not React icon components,
  native icon components, routes, SDK hooks, Tauri actions, support actions, or
  updater actions.
- Keep Desktop data hooks, stores, Tauri access, updater actions, app version,
  support dialog wiring, shortcut reveal labels, drag regions, telemetry
  capture, and route normalization in Desktop.
- Keep Web controllers, Cloud SDK/react-query hooks, auth provider flow,
  browser redirects, modal routing, and Web telemetry capture in Web.
- Share React hooks only when they are UI-local and transport-free, such as
  selected section state, section search state, or keyboard focus helpers.
- Do not add a shared settings hook that calls Desktop stores, Tauri,
  Cloud SDK, or raw endpoints.
- Shared error/loading UI may render errors. App-owned boundaries capture
  telemetry and decide retry/refetch behavior.

### 7. Mobile

Mobile should use the same Cloud workspace/session/command product model, but
with native surfaces.

Required mobile outcomes:

- Recents/workspaces show the same source and runtime distinctions as Web.
- Workspace detail makes session-in-workspace explicit.
- New session in an existing workspace is a first-class flow.
- Existing-session prompt send, first prompt, config updates, claim gating, and
  live transcript reload semantics match Web.
- Settings use the same section model as Web where the sections are mobile
  relevant, rendered as native screens/sheets.
- Mobile does not import DOM `product-ui` components.
- Mobile may use `product-domain` helpers for source/runtime labels, command
  state, pending prompt reconciliation, and settings section definitions.

Mobile should treat Web parity as behavioral parity plus visual-language
parity, not DOM reuse.

## Architecture Target

```text
Desktop
  local AnyHarness/Tauri controllers
    -> shared product-domain pure rules where applicable
    -> shared product-ui DOM presentation where applicable
    -> Desktop-only native/local adapters

Web
  cloud SDK/react-query/controllers
    -> shared product-domain pure rules
    -> shared product-ui DOM presentation
    -> Web-only cloud command/routing adapters

Mobile
  cloud SDK/react-query/native controllers
    -> shared product-domain pure rules
    -> React Native presentation
    -> Mobile-only navigation/lifecycle adapters
```

Shared UI components must not import:

- Cloud SDK clients.
- AnyHarness clients.
- Tauri APIs.
- React Query hooks.
- Zustand stores.
- Raw endpoint paths.

Shared product-domain code must stay pure:

- inputs in
- serializable view models out
- no side effects
- no React
- no browser/native APIs

## Implementation Slices

### Slice 1: Product Model Vocabulary

- Add source/runtime/location view-model types in `apps/packages/product-domain`.
- Normalize semantic ids, labels, and tooltip copy for Desktop-exposed,
  cloud-hosted, Web, mobile, automation, Slack/API, online/offline/stale
  states. Do not place React/native icon components in product-domain.
- Consolidate or retire overlapping workspace/sidebar helpers in
  `apps/web/src/lib/domain/sidebar/cloud-sidebar-model.ts`,
  `apps/packages/product-domain/src/workspaces/cloud-work-inventory.ts`, and
  `apps/packages/product-domain/src/workspaces/inventory-cloud.ts`.
- Add the API/SDK field preflight for origin, creator context, sandbox type,
  runtime status, exposure status, target kind, claim state, and command error
  codes.
- Update Web sidebar and Workspaces controllers to use the normalized model.
- Do not change Desktop visuals yet unless using the same pure labels safely.

Done when Web can show Cloud access and runtime location as separate facts.

### Slice 2: Recents Sidebar

- Update `ProductSidebar` or introduce a new shared sidebar row variant that
  matches the compact reference row.
- Use Recents as the primary default list.
- Add a grouping/filter popover instead of permanent heavy grouping.
- Add "Show more" or "All workspaces" navigation into the Workspaces view.
- Preserve active workspace/session selection and accessibility labels.

Done when a Desktop-exposed workspace no longer looks like a cloud sandbox
just because it has a Cloud record.

### Slice 3: Workspace And Session Identity Header

- Extract presentational `WorkspaceIdentityHeader` and `SessionSwitcher`
  components from current Web and Desktop patterns.
- Add a clear session switcher for all sessions in a workspace.
- Rename/copy "New chat" in workspace context to "New session" or "New session
  in <workspace>".
- Make no-session state explicitly scoped to the workspace.
- Ensure pending new sessions appear in the session switcher.
- Keep Desktop and Web controllers separate.

Done when the user can glance at a new session and understand it is inside the
same workspace.

### Slice 4: Composer And Transcript Exactness

- First extract composer leaves and config controls.
- Then extract transcript message leaves.
- Then extract plan cards.
- Then extract tool/action rows.
- Then extract transcript view/virtualization.
- Prefer retained `TranscriptState` where envelopes exist; flat projected rows
  remain only as a degraded fallback.
- Preserve telemetry masking and long-history/virtualization behavior.
- Move command/pending reconciliation rules that are not client-specific into
  `apps/packages/product-domain`.
- Keep Web command dispatch in Web.

Done when Web chat no longer contains an alternate product implementation for
core transcript/composer visuals.

### Slice 5: Settings Modal

- Extend existing shared settings shell/nav/cards/rows in
  `apps/packages/product-ui/src/settings/**`.
- Add a pure settings section definition model with Web capability filtering.
- Replace the Web settings route experience with the modal route contract
  above.
- Remove Web exposure of Desktop-only pages listed above.
- Keep existing Web account/org/billing/provider logic by adapting it into the
  shared modal sections.

Done when Web settings feels like Desktop settings in a modal, but only shows
Cloud/Web-relevant settings.

### Slice 6: Mobile Alignment

- Reuse product-domain source/runtime/session/command/settings definitions.
- Update Mobile recents/workspace/session views to match the same product
  semantics.
- Align Mobile existing-session prompt send with Web managed target config
  readiness checks.
- Align Web first-prompt retryable readiness classification with Mobile.
- Keep native React Native surfaces and navigation.
- Smoke real mobile lifecycle cases from `mobile-cloud-client.md`.

Done when mobile can explain the same workspace/session/runtime facts as Web
and complete the same core command flows.

## Acceptance Criteria

### Web Sidebar

- Recents are the default.
- Recents use `RecentWorkItemView` or an equivalent model with explicit row
  kind, workspace id, optional session id, source kind, runtime location, Cloud
  access state, commandability, and last activity.
- Source/type indicator appears at the left edge of every recent row.
- Runtime location and Cloud access are distinguishable.
- Active row remains stable after reload.
- "Show more" opens the Workspaces view.
- Grouping/filter popover can slice by source and runtime location.

### Web Chat

- Header clearly names the workspace.
- Header clearly names or exposes the current session.
- Session switcher lists all sessions for the workspace.
- New session in an existing workspace is labeled as a new session, not a new
  workspace.
- First prompt in a new session succeeds through `start_session` then
  `send_prompt`.
- Pending session rows reconcile whether the session id first appears in the
  command result or the workspace snapshot projection.
- Existing-session sends and first-prompt sends perform the right runtime
  readiness preflight for managed cloud, Desktop-exposed local, SSH/self-hosted,
  shared/unclaimed, and offline/stale workspaces.
- Command failures keep the workspace/session visible and explain the blocked
  state.
- Composer controls match Desktop structure and states.
- Transcript rows use shared Desktop-grade presentation.

### Web Settings

- Settings opens as a modal over the current route.
- Browser Back closes the modal and restores the background route.
- Direct `/settings/:sectionId?` reload opens a standalone modal host.
- Billing checkout query params still land on billing result copy.
- Account, org/team, billing, cloud repo/environment, and support sections are
  available.
- Appearance, keyboard, compute, non-cloud environments, and local Agent
  Harness auth sync are absent.
- Section data uses Cloud SDK/react-query through Web controllers, not Desktop
  hooks.
- Shared settings components do not call clients or stores.

### Mobile

- Mobile uses the same source/runtime vocabulary.
- Mobile can switch/create sessions in a workspace.
- Mobile can send first prompt in an existing workspace and reload into the
  correct projected session.
- Mobile settings use the shared section model where applicable.

## Verification Plan

Run the narrowest useful checks for each slice, plus one real browser smoke.

### Local QA Profile Setup

Implementation work for this spec should use an isolated worktree/profile so
Web and Mobile QA can keep authenticated browser state without disturbing the
main Desktop development profile.

Recommended setup:

1. Create a dedicated worktree for the spec/implementation branch.
2. Copy the local non-example env files from the canonical `~/proliferate`
   checkout into the same relative paths in the worktree. At minimum this
   includes root `.env`, `.env.local`, `.env.*` files and server `.env` files
   used by local Cloud auth, billing, provider, and command flows.
3. Do not commit those env files. They are local QA inputs only.
4. Start the profile from the worktree. On Pablo's machine, `pdev cloud` is an
   accepted wrapper around the documented profile flow. The repo-authoritative
   equivalent is `make dev PROFILE=cloud` after `make dev-init PROFILE=cloud`
   and database setup described in `docs/reference/dev-profiles.md`.
5. Have a human sign in through the Web URL produced by that profile.
6. Reuse that browser-authenticated profile for Web QA.
7. For mobile-web QA, source the profile launch env and start the mobile web
   app, for example `pnpm --dir apps/mobile web:profile` with the profile's
   `PROLIFERATE_MOBILE_WEB_PORT`.
8. If native mobile auth is required, use the same profile API/Web endpoints
   and sign in through the simulator/device flow.

Optional setup:

- Use `STRIPE=1` when billing checkout/portal paths must be verified.
- Use the agent gateway/dev credit env required by the branch when prompt
  dispatch depends on managed credits.
- Use ngrok or an equivalent callback tunnel only when native mobile OAuth or
  device deep links require a non-localhost callback.

This setup is part of the test contract. Without copied env files and a human
login, QA can still run type/build checks, but it cannot fully verify provider
auth, billing/account settings, Cloud command enqueueing, or user-scoped
workspace visibility.

### Fixture Matrix

Use both faux visual fixtures and real commandable smoke fixtures. Do not treat
faux rows as proof that Cloud commands work.

| Fixture | Purpose | Required kind |
| --- | --- | --- |
| Desktop-exposed local, online/commandable | local-vs-cloud UX, real prompt send | real smoke |
| Desktop-exposed local, offline/inactive exposure | blocked runtime UX and `cloud_command_exposure_not_active` | real or controlled server fixture |
| Managed personal cloud sandbox | cloud sandbox UX, target config readiness, credits | real smoke |
| Managed shared/unclaimed workspace | claim gating and permission copy | real or server-seeded commandable fixture |
| Workspace with zero sessions | no-session start surface | real or faux visual |
| Workspace with multiple sessions | session switcher and recents selection | real smoke |
| Pending session before projection | temporary projection/reconciliation | controlled test |
| Automation-originated workspace | source indicator and filtering | faux visual plus command smoke when available |
| Mobile-origin workspace/session | source indicator and mobile parity | mobile-web/native smoke |
| Slack/API-originated workspace | source indicator and filtering | faux visual acceptable for first UI slice |
| SSH/self-hosted target | runtime location vocabulary | faux visual until commandable target fixture exists |

Recommended checks:

- `pnpm --filter @proliferate/product-domain test` when product-domain rules are
  touched.
- `pnpm --filter @proliferate/product-ui typecheck` when shared DOM UI is
  touched.
- Web typecheck/build for Web controller changes.
- Mobile typecheck for shared product-domain changes consumed by mobile.
- Server command tests when API/SDK command contracts change.
- Product-model tests for source/runtime vocabulary, settings section filters,
  and pending command intent state.
- Web route/modal tests for settings open, close, back button, direct deep
  link, reload fallback, and billing checkout params.
- Browser smoke against a local full-stack profile:
  - open a Desktop-exposed workspace from Web
  - verify it does not show cloud sandbox resume copy
  - switch sessions in that workspace
  - create a new session in that workspace
  - send the first prompt
  - reload and confirm transcript/session identity
  - open settings modal and verify section filtering
- Desktop settings sidebar regression when shared settings primitives change.
- Command-state tests for `cloud_command_exposure_not_active`,
  `cloud_command_workspace_not_found`, `cloud_command_target_config_required`,
  permission/claim failure, `expired`, `superseded`, and delivery failure.
- Reload tests during queued first prompt before session id, after session id
  before first event, and after assistant progress.
- Mobile smoke from `docs/frontend/specs/mobile-cloud-client.md` for any mobile
  changes.

## Open Decisions

These should be decided during implementation, not left implicit:

- Exact source icon set and tooltip copy for Desktop, Web, mobile, automation,
  Slack/API, and cloud sandbox.
- Whether "Show more" expands a few additional recents before routing, or
  always routes to Workspaces.
- Which Desktop settings sections have Cloud meaning after the shared sandbox
  and agent-auth gateway work lands.
- Whether the local sidebar HTML reference should be moved into `docs/**` as a
  durable artifact or replaced entirely by written invariants.

## Non-Goals

- Do not redesign the whole desktop shell.
- Do not make Web a cloud sandbox-only product.
- Do not hide local Desktop exposure behind generic Cloud copy.
- Do not move Desktop controllers or Tauri access into shared packages.
- Do not migrate Desktop settings to a modal.
- Do not share Desktop settings hooks, stores, updater actions, support dialog,
  Tauri access, telemetry capture, or route normalization.
- Do not expose Desktop-only settings sections in Web as disabled placeholders.
- Do not merge local environment/worktree configuration into Web cloud
  environments.
- Do not implement settings search/filter unless separately scoped.
- Do not make Mobile import DOM components.
- Do not keep duplicate old and new Web settings surfaces after migration.
