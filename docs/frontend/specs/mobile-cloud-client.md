# Mobile Cloud Client Reference Spec

Status: reference spec plus implementation checklist. This branch implements
the first production slice of the checklist: mobile new chat, workspace handoff,
chat optimistic UI/config/transcript rendering, workspace opening without an
existing session, real automation list/create/toggle, and real settings
account/org/billing summaries.

Scope:

- `mobile/src/**`
- shared mobile-safe dependencies in `@proliferate/cloud-sdk`,
  `@proliferate/cloud-sdk-react`, `@proliferate/design/react-native`, and
  `@proliferate/product-model`
- server/cloud APIs only when a required mobile workflow has no complete API
  contract yet

This spec covers the mobile version of the Desktop/Web cloud client. It is not
a request for pixel-perfect Desktop DOM reuse. Mobile should preserve the same
product behavior, ordering, labels, state transitions, and verification
coverage, while using native React Native surfaces that fit mobile navigation,
safe areas, keyboard behavior, and touch targets.

## Goal

Build Mobile into a complete cloud-first Proliferate client:

1. A user can sign in, link GitHub, pick a repo, create a cloud workspace, and
   send the first prompt from the mobile home/new-chat screen.
2. A user can open any accessible cloud workspace, create or switch sessions,
   send prompts, change supported chat configuration, and see live transcript
   updates without waiting for a full reload.
3. Chat UI behavior matches Desktop/Web semantics: optimistic user prompts,
   assistant waiting rows, durable transcript rendering, command errors,
   live/snapshot fallback, claim gating, branch/workspace identity, and config
   controls.
4. Sidebar/drawer, workspace lists, session lists, automations, and settings are
   functional enough for end-to-end mobile cloud work.
5. The app survives common mobile lifecycle cases: reload, foreground/background,
   slow provisioning, network loss, keyboard open/close, and deep links.

The strict definition of "parity" is behavior parity plus visual language
parity. Mobile may adapt layout and controls, but it should not invent a
different product model or a simplified chat state machine.

## Non-Goals

- Do not directly import DOM components from `packages/product-ui/**` into
  React Native.
- Do not force Desktop's full-width chat layout onto small screens.
- Do not block the mobile work on moving every Desktop/Web component to shared
  packages first.
- Do not make Mobile a fixture/demo client. Fixture data is acceptable only in
  explicitly marked development surfaces and must not back product flows.
- Do not add duplicate backend semantics in Mobile when a shared cloud command,
  projection, or product-model helper can own the rule.

## Current State From Investigation

Mobile already has a real Expo app scaffold:

- `mobile/src/App.tsx` wires safe area, auth, telemetry, cloud query, and shell
  providers.
- `MobileAuthProvider` stores access/refresh tokens in SecureStore and supports
  Apple, Google, and GitHub OAuth through mobile PKCE flows.
- `MobileCloudProvider` wires `@proliferate/cloud-sdk-react` with the mobile
  bearer-token client.
- `MobileShell` owns a drawer, top bar, auth gate, GitHub-required gate, basic
  route state, deep-link handling, and Android back behavior.
- `MobileWorkspacesScreen` lists real cloud workspaces with
  `useCloudWorkspaces`.
- `MobileSessionsScreen` lists last projected sessions from workspace summaries
  and can open chat.
- `MobileChatScreen` can subscribe to a session, read transcript snapshots,
  send `send_prompt` commands, poll command status, and claim unclaimed shared
  workspaces.
- `MobileAutomationsScreen` is still fixture-backed.
- `MobileSettingsScreen` is mostly static account/settings copy.
- `MobileHomeScreen` is a local draft/mode prototype; it does not create a
  cloud workspace or dispatch the first prompt.

This branch converts the highest-impact gaps into real flows:

- `MobileHomeScreen` now loads configured cloud repos, chooses a model, creates
  a personal cloud workspace, persists the pending first prompt, and opens the
  pending chat shell immediately.
- `MobileChatScreen` now loads workspace snapshots/live state, opens
  workspaces with or without existing sessions, dispatches pending first
  prompts through `start_session` then `send_prompt`, renders event-first /
  projection-fallback transcript rows from shared product-model helpers, shows
  optimistic prompt and assistant waiting rows, exposes config controls, gates
  unclaimed workspaces, and shares branch identity.
- `MobileWorkspacesScreen` and `MobileSessionsScreen` use the primary `my`
  workspace scope and open real chat surfaces.
- `MobileAutomationsScreen` now uses real automation APIs for list, create,
  pause, and resume.
- `MobileSettingsScreen` now shows real viewer, GitHub readiness, personal
  billing, configured repo count, and organization memberships.
- Web now imports the same cloud transcript/composer pure helpers from
  `@proliferate/product-model`, keeping the Web UI behavior intact while
  making Mobile use the same product semantics.

Remaining gaps after this branch are mostly deeper UX and QA work: workspace
detail views, automation edit/delete/run details, richer settings actions,
pull-to-refresh, native simulator/device E2E smoke runs, and shared/unclaimed
claim-path coverage with a real shared workspace fixture.

Latest manual verification, 2026-05-22:

- Mobile web full-stack profile `mobileqa` authenticated through the dev mobile
  refresh-token flow.
- Existing session reload restored the active chat and transcript.
- Existing session prompt send produced optimistic user/waiting rows and exact
  assistant response.
- Explicit "New session" from an existing workspace produced optimistic
  queued rows, started a new projected session, sent the first prompt, and
  reconciled to the exact assistant response.
- Sessions screen expanded workspace snapshots to show multiple projected
  sessions for the same workspace, with session-id disambiguation, and opening
  old/new rows switched transcripts correctly.
- Chat config control, workspace navigation, automations create/pause/resume,
  settings/account/team/billing, sign-out, and re-auth were verified in the
  same local stack.

## Core End-To-End Flows

These are the flows Mobile must reliably complete before the work is considered
done. Each flow should have either automated coverage, a repeatable manual smoke
script, or both.

### 1. Fresh Auth To Ready Shell

Start state: no SecureStore session, app freshly installed.

- [ ] Open Mobile and see the signed-out auth screen.
- [ ] Sign in with Apple or Google.
- [ ] If GitHub is not linked, enter the GitHub-required screen.
- [ ] Link GitHub and return to the app through the mobile callback URL.
- [ ] Land in the authenticated shell with Home, Workspaces, Sessions,
  Automations, and Settings available.
- [ ] Kill and reopen the app; SecureStore refresh restores the active session.
- [ ] Sign out; tokens are removed and query cache is cleared.

### 2. New Personal Cloud Chat From Mobile

Start state: authenticated user with at least one configured cloud repo.

- [ ] Open Home / New Chat.
- [ ] Choose repo, owner scope, model, and supported mode.
- [ ] Type a prompt and send.
- [ ] Mobile creates a cloud workspace with deterministic display name and
  branch name.
- [ ] Mobile immediately routes to a pending chat shell; the prompt remains
  visible as optimistic user work.
- [ ] While the workspace provisions, the chat shell shows materialization state
  instead of an empty "no transcript" dead end.
- [ ] Once the workspace is ready and target config is materialized, Mobile
  enqueues `start_session`.
- [ ] Once the session starts, Mobile enqueues `send_prompt`.
- [ ] The optimistic prompt reconciles with the projected user prompt.
- [ ] Assistant waiting state reconciles with the first assistant/tool/reasoning
  progress.
- [ ] The final transcript remains visible after app reload.

### 3. New Session In Existing Workspace

Start state: authenticated user opens a ready workspace that has no active
session or wants another session.

- [ ] Open workspace detail from the workspace list or drawer.
- [ ] Tap "New session".
- [ ] Choose agent/model/config where supported.
- [ ] Send the first prompt.
- [ ] Mobile creates a pending session row immediately.
- [ ] Mobile enqueues `start_session`, then `send_prompt`.
- [ ] The pending row remaps to the projected session when the server reports
  the session id.
- [ ] Session switching continues to show the old and new sessions.

### 4. Existing Session Prompt Send

Start state: authenticated user opens an existing projected session.

- [ ] Snapshot loads before or while live stream connects.
- [ ] User types a prompt and taps send.
- [ ] Input clears synchronously.
- [ ] Optimistic user row appears immediately.
- [ ] Assistant waiting row appears immediately.
- [ ] Command status is tracked and visible only when useful.
- [ ] If command is accepted, optimistic rows reconcile with transcript events
  or projected items.
- [ ] If command is rejected, expired, superseded, or delivery fails, Mobile
  keeps the failed user row inspectable and shows the error.
- [ ] A second send cannot duplicate the same in-flight prompt.

### 5. Managed Target Materialization

Start state: workspace is live but the target config or materialized workspace
is not ready.

- [ ] Mobile identifies missing target id, target config, or AnyHarness
  workspace id before sending commands.
- [ ] Composer says exactly what is blocking send.
- [ ] Mobile does not enqueue `send_prompt` against an unmaterialized target.
- [ ] If the server returns `cloud_command_target_config_required`, Mobile
  shows a targeted remediation state rather than a generic failure.
- [ ] When materialization completes, Mobile refetches/reconnects and enables
  session start/send without a full app restart.

### 6. Shared / Unclaimed Workspace Claim

Start state: shared workspace visible to the user but not claimed.

- [ ] Workspace list and chat surface show claim state.
- [ ] Composer is disabled until claim succeeds.
- [ ] Claim action calls the real claim mutation.
- [ ] Claim success updates workspace/session state and enables composer.
- [ ] Claim failure leaves the workspace open and shows the error.
- [ ] After claim, user can send a real prompt in the same session.

### 7. Live Transcript, Snapshot Fallback, And Reload

Start state: user opens a session with existing transcript and live updates.

- [ ] Session renders from `CloudSessionEvent.envelope` when available.
- [ ] Projection fallback renders when projected items are ahead of events.
- [ ] Reloading the app preserves selected workspace/session and transcript.
- [ ] Stream reconnect resumes from the last observed sequence.
- [ ] Backgrounding during a turn and foregrounding later catches up without
  duplicate rows.
- [ ] Empty transcript states distinguish "loading", "no session", "waiting for
  first event", and "projection unavailable".

### 8. Chat Configuration

Start state: session exposes supported config controls.

- [ ] Mobile renders model/mode/session config controls from the shared cloud
  control model.
- [ ] Selecting a config value updates the visible control optimistically.
- [ ] Mobile enqueues `update_session_config` with observed event sequence.
- [ ] Pending state is visible until live config catches up.
- [ ] Accepted config reconciles without flicker.
- [ ] Rejected/expired/superseded config rolls back and shows a specific error.
- [ ] Config controls remain keyboard-safe and usable with the composer focused.

### 9. Workspace Navigation And Identity

Start state: user has multiple personal/shared workspaces across repos.

- [ ] Drawer and workspace list show all accessible workspaces in the intended
  scope.
- [ ] Rows are grouped/sorted by repo and latest activity consistently with Web.
- [ ] Opening a workspace with no sessions still shows a usable new-session
  surface.
- [ ] Branch, repo, workspace status, visibility, live/snapshot state, and
  claim state are visible from chat.
- [ ] Branch is copyable/shareable.
- [ ] Deep links open the intended workspace/session when available.

### 10. Automations

Start state: authenticated user with existing cloud automations.

- [ ] Automations screen loads real automation data.
- [ ] Empty/loading/error states are distinct.
- [ ] List rows show title, repo, schedule, target mode, enabled state, and last
  run.
- [ ] Creating a mobile-supported cloud automation succeeds end to end.
- [ ] Pause/resume/delete work where the API supports them.
- [ ] Opening an automation run routes to its workspace/session when available.
- [ ] Automation kinds that require Desktop say so precisely.

### 11. Settings And Account

Start state: authenticated user with personal account and optionally teams.

- [ ] Settings shows account identity and GitHub linked state from real data.
- [ ] Teams/organizations list loads and supports owner-scope switching if
  supported.
- [ ] Billing/plan summary loads when the API is available.
- [ ] Cloud profile, repo/profile defaults, and agent credential readiness show
  real state or an explicit unsupported state.
- [ ] Sign out works from Settings and drawer.

### 12. Mobile App Lifecycle And Failure Recovery

- [ ] App cold start, reload, foreground, and background do not lose selected
  workspace/session unexpectedly.
- [ ] Network loss pauses live updates without clearing transcript.
- [ ] Network recovery reconnects and refetches.
- [ ] Long-running provisioning remains inspectable and retryable.
- [ ] Failed workspace provisioning shows error details and leaves navigation
  usable.
- [ ] Auth expiration returns to signed-out or refresh flow without crashing.
- [ ] Keyboard open/close does not cover composer controls or final rows.
- [ ] iOS and Android both pass the same core smoke matrix.

## Ownership Model

Use mobile-native UI while sharing contracts and pure rules.

| Concern | Owner |
| --- | --- |
| Raw Proliferate Cloud requests | `@proliferate/cloud-sdk` |
| React Query hooks for cloud resources | `@proliferate/cloud-sdk-react`, with mobile additions only when generic hooks are missing |
| Mobile auth/client setup | `mobile/src/lib/access/cloud/**` and `mobile/src/providers/**` |
| Mobile navigation and shell state | `mobile/src/components/shell/**`, `mobile/src/navigation/**`, later `mobile/src/stores/**` only for shared local UI state |
| Mobile product UI | `mobile/src/components/<domain>/**` |
| Shared product rules/view models | `packages/product-model/src/**` |
| React Native design tokens | `@proliferate/design/react-native` via `mobile/src/styles/tokens.ts` |

When Desktop/Web have a DOM component and Mobile needs the same behavior, prefer
one of these clean extractions:

1. Move pure data shaping into `packages/product-model`.
2. Keep DOM rendering in `packages/product-ui` for Desktop/Web.
3. Build a React Native renderer in `mobile/src/components/**` over the same
   product-model output.

Do not create a third interpretation of command states, transcript item kinds,
workspace visibility, or session config in Mobile.

## Reliability Invariants

- User input is never allowed to disappear. Prompt text should be visible in
  the composer before submit, then in an optimistic row, then in the real
  transcript or a failed-send row.
- Command dispatch is ordered: workspace materialization before
  `start_session`, `start_session` before first `send_prompt`, config updates
  with observed sequence when a session exists.
- Runtime truth wins, but client projections must stay visible until runtime
  truth is sufficient to replace them.
- Every command has an idempotency key tied to the user action, not to a render.
- Live streams are additive and resumable; reconnects must not clear snapshot
  state or duplicate transcript rows.
- Empty states must explain the actual blocker: auth, GitHub link, no repos, no
  workspace, provisioning, no session, waiting for transcript, claim required,
  target config required, command failed, or unsupported mobile action.
- Mobile surfaces should be usable at one-hand phone widths and with the
  keyboard open. Critical actions cannot rely on hover or desktop-only menus.
- Mobile code should not hide server/API gaps with fixtures. Fixture-backed
  surfaces must be converted or explicitly marked out of scope for a phase.

## End-State Surface Map

### Auth And App Bootstrap

- [ ] Boot from SecureStore refresh token and clear stale sessions cleanly.
- [ ] Show signed-out, needs-GitHub, active, and bootstrapping states.
- [ ] Support Apple, Google, and GitHub linking.
- [ ] Clear React Query cache when the auth token changes.
- [ ] Preserve telemetry masking/blocking expectations for mobile screens.

### Mobile Shell And Drawer

- [ ] Drawer contains Home, Workspaces, Sessions, Automations, Settings, and
  account/sign-out.
- [ ] Workspace and session lists stay reachable during active chat via back or
  a sheet/menu.
- [ ] Android back closes drawer, exits chat, returns home, then lets the OS
  handle exit.
- [ ] Deep links open workspaces and, when possible, their latest session.
- [ ] Foreground/background resume refetches active workspace/session state.
- [ ] Pull-to-refresh works on list surfaces.

### Home / New Chat

Mobile home should be the mobile version of the Web new-chat flow, adapted to
small screens.

- [ ] Load configured repos with `useCloudRepoConfigs`.
- [ ] Let the user choose repository, owner scope when available, model, and
  supported mode.
- [ ] Build deterministic branch and display names from the prompt.
- [ ] Create a cloud workspace with `useCreateCloudWorkspace`.
- [ ] Persist the pending first prompt for that workspace/session handoff.
- [ ] Route immediately to the workspace shell and show a final-looking pending
  chat surface.
- [ ] When the workspace becomes ready, enqueue `start_session`, then
  `send_prompt`.
- [ ] Show provisioning, session-start, prompt-send, and command failure states.
- [ ] Keep the prompt visible optimistically throughout the handoff.

### Workspaces

- [ ] List personal, shared, unclaimed, archived, and failed workspaces with
  clear mobile status.
- [ ] Use the same scope semantics as Web/Desktop: `my` for the primary
  workspace/sidebar list, `exposed` only where "available to mobile" is the
  explicit product question.
- [ ] Sort by latest session activity, workspace activity, update time, then
  label.
- [ ] Open a workspace even when it has no sessions yet.
- [ ] Show live, materializing, failed, archived, private, shared, and
  unclaimed states.
- [ ] Support claim action where relevant.
- [ ] Expose branch/repo identity and a copy/share branch action.

### Sessions

- [ ] List all projected sessions for a workspace, not only the last summary.
- [ ] Create a new session in an existing ready workspace.
- [ ] Switch sessions inside the active workspace.
- [ ] Preserve active session selection across reload/resume.
- [ ] Render pending session rows while `start_session` is queued/running.
- [ ] Show session status, agent kind, model/config summary, and last activity.

### Chat Transcript

Mobile transcript rendering should use the same semantic row model as Web:
events first, projection fallback second.

- [ ] Use `CloudSessionEvent.envelope` plus
  `reconstructTranscriptState` when events are available.
- [ ] Fall back to projected `CloudTranscriptItem` rows when projection is ahead
  of events or events are missing.
- [ ] Render user messages, assistant prose, reasoning/thought rows, tool rows,
  grouped tool summaries, proposed plans, errors, and unknown events.
- [ ] Preserve streaming/waiting row height so prompt send does not visually
  disappear.
- [ ] Remove optimistic rows only after matching user prompt and later agent
  progress are visible.
- [ ] Support long histories with a virtualized list, not an unbounded
  `ScrollView`.
- [ ] Keep message bodies masked from telemetry.
- [ ] Refresh snapshots/events after live patches and on stream reconnect.

### Composer And Config

The composer should feel like the Desktop/Web chat input, but rendered as
native mobile controls.

- [ ] Clear the input synchronously on submit and render an optimistic user row.
- [ ] Show assistant waiting state while the command is queued or before the
  first agent progress.
- [ ] Disable sending for unclaimed workspaces, missing runtime routing, or
  in-flight duplicate sends.
- [ ] Show claim action inline when needed.
- [ ] Provide model/config controls from the same cloud composer control model
  used by Web.
- [ ] Use bottom sheets or native menus for model/mode/config selection.
- [ ] Queue `update_session_config` commands and show pending selections
  optimistically.
- [ ] Reconcile pending config when live config catches up.
- [ ] Surface rejected/expired/superseded/failed-delivery command states.
- [ ] Keep keyboard avoidance and safe-area spacing correct on iOS and Android.

### Workspace Identity Below The Composer

- [ ] Show repo, branch, workspace visibility, live/snapshot state, and claim
  state near the composer or in a compact chat details sheet.
- [ ] Branch name is copyable/shareable.
- [ ] Workspace detail opens a mobile-safe identity/details sheet.
- [ ] Desktop handoff/deep-link remains available when applicable.

### Automations

- [ ] Replace fixture automations with `useAutomations`.
- [ ] List title, repo, schedule summary, target mode, enabled/paused, and last
  run.
- [ ] Create a cloud-capable automation from mobile when the API supports the
  required create fields.
- [ ] Pause/resume/delete where the API supports it.
- [ ] Show a "Desktop required" explanation only for automation kinds that
  genuinely require local compute or native desktop capabilities.
- [ ] Opening an automation run should link to its cloud workspace/session when
  present.

### Settings

Mobile settings should expose high-level product/account controls, not the full
Desktop settings tree.

- [ ] Account identity, sign out, and GitHub linked state.
- [ ] Teams/organizations list and active owner scope selection if supported by
  cloud APIs.
- [ ] Billing/plan summary where mobile API coverage exists.
- [ ] Cloud profile basics: default repo/profile, public MCP/skill availability
  summary, and links to Desktop/Web for advanced setup.
- [ ] Agent credential readiness summary when surfaced by cloud APIs.
- [ ] App build, environment, support link, and privacy/terms links.

## Implementation Phases

### Phase 0 - Mobile Facts And API Inventory

- [ ] Inventory all mobile screens and fixture-backed surfaces.
- [ ] Inventory reusable Web cloud helpers that are browser-specific today.
- [ ] Identify which Web helpers can move to `packages/product-model` or a
  cloud SDK helper without importing DOM/browser APIs.
- [ ] Confirm whether mobile needs new cloud SDK React hooks for repo configs,
  workspace live, session events, automations mutations, or orgs.

### Phase 1 - Shared Product Rules For Cloud Chat

- [x] Move Web-only pure helpers for cloud transcript rows into
  `packages/product-model`.
- [x] Move Web-only pure helpers for cloud composer controls into
  `packages/product-model`.
- [x] Keep browser persistence, navigation, and window timers out of shared
  product logic.
- [ ] Add product-model tests for transcript event/projection fallback,
  optimistic prompt reconciliation, and config reconciliation.

### Phase 2 - Mobile New Chat And Workspace Handoff

- [x] Replace `MobileHomeScreen` prototype modes with a repo/model prompt
  surface.
- [x] Create workspace from mobile.
- [x] Persist and dispatch first prompt when workspace is ready.
- [x] Route into a pending/final-looking chat shell immediately.
- [x] Verify the full first-prompt path against a real cloud runtime.

### Phase 3 - Mobile Chat Surface

- [x] Replace the `ScrollView` transcript with a virtualized list.
- [x] Render the shared cloud transcript row view in React Native.
- [x] Add optimistic prompt rows and assistant waiting rows.
- [x] Add mobile-native composer config controls.
- [x] Add branch copy/share, workspace details, claim, and command status UI.

### Phase 4 - Workspace, Session, And Sidebar Parity

- [ ] Add workspace detail screen/sheet.
- [x] Add all-session listing for a workspace.
- [x] Add new-session creation for an existing workspace.
- [ ] Upgrade drawer/sidebar grouping and sorting to match Web semantics.
- [x] Preserve active workspace/session across reload/resume.

### Phase 5 - Automations And Settings

- [x] Wire real automation list.
- [x] Add create/pause/resume lifecycle where cloud APIs support it.
- [x] Replace static settings rows with account, teams, billing, and cloud
  profile data.
- [x] Add fallbacks for unsupported mobile-only actions.

### Phase 6 - End-To-End QA

- [ ] iOS simulator smoke.
- [ ] Android simulator smoke.
- [ ] Physical-device smoke when auth redirects or keyboard behavior change.
- [ ] Flow 1: fresh auth to ready shell.
- [ ] Flow 2: new personal cloud chat from Mobile.
- [ ] Flow 3: new session in existing workspace.
- [ ] Flow 4: existing session prompt send.
- [ ] Flow 5: managed target materialization.
- [ ] Flow 6: shared/unclaimed workspace claim.
- [ ] Flow 7: live transcript, snapshot fallback, and reload.
- [ ] Flow 8: chat configuration.
- [ ] Flow 9: workspace navigation and identity.
- [ ] Flow 10: automations.
- [ ] Flow 11: settings and account.
- [ ] Flow 12: mobile app lifecycle and failure recovery.

## Core Flow Acceptance Matrix

Use this matrix as the implementation tracker. A flow is not complete until the
manual path works against a real dev/prod-like cloud backend and the listed
coverage exists or is explicitly deferred.

| Flow | User-visible success | Minimum coverage |
| --- | --- | --- |
| Fresh auth | sign in, link GitHub, reopen still signed in | provider/auth unit coverage plus device smoke |
| New chat | workspace created, session started, first prompt answered | product workflow tests plus real cloud smoke |
| Existing session send | optimistic row, waiting row, accepted transcript | product-model reconciliation tests plus device smoke |
| Managed target materialization | disabled send until routing ready, then send works | command-blocker tests plus real materialization smoke |
| Claim | claim enables composer and prompt send | mutation handling tests plus shared workspace smoke |
| Live/reload | no duplicate/missing rows after reconnect/reload | transcript event/projection tests plus lifecycle smoke |
| Config | optimistic config, accepted reconcile, rejected rollback | product-model config tests plus real command smoke |
| Navigation | drawer/list/deep link open correct workspace/session | navigation model tests plus device smoke |
| Automations | real list and create/edit where supported | cloud hook tests plus API smoke |
| Settings | real account/team/billing/profile state | query handling tests plus account smoke |

## Verification Commands

Run these before calling an implementation slice done:

```bash
pnpm --filter @proliferate/mobile typecheck
pnpm --filter @proliferate/product-model test
```

For app runtime smoke:

```bash
pnpm --filter @proliferate/mobile start
pnpm --filter @proliferate/mobile ios
pnpm --filter @proliferate/mobile android
```

For full-stack local testing, use a dev profile instead of default ports:

```bash
make dev-init PROFILE=<name>
make dev PROFILE=<name>
```

## Open Questions

- Should Mobile support organization-owned workspace creation in the first
  implementation pass, or personal owner scope only?
- Which automation create/edit fields are mobile-safe for v1, and which should
  remain Desktop/Web-only?
- Do mobile chat config controls use a single bottom sheet for all controls or
  one sheet per control?
- Should branch copy use clipboard only, share sheet only, or both?
- Is push notification support in scope for long-running mobile cloud sessions,
  or does foreground/resume polling satisfy v1?

## Definition Of Done

The mobile cloud client is done when a signed-in user can start from an empty
app, create a cloud workspace from the mobile home screen, send a real first
prompt, watch live transcript updates, change supported chat config, create or
switch sessions, claim shared work, inspect workspaces and automations, and
reopen the app without losing the active workspace/session context.
