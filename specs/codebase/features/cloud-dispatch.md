# 08 — Web / Mobile / Dispatch UX

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`sandbox-provisioning.md`](../primitives/sandbox-provisioning.md),
[`settings-admin-ia.md`](settings-admin-ia.md),
[`cloud-commands.md`](../primitives/cloud-commands.md),
[`claiming.md`](../primitives/claiming.md).

Web and mobile become first-class Cloud-mediated clients of the
command/exposure/projection substrate. Desktop gains user verbs to
expose local work to Cloud, hand off to web/mobile, and direct-attach
to claimed shared cloud work. A small Cowork API key surface
exposes the same substrate to programmatic callers.

## 1. Purpose & Scope

In scope:

- Live React hooks (`useSessionLive`, `useWorkspaceLive`,
  `useTargetLive`) wrapping the existing SSE primitives so web and
  mobile UI can render real-time transcripts without raw imperative
  subscriptions.
- Exposure-aware workspace listing on web and mobile. Web/mobile
  see only work with active `cloud_workspace_exposure`.
- Web/mobile workspace UI: session list, transcript view, prompt
  input (Cloud command path), claim action, "Open in Desktop" CTA.
- Mobile cuts over from fixture data to the live Cloud SDK.
- Desktop user verbs: **Continue remotely**, **Open in web**,
  **Open on mobile**, and (for claimed shared cloud work) **Open
  in Desktop (direct)**. Verbs are gated by the access helpers
  from spec 05.
- Desktop workspace sidebar enhancements: render
  `origin` / `exposure_state` / `sandbox_type` (spec 03 §5.3
  vocabulary) on each row + a small "tracked / live / paused /
  stale" badge from the exposure model (spec 04 §5.3).
- Deep links: `https://app.proliferate.ai/workspaces/{id}` for
  web, `proliferate://workspaces/{id}` for Desktop, universal
  links / app links for mobile.
- Cowork API: per-user and per-org API keys with a tiny new
  `cloud_api_key` table. Auth middleware accepts cowork tokens
  on every existing Cloud API. Programmatic callers pass
  `auto_cascade=true` on stale-state launches (spec 04 §10 decision #4).
- Add `ssh` to the `SidebarWorkspaceVariant` enum and surface SSH
  targets in the sidebar.

Out of scope:

- Push notifications (APNs, FCM). Spec 08 adds typed events that a push system
  can consume, but no push infrastructure.
- Token-by-token live streaming on web/mobile. V1 uses the
  existing session-patch SSE flow; on-turn updates are sufficient
  for the UI. (Live token streams are bandwidth-heavy and add
  reconnect complexity.)
- Web/mobile direct AnyHarness access. Cloud-mediated only.
- Cross-org workspace sharing (out of roadmap).
- A new web/mobile auth model. Existing OAuth PKCE flows (web
  cookie + CSRF; mobile in-memory) are preserved unchanged.
- A web/mobile settings shell beyond what `/settings` already
  has. Spec 03 covers Desktop Settings; web/mobile Settings are
  thin views of the same data and follow the same admin gating
  but do not gain new pages in V1.
- A migration / move flow. Spec 10 owns that surface; the
  "Move to another target" CTA appears only when spec 10 ships.

## 2. Mental Model

```text
clients
  Desktop                  direct AnyHarness for local;
                           Cloud commands for cloud-mediated;
                           direct-attach JWT for claimed shared cloud
  Web                      Cloud-mediated only
  Mobile                   Cloud-mediated only
  Cowork API caller        Cloud-mediated only

what's the same across all
  cloud_workspace_exposure        admission policy (spec 04)
  cloud_session_projection        what's projected (spec 04)
  cloud_commands                  one queue (specs 04 + 06 + 07)
  cloud_workspace_claim           one-way ownership (spec 05)
  cloud_agent_run_config          how the agent runs (spec 06 §5.3)
  cloud_target_runtime_access     where AnyHarness lives (spec 00)

what's different per client
  Desktop                  rich (file browser, terminal, direct AH)
  Web                      light (transcript, prompt, claim, view files via web)
  Mobile                   lightest (transcript, prompt, claim, push later)
  Cowork API               programmatic (create work, send_prompt, poll status)
```

The unifying rule: **every non-local workspace listing comes from
`cloud_workspace_exposure`.** If there is no exposure row, the
workspace is invisible to web/mobile/Cowork. Spec 05 owns the
claim path on shared work; spec 04 owns the exposure model. Spec
08 is the UX layer.

Three Desktop verbs map to existing substrate operations:

```text
"Continue remotely"      Desktop creates / upgrades a
                         cloud_workspace_exposure for a local
                         workspace with visibility='private',
                         commandable=true, level='live'.
                         Worker (Desktop's local supervisor)
                         backfills events; web/mobile can now see
                         + send prompts.

"Open in web"            Generate https://app.proliferate.ai/workspaces/{id}
                         deep link. Opens web app, signs in if
                         needed, navigates to the session.

"Open on mobile"         Generate a universal link with the same
                         path. If mobile app is installed, opens
                         there; else web fallback.

"Open in Desktop (direct)"  (claimed shared cloud only)
                         Desktop calls spec 05's
                         POST /workspaces/{id}/direct-access-token,
                         opens a shared_cloud runtime location
                         (spec 05 §5.6 / Desktop file change).
```

## 3. Dependencies

Hard:

- Spec 00: `cloud_target_runtime_access` (Desktop reads
  AnyHarness URL for direct-attach); workspace `sandbox_type`
  derived field (spec 04 §5.7).
- Spec 03: vocabulary enums, sidebar primitives, and UI admin-gate
  affordances such as `useIsAdmin(org)`.
- Spec 04: `cloud_workspace_exposure`, `cloud_session_projection`
  with `projection_level` + `commandable`; SSE patches; passive
  UI invariant.
- Spec 05: claim verb + direct-attach token endpoint;
  `X-Client-Kind: desktop` gate; JWKS.

Soft:

- Spec 06: web/mobile show automation-origin badge using the
  enum from spec 06.
- Spec 07: Slack-origin badge.
- Spec 09: billing-blocked state surfaces in web/mobile via the
  existing readiness panel; spec 08 hooks the indicator.
- Spec 10: "Move to another target" CTA appears only when
  migration ships.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What is shipped

**Web app** at `apps/web/` (Vite + React):

```text
Pages: HomePage, WorkspacesPage, ChatPage, AutomationsPage,
       PluginsPage, SettingsPage, SupportPage,
       AuthCallbackPage, AuthErrorPage, DesktopHandoffPage

Cloud API: WebCloudProvider wraps @tanstack/react-query
           QueryClientProvider + CloudClientProvider
           Hooks from @proliferate/cloud-sdk-react
             (e.g. useCloudWorkspaces in WorkspacesScreen)
```

Web is partially wired: it lists workspaces today. It does NOT
have a `usePublishedSessionPatches`-style hook over the SSE
primitives; transcript views are not live.

**Mobile app** at `apps/mobile/` (React Native /
Expo, EAS):

```text
Screens: MobileWorkspacesScreen, MobileChatScreen,
         MobileHomeScreen, MobileSessionsScreen,
         MobileAutomationsScreen, MobileSettingsScreen
Auth: PKCE OAuth + Apple Sign-In
Workspaces screen: renders from fixture data
                    (`mobile-fixtures.ts`), not Cloud API
```

**Cloud SDK** at `cloud/sdk/`:

```text
Clients: auth, agent-auth, automations, billing, commands, compute,
         config, credentials, events, live, mobility, organizations,
         repo-configs, repos, sessions, targets, workspaces,
         worktree-policy, mcp_*

SSE primitive: cloud/sdk/src/streams/sse.ts
  subscribeCloudSse(url, signal, onEvent)
  pumps text/event-stream via ReadableStream

Live wrappers: cloud/sdk/src/client/live.ts
  subscribeSession   /v1/cloud/sessions/{id}/stream
  subscribeWorkspace /v1/cloud/workspaces/{id}/stream
  subscribeTarget    /v1/cloud/targets/{id}/stream
```

**SDK-React** at `cloud/sdk-react/`:

```text
sessions.ts, workspaces.ts, etc. — useQuery one-shot snapshots
live.ts — re-exports subscribeSession/Workspace/Target raw fns
NO React hooks around live subscriptions.
```

**Server live**
(`server/proliferate/server/cloud/live/`):

```text
service.py
  publish_session_patch(patch) -> Redis pub/sub
  channels: session_channel(target_id, session_id)
            workspace_channel(workspace_id)
api.py
  GET /sessions/{id}/stream   text/event-stream
  GET /workspaces/{id}/stream
  GET /targets/{id}/stream
  emits: snapshot on connect; then patch / command_status /
         heartbeat events
```

No WebSocket endpoint anywhere.

**Workspace sidebar**
(`apps/desktop/src/components/workspace/shell/sidebar/MainSidebar.tsx`):

```text
SidebarWorkspaceVariant = 'local' | 'worktree' | 'cloud'
                          -- no 'ssh' variant
DEFAULT_SIDEBAR_WORKSPACE_TYPES = ['local','worktree','cloud']
detailIndicatorsForWorkspace():
  emits 'materialization' indicator (local/worktree/cloud tooltip)
  emits 'automation' indicator on automation-origin or
                                  branch-pattern match
  emits 'agent' indicator on origin?.kind === 'cowork'
context menu (use-workspace-sidebar-native-context-menu.ts):
  Rename, Delete workspace, Archive, Unarchive
  -- no Continue remotely / Open in web / Open on mobile
```

**Cowork-as-origin** already exists. Workspace origin kinds:
`'human' | 'cowork' | 'api' | 'system'`. Entrypoint:
`'desktop' | 'cloud' | 'local_runtime' | 'cowork'`. Cowork is a
provenance marker today, not a separate API surface.

**Auth surfaces**: `'web' | 'mobile' | 'desktop'` via OAuth PKCE.
Web uses HttpOnly refresh cookie + CSRF; mobile uses in-memory
access token; Desktop uses bearer.

**Existing deep links** (Desktop):

```text
proliferate://settings/cloud   Stripe billing return
proliferate://                 DesktopHandoffPage after web auth
```

No workspace deep links today.

**Mobility tables** (`CloudWorkspaceMobility`,
`CloudWorkspaceHandoffOp`): `local_to_cloud` and `cloud_to_local`
handoffs for the user's own workspaces. **Not** a direct-attach
for shared cloud work; that is spec 05.

### 4.2 Gaps spec 08 closes

- No live React hooks; web/mobile transcripts aren't streaming.
- No "Continue remotely" / "Open in web" / "Open on mobile"
  verbs.
- No workspace deep-link generation.
- No "Open in Desktop (direct)" wiring for claimed shared work
  (Desktop side of spec 05).
- Sidebar lacks origin / exposure / sandbox_type indicators;
  no SSH variant.
- Mobile uses fixtures, not live API.
- No Cowork API key model.
- No push notifications. Spec 08 emits a typed event that a push surface can
  consume.

## 5. Target Model

### 5.1 Live subscription React hooks

New file: `cloud/sdk-react/src/hooks/live.ts` (replace the
re-export shim with real hooks).

```text
useSessionLive(sessionId: string, options?)
  -> {
       snapshot: CloudSessionSnapshot | undefined,
       lastPatchAt: Date | undefined,
       isConnected: boolean,
       error: Error | undefined,
     }
  internals:
    open EventSource via subscribeCloudSse on mount
    snapshot from first 'snapshot' event
    apply 'patch' events into snapshot via pure reducer
    'command_status' events surface separately via secondary hook
    'heartbeat' resets a watchdog timer
    on disconnect: bounded exp backoff reconnect; surface
                   isConnected=false during gap

useWorkspaceLive(workspaceId: string, options?)
  same shape; subscribes to workspace stream

useTargetLive(targetId: string, options?)
  same shape; subscribes to target stream

useCommandStatus(commandId: string, options?)
  derives command_status events from the session/workspace stream
  for the matching command_id
```

Hook lifecycle:

```text
- enabled gate: if the caller doesn't have permission to view, the
  hook stays inert (no SSE open). Permission comes from the
  surrounding query that loaded the snapshot in the first place.
- React Query interop: snapshot is mirrored into the React Query
  cache for the session/workspace, so unrelated useQuery callers
  see the fresh data without their own subscription.
- StrictMode-safe: single subscription per (id, session_kind)
  across all hook callers in the tree.
- Auto-cleanup on unmount with debounce so navigation doesn't
  thrash the SSE connection.
```

Pure reducer: `cloud/sdk-react/src/hooks/live/reducer.ts`. Takes
a snapshot + a patch and produces a new snapshot. No I/O. Unit-
tested with the existing patch envelope shapes.

The raw `subscribeSession` etc. functions stay exported from the
SDK for non-React callers; the new React hooks wrap them.

### 5.2 Exposure-aware workspace listing

Web and mobile list only work with active `cloud_workspace_exposure`.
The existing `GET /v1/cloud/workspaces` endpoint already filters by
org/personal scope; spec 08 extends the response shape and the
listing scopes.

```text
GET /v1/cloud/workspaces?scope=my            (spec 05 §5.8)
GET /v1/cloud/workspaces?scope=unclaimed     org_id required
GET /v1/cloud/workspaces?scope=claimable     alias of unclaimed
GET /v1/cloud/workspaces?scope=org-all       admin only
GET /v1/cloud/workspaces?scope=exposed       NEW: all work I can
                                              view via Cloud right now
                                              = scope=my ∪ scope=unclaimed
```

`scope=exposed` is the default for web/mobile home/workspaces
page. It returns workspaces with an active exposure where the
caller can `can_view_cloud_workspace` (spec 05 §5.7).

Response per workspace includes:

```text
- exposure: { id, visibility, claimed_by_user_id,
              default_projection_level, commandable, status }
- origin                                  (typed enum; spec 04 §5.7)
- sandbox_type                            (computed; spec 04 §5.7)
- exposure_state                          (computed; spec 04 §5.7)
- last_activity_at
- last_session_summary (title + status + most recent message
                          preview) for cheap list rendering
```

`last_session_summary` is a tiny denormalized read-model on the
existing `cloud_session_projection` row; it doesn't need a new
column.

### 5.3 Send prompt from web / mobile

Web and mobile send prompts via the existing `POST /v1/cloud/commands`
substrate. The composer in `WorkspacesScreen` / `MobileChatScreen`
builds:

```text
{
  target_id,
  workspace_id (anyharness id),
  cloud_workspace_id,
  session_id (anyharness id),
  cloud_session_id,
  kind: 'send_prompt',
  source: 'web' | 'mobile',
  actor_kind: 'user',
  payload: {
    prompt_text,
    sandbox_profile_id,
    required_runtime_config_revision,
    required_agent_auth_revision,
  }
}
```

Source values `'web'` and `'mobile'` already exist in
`cloud_commands.source` (verified in spec 07 probe). The spec 04
preflight is fail-fast on stale runtime config / agent auth for
web and mobile, matching the per-source decision from spec 04 §10
decision #4. Web/mobile UI surfaces the stale-state error with a
"Configure your sandbox" CTA that deep-links to Settings → Compute
in Desktop (or shows a "Open in Desktop" affordance if mobile
can't fix the config locally).

### 5.4 Claim action UI

Web and mobile call spec 05's `POST /v1/cloud/workspaces/{id}/claim`
endpoint when the user clicks "Claim this work" on a
`shared_unclaimed` workspace. Spec 05's one-way semantics apply:
no release button.

Web/mobile do NOT call `POST /direct-access-token` — that endpoint
is `X-Client-Kind: desktop` only (spec 05 §5.6). Web/mobile
continue to drive the claimed workspace through Cloud commands.

### 5.5 Desktop "Continue remotely" verb

Desktop user clicks "Continue remotely" on a local workspace.

Server creates or upgrades the workspace's
`cloud_workspace_exposure`:

```text
POST /v1/cloud/workspaces/{cloud_workspace_id}/exposure
  body: {
    visibility: 'private',
    default_projection_level: 'live',
    commandable: true,
  }
  exists in spec 04 §5.11; spec 08 wires the Desktop caller.
```

Two cases:

```text
1. The workspace already has a cloud_workspace row + a Desktop
   worker enrolled (the Desktop runtime acts as a local target).
   The exposure write triggers backfill via
   backfill_exposed_workspace (spec 04 §5.5 rename; spec 04
   §10 decision #5).

2. The workspace is local-only and has no cloud_workspace row.
   Desktop first creates a cloud_workspace via
   POST /v1/cloud/workspaces (managed by the Desktop dispatch
   target — see CloudWorkspaceMobility flow). Then the same
   exposure call.
```

Acceptance: clicking "Continue remotely" on a fresh local-only
workspace produces a cloud_workspace + active exposure within
3-5s; subsequent web/mobile listing shows the workspace.

UI behavior:

```text
context menu adds:
  - "Continue remotely" (when exposure does not exist)
  - "Disable remote access" (when exposure exists)
  - "Open in web"           (when exposure exists)
  - "Open on mobile"        (when exposure exists)
```

`Disable remote access` patches the exposure to
`status='paused'` (spec 04 §5.3) or `archived_at=now`. Worker
stops tailing per spec 04 §5.5.

### 5.6 Deep links

Two schemes:

```text
proliferate://workspaces/{cloud_workspace_id}
  Desktop URL scheme. Opens the workspace in Desktop.
  If Desktop is not running, the OS opens it via deep link.

https://app.proliferate.ai/workspaces/{cloud_workspace_id}
  Universal link / app link. Opens mobile app if installed;
  else falls back to the web app.
```

Generation:

```text
apps/desktop/src/lib/domain/workspaces/deep-links.ts            (new)
  webWorkspaceDeepLink(workspaceId): string
  mobileWorkspaceDeepLink(workspaceId): string  -- same as web
                                                    (universal link)
  desktopWorkspaceDeepLink(workspaceId): string

cloud/sdk/src/client/deep-links.ts                         (new; shared)
  -- pure functions; web/mobile use the same module
```

Desktop "Open in web" copies `web link` to clipboard AND opens it
in the browser; "Open on mobile" copies the universal link and
shows a QR code modal for the user's phone.

Web app's `/workspaces/{id}` route resolves the workspace,
applies `can_view_cloud_workspace` (spec 05 §5.7), and renders
the workspace.

Desktop ships default shortcuts for the web handoff verbs:

- `Cmd+Option+W` on macOS / `Ctrl+Alt+W` elsewhere opens the current
  workspace in the web app when the workspace has a Cloud link.
- `Cmd+Option+S` on macOS / `Ctrl+Alt+S` elsewhere starts or resumes
  remote-access sync for the current workspace so it becomes available from
  web.
- `Cmd+Ctrl+W` on macOS / `Ctrl+Alt+Shift+W` elsewhere opens the web app
  without targeting a workspace.

Mobile app handles `https://app.proliferate.ai/workspaces/{id}`
via universal link / app link config:

```text
apps/mobile/app.json (Expo)
  ios.associatedDomains: ['applinks:app.proliferate.ai']
  android.intentFilters: [
    { action: 'VIEW', data: { scheme: 'https',
                              host: 'app.proliferate.ai',
                              pathPrefix: '/workspaces/' } }
  ]
```

If the user is not signed in on the mobile app, the link routes
through the existing OAuth PKCE flow, then to the workspace
after `bootstrapMobileSession`.

### 5.7 Desktop "Open in Desktop (direct)" for claimed shared work

Spec 05 defines the JWT and the AnyHarness scope check. Spec 08
wires the Desktop client:

```text
apps/desktop/src/hooks/access/cloud/claims/use-direct-attach-token.ts
  (spec 05 introduced; spec 08 wires UI callers)

apps/desktop/src/lib/access/anyharness/runtime-target.ts
  new runtime location 'shared_cloud':
    {
      kind: 'shared_cloud',
      cloud_workspace_id,
      anyharness_base_url,    from cloud_target_runtime_access
      bearer_token,           the JWT
      jti,                    for in-memory revocation cache
    }
  fetched lazily via use-direct-attach-token; refreshed before exp.

apps/desktop/src/components/workspace/*  CTA visibility:
  show "Open in Desktop (direct)" ONLY when:
    - workspace.exposure.visibility === 'claimed'
    - claim.claimed_by_user_id === current user
    - workspace.sandbox_type in ('managed_personal','managed_shared')
    - sandbox is running (per cloud_target_runtime_access)
```

The verb opens the workspace using the `shared_cloud` runtime
location — Desktop talks to the shared sandbox's AnyHarness over
HTTP with the JWT. Spec 05 §5.5 enforces scope and permission
server-side.

### 5.8 Workspace sidebar enhancements

`SidebarWorkspaceVariant` extends:

```text
'local' | 'worktree' | 'ssh' | 'cloud'

cloud subdivides via SidebarCloudVariant:
  'personal_cloud' | 'shared_cloud'

detailIndicatorsForWorkspace():
  - 'materialization' (unchanged)
  - 'automation'      (unchanged)
  - 'agent'           (unchanged; origin.kind === 'cowork')
  - 'slack'           (new; origin === 'slack')
  - 'exposure'        (new; renders exposure_state badge)
    states: 'tracked' | 'live' | 'paused' | 'stale' | 'revoked'
  - 'claimed'         (new; visibility === 'claimed' AND user is
                           claimer / admin)
  - 'shared_unclaimed' (new; visibility === 'shared_unclaimed')
```

The sidebar uses spec 03 §5.3 vocabulary verbatim. Display labels
come from spec 03's `vocabulary-copy.ts`.

Sidebar filters (existing surface):

```text
- All
- Personal
- Shared (org)         (new; uses scope=org-all if admin, else scope=exposed
                        filtered by visibility != 'private')
- Unclaimed            (new; scope=unclaimed; admin or member)
```

### 5.9 Cowork API

Small new surface for programmatic callers. Reuses
`cloud_commands.actor_kind='api_key'` and `source='api'` which
already exist.

```text
cloud_api_key                                                  (new)
  id                              uuid pk
  owner_scope                     'personal' | 'organization'
  owner_user_id                   uuid                          nullable
  organization_id                 uuid                          nullable
  created_by_user_id              uuid                          NOT NULL

  name                            text                          NOT NULL
  key_prefix                      text                          NOT NULL
                                  -- first 12 chars of the public key
                                     (e.g. "pk_live_abc") for display
  key_hash                        text                          NOT NULL
  hash_key_id                     text                          NOT NULL
  scopes_json                     jsonb                         NOT NULL default '[]'
                                  -- explicit capabilities, never blanket
                                     org-admin authority

  status                          'active' | 'revoked'          NOT NULL
  last_used_at                    timestamptz                   nullable
  expires_at                      timestamptz                   nullable
  revoked_at                      timestamptz                   nullable
  revoked_by_user_id              uuid                          nullable

  created_at                      timestamptz                   NOT NULL

  UNIQUE (key_hash)
  CHECK ck_cloud_api_key_owner_fields
  CHECK ck_cloud_api_key_status
```

Token format:

```text
public_token = pk_live_<random>            -- shown ONCE on create; never stored
                                            -- key_hash = hmac(cloud_secret_key, token)
                                            -- key_prefix = first 12 chars
```

Auth middleware extension
(`server/proliferate/server/auth/middleware.py` or wherever the
bearer middleware lives):

```text
classify bearer:
  starts with 'pk_'  -> cowork API key path
                       lookup by hmac(token); reject if not active /
                       expired / revoked
                       set actor: cloud_api_key.owner (user or org)
                       set actor_kind = 'api_key'
                       update last_used_at (async / debounced)
  otherwise          -> existing OAuth bearer path
```

API endpoints:

```text
POST   /v1/cloud/api-keys
  body: { name, owner_scope, expires_at?, scopes? }
  response: { id, public_token, key_prefix, ... }   -- token shown ONCE

GET    /v1/cloud/api-keys                            list keys for caller
DELETE /v1/cloud/api-keys/{id}                       revoke

POST   /v1/cloud/organizations/{org}/api-keys
  body: { name, expires_at?, scopes? }
  response: same shape; server requires active org role in
            organization_admin_roles()
```

Authorization:

```text
- personal API key: acts as the owner; same scope as their OAuth
  session, bounded by scopes_json
- org API key: acts as an org-scoped cowork actor, bounded by
  scopes_json. It is NOT equivalent to an org admin.
- V1 scopes:
    cloud.workspaces:read
    cloud.commands:create
    cloud.commands:read
    cloud.exposures:read
  Future scopes must be explicitly added; API keys never receive
  billing, organization-settings, agent-auth, MCP/publicization, or
  direct-attach privileges by default.
- creating an org API key requires active org role in
  organization_admin_roles()
- API keys cannot call the direct-attach endpoint (spec 05) or
  per-token revoke (spec 05); X-Client-Kind: desktop is still
  required

cowork callers may opt-in to auto-cascade for stale runtime
config / agent auth via a query param on launch commands:

  POST /v1/cloud/commands?auto_cascade=true
  body: { kind: 'start_session', ... }

  if stale: server cascades materialize_environment / refresh_agent_auth
            first, then the requested command; bounded retries; on
            failure: typed error returned via command status polling
```

This matches the per-source posture from spec 04 §10 decision #4:
fail-fast for Desktop/Web/Mobile by default; auto-cascade as
opt-in for API callers.

UI for managing API keys: lands as a section in Settings →
Account or Settings → Organization (admin) — spec 03 frame slot;
spec 08 adds the content.

### 5.10 Mobile: cut over from fixtures

Mobile workspace screen wiring:

```text
apps/mobile/src/screens/MobileWorkspacesScreen.tsx
  replace mobile-fixtures.ts read with:
    useCloudWorkspaces({ scope: 'exposed' })
  render exposure / origin / sandbox_type indicators
  show "Claim" button for shared_unclaimed
  show "Open in Desktop" deep-link CTA for richer flows

apps/mobile/src/screens/MobileChatScreen.tsx
  useSessionLive(sessionId)
  prompt input -> POST /v1/cloud/commands (source='mobile')
  show command status from useCommandStatus

apps/mobile/src/screens/MobileSessionsScreen.tsx
  list sessions for the workspace; useWorkspaceLive

apps/mobile/src/lib/fixtures/                                     keep for tests
apps/mobile/src/lib/access/cloud/                                 use existing SDK
```

Mobile keeps its in-memory token model. No push notifications in
V1.

### 5.11 Push notifications

Spec 08 does NOT add APNs / FCM infrastructure. It does emit a
typed event a push surface can consume:

```text
post-session-event registry (spec 07 §5.8) already exists.
A push surface registers a processor that:
  - looks up affected users (claimer for claimed; org members for
    shared_unclaimed)
  - looks up their device tokens (future table)
  - posts via APNs/FCM
```

The hook exists so a push system can consume the typed events when that surface
has an owner.

### 5.12 SSH variant in `SidebarWorkspaceVariant`

```text
SidebarWorkspaceVariant = 'local' | 'worktree' | 'ssh' | 'cloud'

DEFAULT_SIDEBAR_WORKSPACE_TYPES = ['local','worktree','ssh','cloud']

detailIndicatorsForWorkspace():
  'ssh' tooltip: "SSH · runs on a remote machine"

CloudTarget.kind='ssh' workspaces map to SidebarWorkspaceVariant='ssh'
```

Spec 03 §5.3 vocabulary already includes `ssh`; spec 08 wires it
into the sidebar.

## 6. Files To Change

Server (Python):

```text
server/proliferate/db/models/cloud/api_keys.py                       (new)
  CloudApiKey

server/alembic/versions/<NEW>_cowork_api_keys.py

server/proliferate/db/store/cloud_api_keys.py                        (new)
  insert / list_for_owner / lookup_by_hash / revoke

server/proliferate/server/auth/middleware.py
  classify bearer; cowork API key path

server/proliferate/server/cloud/api_keys/                            (new)
  api.py        CRUD endpoints
  service.py    token mint + hash + persist
  models.py     pydantic
  access.py     personal/org gates (admin for org)

server/proliferate/server/cloud/commands/api.py
  honor ?auto_cascade=true for source='api' commands

server/proliferate/server/cloud/commands/service.py
  auto_cascade handler for runtime_config_stale and
  agent_auth_stale; bounded retries
  (mirrors spec 06's cascade for automations; the helper is
   shared)

server/proliferate/server/cloud/workspaces/api.py
  GET ?scope=exposed (alias / new endpoint)
  workspace responses include exposure + last_session_summary

server/proliferate/server/cloud/live/api.py
  no schema change; spec 08 adds React hook callers

server/proliferate/config.py
  no cloud_api_key_env in V1; token prefix is `pk_live_`
```

Cloud SDK + SDK-React:

```text
cloud/sdk/src/client/api-keys.ts                                     (new)
cloud/sdk/src/client/deep-links.ts                                   (new)
cloud/sdk/src/client/workspaces.ts
  add scope=exposed; response shape extension

cloud/sdk-react/src/hooks/live.ts                                    (rewrite)
  useSessionLive, useWorkspaceLive, useTargetLive, useCommandStatus
cloud/sdk-react/src/hooks/live/reducer.ts                            (new; pure)
cloud/sdk-react/src/hooks/api-keys.ts                                (new)
```

Desktop:

```text
apps/desktop/src/lib/domain/workspaces/sidebar/sidebar-model.ts
  add 'ssh' variant; add 'personal_cloud'/'shared_cloud' subkinds

apps/desktop/src/lib/domain/workspaces/sidebar/sidebar-indicators.ts
  add slack / exposure / claimed / shared_unclaimed indicators

apps/desktop/src/lib/domain/workspaces/deep-links.ts                      (new)

apps/desktop/src/hooks/cowork/use-continue-remotely.ts                    (new)
apps/desktop/src/hooks/cowork/use-disable-remote-access.ts                (new)
apps/desktop/src/hooks/cowork/use-open-in-web.ts                          (new)
apps/desktop/src/hooks/cowork/use-open-on-mobile.ts                       (new)
apps/desktop/src/hooks/cowork/use-open-direct-attach.ts                   (new;
  consumes use-direct-attach-token from spec 05)

apps/desktop/src/components/workspace/shell/sidebar/
  use-workspace-sidebar-native-context-menu.ts
    add the four new verbs with visibility gates

apps/desktop/src/lib/access/anyharness/runtime-target.ts
  add 'shared_cloud' runtime location (spec 05 §5.6)

apps/desktop/src/components/settings/panes/account/
  ApiKeysSection.tsx                                                 (new)

apps/desktop/src/components/settings/panes/organization/
  OrganizationApiKeysSection.tsx                                     (new; admin)
```

Web:

```text
apps/web/src/pages/WorkspacesPage.tsx
  list with scope=exposed
  exposure / claim / origin badges

apps/web/src/pages/ChatPage.tsx
  useSessionLive for transcript
  prompt composer -> POST commands with source='web'

apps/web/src/components/workspaces/
  ClaimButton.tsx                                                    (new)
  RemoteAccessBadge.tsx                                              (new)
  WorkspaceListItem.tsx                                              extend

apps/web/src/pages/SettingsPage.tsx
  Account > API Keys section
  Organization > API Keys section (admin)

apps/web/src/lib/deep-links.ts                                            (new)
```

Mobile:

```text
apps/mobile/src/screens/MobileWorkspacesScreen.tsx
  replace fixtures with useCloudWorkspaces({ scope: 'exposed' })

apps/mobile/src/screens/MobileChatScreen.tsx
  useSessionLive
  prompt composer

apps/mobile/src/screens/MobileSessionsScreen.tsx
  live updates

apps/mobile/app.json
  associatedDomains: ['applinks:app.proliferate.ai']
  android intentFilters for https://app.proliferate.ai/workspaces/

apps/mobile/src/lib/deep-links.ts                                         (new)

apps/mobile/src/lib/fixtures/mobile-fixtures.ts                           kept for tests only
```

## 8. Acceptance Criteria

1. `useSessionLive`, `useWorkspaceLive`, `useTargetLive`, and
   `useCommandStatus` exist in `cloud/sdk-react/src/hooks/live.ts`
   with the documented shape.
2. Hooks mirror snapshots into the React Query cache and handle
   reconnect with bounded exponential backoff.
3. `GET /v1/cloud/workspaces?scope=exposed` returns workspaces
   the caller can view with active exposure. The default scope
   for web/mobile workspace lists is `exposed`.
4. Workspace responses include `exposure`, `origin`,
   `sandbox_type`, `exposure_state`, and `last_session_summary`.
5. Web `WorkspacesPage` and mobile `MobileWorkspacesScreen` list
   from `useCloudWorkspaces({ scope: 'exposed' })`; mobile no
   longer renders from fixtures.
6. Web `ChatPage` and mobile `MobileChatScreen` use
   `useSessionLive` for the transcript and `POST /v1/cloud/commands`
   for prompts. `source` is `'web'` or `'mobile'`.
7. Claim button on `shared_unclaimed` workspaces calls
   `POST /v1/cloud/workspaces/{id}/claim` (spec 05). Web and
   mobile do not call `direct-access-token`.
8. Desktop context menu adds **Continue remotely**, **Disable
   remote access**, **Open in web**, **Open on mobile**, and
   **Open in Desktop (direct)** with the visibility gates from
   §5.5 / §5.7.
9. "Continue remotely" produces an active
   `cloud_workspace_exposure` for the workspace (creates the
   `cloud_workspace` row first when needed). Web/mobile listing
   sees the workspace within one polling/SSE cycle.
10. Deep links:
    - `proliferate://workspaces/{id}` opens Desktop on the
      workspace
    - `https://app.proliferate.ai/workspaces/{id}` opens mobile
      via universal link if installed, else web
    - "Open in web" copies the URL and opens it
    - "Open on mobile" shows the URL as a QR code + copies
      to clipboard
11. "Open in Desktop (direct)" appears only when:
    - exposure.visibility = 'claimed' by current user
    - sandbox_type in ('managed_personal','managed_shared')
    - cloud_target_runtime_access exists for the target
    The verb fetches a fresh JWT (spec 05) and opens the
    workspace using the new `shared_cloud` runtime location.
12. `SidebarWorkspaceVariant` includes `'ssh'`. Sidebar emits
    the new origin/exposure/claim indicators using spec 03 §5.3
    vocabulary.
13. `cloud_api_key` table exists; tokens are stored as HMAC
    hash; the raw token is shown to the caller exactly once on
    create.
14. Bearer middleware classifies tokens: `pk_` prefix routes
    through the cowork lookup; otherwise the existing OAuth
    bearer path. Stale / revoked / expired keys return 401.
15. `POST /v1/cloud/commands?auto_cascade=true` cascades stale
    runtime_config / agent_auth materialization before the
    requested command. Cascade attempts capped per
    `settings.cowork_api_cascade_max_attempts`. Failure returns
    a typed error via the command status path.
16. Org-scoped cowork API key creation is enforced server-side by
    active org role in `organization_admin_roles()`. Web/mobile/
    Desktop hide the creation UI unless `useIsAdmin(org)` is true,
    but UI gating is not the security boundary.
17. Push notifications are NOT shipped in this spec. The
    post-session-event registry (spec 07 §5.8) remains the
    integration point for a future push spec.
18. `last_session_summary` in workspace responses is derived
    from existing `cloud_session_projection` rows; no new
    column.
19. Disable remote access patches exposure to
    `status='paused'` (or `archived_at=now`). Worker stops
    tailing per spec 04 §5.5; web/mobile listing drops the
    workspace within one SSE cycle.
20. The Desktop verb to migrate / move workspaces does NOT
    appear unless spec 10 has shipped.

## 9. Verification / Tests

Server:

```bash
cd server
uv run pytest -q
```

Targeted server tests:

```text
server/tests/cloud/workspaces/test_scope_exposed.py
server/tests/cloud/workspaces/test_response_includes_exposure.py
server/tests/cloud/workspaces/test_response_includes_last_session_summary.py
server/tests/cloud/commands/test_auto_cascade_runtime_config.py
server/tests/cloud/commands/test_auto_cascade_agent_auth.py
server/tests/cloud/commands/test_auto_cascade_cap.py
server/tests/cloud/api_keys/test_create_personal.py
server/tests/cloud/api_keys/test_create_org_admin_gate.py
server/tests/cloud/api_keys/test_token_hash_only_stored.py
server/tests/cloud/api_keys/test_lookup_by_hmac.py
server/tests/cloud/api_keys/test_revoke.py
server/tests/auth/test_middleware_classifies_pk_prefix.py
server/tests/cloud/exposure/test_continue_remotely_creates_exposure.py
server/tests/cloud/exposure/test_disable_remote_access_pauses.py
```

SDK + SDK-React:

```bash
cd cloud/sdk-react && pnpm test -- --run
```

Targeted tests:

```text
cloud/sdk-react/src/hooks/live/reducer.test.ts
  - snapshot + patch -> new snapshot
  - command_status events surfaced separately
  - heartbeat resets watchdog
cloud/sdk-react/src/hooks/live.test.tsx
  - single subscription per id under StrictMode
  - reconnect with bounded backoff
  - React Query cache mirror updates
```

Desktop:

```bash
cd apps/desktop && pnpm test -- --run && pnpm typecheck
```

Targeted Desktop tests:

```text
apps/desktop/src/lib/domain/workspaces/sidebar/sidebar-indicators.test.ts
  - ssh variant
  - exposure / claim / origin indicators
apps/desktop/src/hooks/cowork/use-continue-remotely.test.ts
apps/desktop/src/hooks/cowork/use-open-direct-attach.test.ts
  - shared_cloud target uses JWT from spec 05
apps/desktop/src/lib/domain/workspaces/deep-links.test.ts
```

Web:

```bash
cd apps/web && pnpm test -- --run && pnpm typecheck
```

Targeted Web tests:

```text
apps/web/src/pages/WorkspacesPage.test.tsx
  - lists from scope=exposed
  - claim button surfaces on shared_unclaimed
apps/web/src/pages/ChatPage.test.tsx
  - useSessionLive transcript renders
  - prompt composer enqueues command source='web'
```

Mobile:

```bash
cd apps/mobile && pnpm test -- --run && pnpm typecheck
```

Targeted Mobile tests:

```text
apps/mobile/src/screens/MobileWorkspacesScreen.test.tsx
  - uses Cloud SDK, not fixtures
apps/mobile/src/screens/MobileChatScreen.test.tsx
  - live transcript + prompt
apps/mobile/src/lib/deep-links.test.ts
```

Manual smoke:

```text
1. Desktop "Continue remotely" on a local workspace
   - context menu shows "Continue remotely"
   - clicking creates cloud_workspace + active exposure
   - mobile and web list the workspace within ~5s
   - prompt sent from mobile reaches the local AnyHarness via
     worker; transcript appears on Desktop direct path

2. Web claim flow
   - Slack creates shared_unclaimed work (spec 07)
   - web user opens https://app.proliferate.ai/workspaces/{id}
   - claim button appears; click claims via spec 05
   - exposure.visibility -> 'claimed'; web prompt composer enabled
   - web sends prompt; transcript updates live

3. Desktop "Open in Desktop (direct)" on claimed shared work
   - user claims a Slack-created workspace
   - sandbox is running
   - Desktop shows "Open in Desktop (direct)" CTA
   - clicking fetches JWT (spec 05) and opens the shared_cloud
     runtime location; transcript loads via direct AnyHarness

4. Cowork API key
   - user creates a personal API key in Desktop > Settings
   - token shown once; user copies
   - curl POST /v1/cloud/workspaces with Bearer pk_live_... works
   - curl POST /v1/cloud/commands?auto_cascade=true with stale
     runtime config: cascade fires; start_session succeeds
   - revoke key; subsequent calls 401

5. Mobile deep link
   - someone shares https://app.proliferate.ai/workspaces/{id}
   - clicking on phone (mobile app installed) opens mobile app
   - if not signed in: OAuth PKCE -> back to workspace
   - if signed in: workspace renders with transcript + composer

6. Disable remote access
   - Desktop disables remote access on a previously exposed
     workspace
   - exposure.status='paused'
   - web/mobile listing drops the workspace
   - Desktop local view unaffected
```
## 10. Final Decisions / Deferred Questions

1. **Live token-by-token streaming on web/mobile?**

   V1 uses session-patch SSE. Token streaming would be lighter
   latency but adds reconnect complexity and bandwidth. Decision:
   defer until usage data shows the patch cadence is too coarse.

2. **Should mobile keep fixtures around at all?**

   Decision: only for unit tests / Storybook stories. Production
   reads always go through the Cloud SDK. Remove
   `mobile-fixtures.ts` from prod bundle paths.

3. **Cowork API key environment (`pk_live_` vs `pk_test_`)?**

   Decision: ship `pk_live_` only in V1. Test-mode keys are useful
   when there is a sandbox environment to test against; we
   don't have a separated test surface. Add `pk_test_` if and
   when ops needs it.

4. **Should the cowork API auto-cascade query param apply to
   web/mobile?**

   Decision: no. Web/mobile have UI affordances to fix stale state
   (deep-link to Settings → Compute, or "Open in Desktop"). Auto-
   cascade is an opt-in for programmatic callers that can't.

5. **Push notification surface in V1?**

   No. Spec 08 stops at the post-session-event registry hook
   (spec 07 §5.8). A future spec adds device tokens + APNs/FCM.

6. **Multi-org session listing in mobile?**

   Mobile shows the active org's exposed work today. Multi-org
   picker is a follow-up.

7. **Should `Open in web` and `Open on mobile` collapse into one
   "Share link" menu item?**

   Decision: separate items. The QR-for-mobile vs URL-for-web flows
   have different ergonomics; a single dialog with both options
   is fine if UX prefers.

8. **`shared_cloud` runtime location: how is the AnyHarness URL
   resolved if `cloud_target_runtime_access` is stale (slot
   replaced)?**

   The JWT carries `target_id`; AnyHarness checks
   `target_id == AppState.target_id`. If the target was replaced
   and AnyHarness booted with a new target_id, old JWTs fail
   target check and Desktop refreshes via
   `use-direct-attach-token`. Spec 05 §10 decision #4 already
   covered this.
