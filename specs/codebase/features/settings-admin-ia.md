# 03 — Settings / Admin Information Architecture

Status: implementation-ready spec.

Date: 2026-05-20.

Depends on: [`sandbox-provisioning.md`](../primitives/sandbox-provisioning.md),
[`mcp-skills.md`](../primitives/mcp-skills.md),
[`agent-auth.md`](../primitives/agent-auth.md).

This spec defines the settings shell, sidebar navigation, page ownership,
shared UI primitives, and shared vocabulary used by every other spec
that ships UI. Feature specs own page *content*; this spec owns the
*frame*.

## 1. Purpose & Scope

In scope:

- Sidebar groups, nav order, page ids, and routing for desktop Settings.
- Which spec owns which settings page (ownership boundary).
- Reusable UI primitives every feature spec consumes:
  `CredentialPicker`, `AgentRunConfigSelector`, `RuntimeReadinessPanel`,
  `PublicCapabilityList`, `WhereUsedDrawer`. Existing primitives
  (`SettingsCard`, `SettingsCardRow`, `SettingsPageHeader`) are
  preserved.
- Shared product vocabulary: workspace type, origin, exposure, access,
  sandbox type. Every spec that mentions these uses the same names.
- Admin gating model: small `useIsAdmin(organizationId)` hook to replace
  the inline `role === "owner" || role === "admin"` checks scattered
  across panes.
- Plugins page placement (stays top-level; linked from Settings).
- Status badge / form card / list-detail conventions standardized
  across panes.

Out of scope:

- Feature implementation. Plugins UI lands in spec 01. Agent auth UI in
  spec 02. Compute readiness in spec 00. Slack bot in spec 07. Billing
  in spec 09. Personal/shared cloud config in 00/01/02.
- New pages outside the Settings shell. The Plugins page, Automations
  page, and Cloud Workspace sidebars are owned by their feature specs.
- Marketing copy. Section/page titles and short helper sentences are
  in scope; long-form copy lives in feature specs.
- Web/mobile settings. Spec 08 covers those surfaces; principles may
  transfer but the shell is desktop-specific.

## 2. Mental Model

Settings is a flat sidebar over a single content pane. Each nav item
maps to one pane component. The shell is dumb — it routes, the panes
own their data.

```text
SettingsScreen
  ├── SettingsSidebar          (groups + items + active state)
  └── SettingsContentArea
        └── one pane component, selected by ?section= search param
```

Three rules every settings page follows:

```text
1. Components render. Hooks own state and effects.
   (frontend/guides/components.md, hooks.md)

2. Cloud/AnyHarness data goes through hooks/access/<boundary>/.
   No raw client construction inside settings panes.
   (frontend/guides/access.md)

3. Page chrome uses SettingsPageHeader + SettingsCard + SettingsCardRow.
   New pages do not invent new wrappers.
```

Ownership rule:

```text
spec 03 owns the shell, nav, primitives, vocabulary, admin gating.

every other spec owns its page content:
  spec 00  ->  Compute pane
  spec 01  ->  Plugins page (top-level, linked from Workspace section)
  spec 02  ->  Agent Authentication pane
  spec 05  ->  Organization claim/manage hooks inside Organization pane
  spec 06  ->  Automations (top-level page, not Settings)
  spec 07  ->  Slack bot pane
  spec 09  ->  Billing pane
```

## 3. Dependencies

Hard:

- [`sandbox-provisioning.md`](../primitives/sandbox-provisioning.md): Compute pane
  consumes `sandbox_profile` and `sandbox_profile_target_state`.
- [`mcp-skills.md`](../primitives/mcp-skills.md): Plugins page
  rows show `enabled`, `public_to_org`, `auth_status`,
  `runtime_apply_status`.
- [`agent-auth.md`](../primitives/agent-auth.md): Agent Authentication pane
  composes `CloudAgentAuthLibrary` + `ComputeTargetAgentAuthCard`;
  `CredentialPicker` is defined here and consumed there.

Soft:

- Specs 05/06/07/09 use the primitives and vocabulary defined here.

## 4. Current Repo State

Verified against the current repository worktree on 2026-05-20.

### 4.1 What exists

**Entry point**: `apps/desktop/src/pages/SettingsPage.tsx` renders
`<SettingsScreen />`. `SettingsScreen` composes
`SettingsSidebar` (300px fixed) + a scrollable content area.

**Routing**: URL search param `?section=<id>`. Active section is
managed by `useSettingsNavigation()`. Sections are defined in
`apps/desktop/src/config/settings.ts`:

```typescript
SETTINGS_CONTENT_SECTIONS = [
  "general", "agent-defaults", "agents", "review", "appearance",
  "account", "keyboard", "billing", "cloud", "organization",
  "repo", "worktrees", "compute"
]
```

**Sidebar navigation presentation**:
`apps/desktop/src/lib/domain/settings/navigation-presentation.ts` exports
`SETTINGS_NAV_GROUPS` (icon id, label, id per item). **Current
groups (5)**:

```text
Preferences            general, appearance, keyboard
Organization & Account  account, organization, billing
Environments           repo, worktrees, compute, cloud
Workflows              agents, agent-defaults, review
Help                   support (action), checkForUpdates (action)
```

**Panes** (in `apps/desktop/src/components/settings/panes/`):

```text
AccountPane.tsx              AgentDefaultsPane.tsx
AgentsPane.tsx               AppearancePane.tsx
BillingPane.tsx              CloudAuthUnavailablePane.tsx
CloudPane.tsx
CloudSignInRequiredPane.tsx  CloudUnavailablePane.tsx
ComputePane.tsx              EnvironmentsPane.tsx
GeneralPane.tsx              KeyboardShortcutsPane.tsx
ModelRegistryPane.tsx        OrganizationPane.tsx
ReviewSettingsPane.tsx       WorktreesPane.tsx

subfolders:
  cloud/                         CloudAgentAuthLibrary.tsx,
                                 CloudAgentAuthCredentialForm.tsx
  compute/                       AddSshTargetDialog.tsx,
                                 ComputeTargetAgentAuthCard.tsx,
                                 ComputeTargetDetails.tsx,
                                 ComputeTargetList.tsx,
                                 ComputeTargetReadiness.tsx,
                                 EnrollmentCommandBlock.tsx
  organization/                  Members/Invitations/Logo/etc.
  repo/                          CloudRepoSection.tsx, LocalRepoSection.tsx
  review/                        Review defaults/personality/etc.
```

**Existing shared primitives**:

```text
apps/desktop/src/components/settings/shared/
  SettingsCard.tsx          re-export of @proliferate/product-ui/settings/SettingsCard
  SettingsCardRow.tsx       re-export
  SettingsPageHeader.tsx    title + description + action slot
  RunCommandHelp.tsx
```

General UI primitives in `apps/desktop/src/components/ui/`: `Button`,
`Input`, `Switch`, `Select`, `Label`, `Textarea`, `Badge`, `Checkbox`,
`ModalShell`, `ConfirmationDialog`. Layout helpers: `AutoHideScrollArea`,
`SidebarNavRow`, `EnvironmentLayout` (EnvironmentPanel, ...Row, ...Section).

**Admin gating**: ad-hoc inline checks. `OrganizationPane.tsx` line 66
computes `canManage = role === "owner" || role === "admin"`.
`CloudAgentAuthCredentialForm.tsx` filters via
`isAdminOrganization()`. **No `useIsAdmin()` hook exists.**

**Plugins page**: `apps/desktop/src/pages/PluginsPage.tsx` is a top-level
page, not under Settings. Renders `<PluginsScreen />` from
`apps/desktop/src/components/plugins/catalog/PluginsScreen.tsx`.

### 4.2 What is missing vs. the target IA

Compared to the current product shape:

- **Group renames**: `Environments` → `Workspace`; `Workflows` →
  `Agents`. Help becomes a real group (currently has actions only).
- **New page: Agent Authentication** as a top-level Agents nav item.
  Today this content lives inside `CloudPane.tsx` via
  `CloudAgentAuthLibrary`.
- **New page: Shared environments** under Workspace, admin-tagged.
  No current pane.
- **New page: Slack bot** as its own loose nav item between Agents
  and Help. No current pane.
- **Compute page** exists but needs to expose sandbox profile state
  (spec 00) and per-target sandbox slot status more clearly.
- **Cloud pane (`CloudPane.tsx`) is doing too much**: it currently
  contains both the credential library (agent auth) and cloud repo
  config. Spec 02 lifts agent auth out into its own page. The
  remainder of `CloudPane.tsx` becomes the personal cloud landing
  surface or is folded into Compute/Environments.
- **No `useIsAdmin(organizationId)` hook**. Inline role checks repeat
  the same logic.
- **No `CredentialPicker`, `AgentRunConfigSelector`,
  `RuntimeReadinessPanel`, `PublicCapabilityList`,
  `WhereUsedDrawer`** primitives. Each pane builds these inline.
- **`agent-defaults` lives under Workflows in code; mockup puts it
  under Agents.** The pane works; the nav group changes.

## 5. Target Model

### 5.1 Sidebar groups + pages

Target visible `SETTINGS_NAV_GROUPS` after the owning panes ship:

```text
Preferences
  general                  GeneralPane                    (existing)
  appearance               AppearancePane                 (existing)
  keyboard                 KeyboardShortcutsPane          (existing)

Organization & Account
  account                  AccountPane                    (existing)
  organization             OrganizationPane               (existing; spec 05 hooks)
  billing                  BillingPane                    (existing; spec 09 owns content)

Workspace
  environments             EnvironmentsPane               (existing; renamed group)
  shared-environments      SharedEnvironmentsPane         (new; admin-tagged;
                                                           hidden until its
                                                           owner spec ships a
                                                           functioning body)
  compute                  ComputePane                    (existing; spec 00 wires content)

Agents
  agents                   AgentsPane                     (existing; "installed on this Mac")
  agent-defaults           AgentDefaultsPane              (existing; moved from Workflows;
                                                           pin one cloud_agent_run_config per
                                                           agent_kind — spec 06 §5.3 owns content)
  agent-run-configs        AgentRunConfigsPane            (new; hidden until
                                                           spec 06 ships a
                                                           functioning body;
                                                           library of named configs)
  agent-authentication     AgentAuthenticationPane        (new; hidden until
                                                           spec 02 wires
                                                           content)
  review                   ReviewSettingsPane             (existing)

Slack bot                  SlackBotPane                   (parked/disabled;
                                                           spec 07 logic is
                                                           preserved but entry
                                                           points are commented
                                                           out)

Help
  support                  action (existing)
  check-for-updates        action (existing)
```

Section ids (`apps/desktop/src/config/settings.ts`):

```text
SETTINGS_CONTENT_SECTIONS is the registry of valid section ids. The visible
sidebar filters it through `featureAvailable` / owner-spec readiness; registered
does not mean visible.
```

```typescript
SETTINGS_CONTENT_SECTIONS = [
  "general", "appearance", "keyboard",
  "account", "organization", "billing",
  "environments", "shared-environments", "compute",
  "agents", "agent-defaults", "agent-run-configs",
  "agent-authentication", "review",
  "slack-bot",
]
```

Renamed ids:

```text
"repo" -> "environments"      (matches group rename)
```

Removed id:

```text
"cloud"         CloudPane is broken up (see 5.2). Its responsibilities
                migrate into Compute + Agent Authentication +
                Environments. A top-level "cloud" entry is no longer
                needed.

"worktrees"     Worktrees configuration is folded into the per-repo
                detail view in Environments. No separate top-level
                section.
```

The `?section=<id>` URL scheme is preserved. Old urls that point at
`?section=repo` redirect to `?section=environments`; old
`?section=worktrees` redirects to `?section=environments` with a per-repo
focus param. Old `?section=cloud` redirects by focus when available:
credential/auth focus -> `agent-authentication`, repo/env focus ->
`environments`, billing/credits focus -> `billing`, target/readiness focus ->
`compute`, and no focus -> `agent-authentication`.

### 5.2 Per-page ownership

Each pane is owned by one spec for content; spec 03 owns the shell
and shared primitives the pane consumes.

```text
Preferences/general         spec 03   product feature flags, telemetry opt-in,
                                       editor preferences
Preferences/appearance      spec 03   theme, density
Preferences/keyboard        spec 03   bindings (see keybindings-help skill)

Organization & Account
  account                   spec 03   user identity, linked OAuth, email,
                                       sign-out
  organization              spec 03 + 05  members, invitations, role; spec 05
                                       adds the claim-management drawer in
                                       admin views
  billing                   spec 09   plan, usage, included credits, overage
                                       policy, free-trial allocation

Workspace
  environments              spec 03 (shell) + per-repo content owned by
                            the broader env config story; existing
                            LocalRepoSection / CloudRepoSection move here.
  shared-environments       spec 06 / spec 07   surfaces shared repo
                                       defaults used by team automations
                                       and Slack. Admin-tagged.
  compute                   spec 00 (sandbox foundation):
                                       target list, sandbox profile state,
                                       slot status, "Enable Cloud" verb,
                                       per-target ComputeTargetReadiness,
                                       per-target ComputeTargetAgentAuthCard.

Agents
  agents                    spec 03   installed local harnesses (Claude,
                                       Codex, Gemini, OpenCode, Cursor),
                                       paths, versions, install/uninstall
                                       hooks
  agent-defaults            spec 03 + (spec 06 reads)   reusable
                                       agent_run_config rows; visible to
                                       chat, automations, Slack, web,
                                       mobile, Desktop
  agent-authentication      spec 02   CloudAgentAuthLibrary (per-org and
                                       personal credentials) + per-target
                                       ComputeTargetAgentAuthCard. The
                                       same pane is sandbox-aware:
                                       admins see selection for shared
                                       sandbox; everyone sees personal.
  review                    spec 03   review-feature defaults

Slack bot                   spec 07   install/reconnect, repo routing,
                                       default agent_run_config, shared
                                       readiness summary

Help/support                spec 03   support dialog
Help/check-for-updates      spec 03   updater
```

### 5.3 Shared vocabulary

These strings are the shared presentation vocabulary. Specs that own server
schema changes must emit the same strings on the wire and in DB CHECKs when
they add those fields, but spec 03 itself is a frontend IA spec and does not
add DB/API fields. Convention: snake_case for machine values (DB-friendly,
matches existing `owner_scope='personal'`, `kind='managed_cloud'`). Human-
readable labels live in copy and convert at render time.

**WorkspaceType** (where a workspace runs):

```text
local                Desktop AnyHarness on the user's machine
worktree             a worktree under a local repo
ssh                  remote SSH-accessible AnyHarness
personal_cloud       managed cloud, owner_scope = 'personal'
shared_cloud         managed cloud, owner_scope = 'organization'
```

**Origin** (how the work was started):

```text
manual_desktop | manual_web | manual_mobile | automation | slack | cowork_api
```

Origin survives claiming.

**Exposure** (whether Cloud can see/control the workspace):

```text
not_tracked          no exposure row
viewable             Cloud projection active; not commandable
controllable         exposure + commandable
paused               exposure exists but stopped projecting
stale                projection behind / failed reconciliation
revoked              exposure was active and is now off
```

**Access** (who can act on the work):

```text
private              owner only
shared_unclaimed     org members can view + interact pre-claim
claimed              one claiming user has narrowed control
archived             retained but hidden from active lists
```

Spec 04/05 add `cloud_workspace_exposure.visibility` using these values.
Spec 05 (claiming) keeps claim as a one-way transition; there is no
`admin_managed` state. Admins gain audit view via the `useIsAdmin` hook and
the `scope=org-all` listing endpoint, not via a separate visibility state.

**SandboxType** (the runtime container the work lives in):

```text
local                local AnyHarness; no Cloud sandbox
ssh                  remote AnyHarness on an SSH target
managed_personal     managed cloud with owner_scope='personal'
managed_shared       managed cloud with owner_scope='organization'
```

**Display labels** (in `copy/settings/vocabulary-copy.ts`):

```text
WorkspaceType  personal_cloud  -> "Personal cloud"
               shared_cloud    -> "Shared cloud"
               worktree        -> "Worktree"
               local           -> "Local"
               ssh             -> "SSH"

Origin         manual_desktop  -> "Desktop"
               manual_web      -> "Web"
               manual_mobile   -> "Mobile"
               automation      -> "Automation"
               slack           -> "Slack"
               cowork_api      -> "Cowork API"

Exposure       not_tracked     -> "Not tracked"
               viewable        -> "Viewable"
               controllable    -> "Live"
               paused          -> "Paused"
               stale           -> "Stale"
               revoked         -> "Revoked"

Access         private         -> "Private"
               shared_unclaimed -> "Shared (unclaimed)"
               claimed         -> "Claimed"
               archived        -> "Archived"

SandboxType    local           -> "Local"
               ssh             -> "SSH"
               managed_personal -> "Personal cloud"
               managed_shared  -> "Shared cloud"
```

Reusable files:

```text
apps/desktop/src/lib/domain/vocabulary.ts      (new)
  WorkspaceType, Origin, Exposure, Access, SandboxType TS enums whose
  string values are the snake_case strings above (so the wire payload,
  the TS literal, and the DB CHECK enum are identical bytes)
  helpers: workspaceTypeLabel(), sandboxTypeLabel(), accessLabel(),
    exposureLabel(), originLabel()
copy/settings/vocabulary-copy.ts          (new)
  human-readable labels per locale
```

Server-side:

```text
Specs that own server migrations emit and accept the same snake_case strings
on the wire and in DB enums. OpenAPI schema enums use these values literally so
generated TS types match apps/desktop/src/lib/domain/vocabulary.ts at the character
level.

Existing DB CHECK enums that already match this convention are left in place
(sandbox_profile.status, cloud_targets.kind, agent_kind, etc.).

Specs that add new enum values (e.g. spec 08 dispatch states) emit
the same vocabulary; the strings on the wire are exactly the strings
in copy/settings/vocabulary-copy.ts keys.
```

### 5.4 Shared UI primitives

Existing (kept; no changes):

```text
SettingsCard                apps/desktop/src/components/settings/shared/SettingsCard.tsx
SettingsCardRow             apps/desktop/src/components/settings/shared/SettingsCardRow.tsx
SettingsPageHeader          apps/desktop/src/components/settings/shared/SettingsPageHeader.tsx
```

New (spec 03 introduces; feature specs consume):

```text
CredentialPicker
  apps/desktop/src/components/settings/shared/CredentialPicker.tsx
  Props:
    agentKind          'claude' | 'codex' | 'opencode' | 'gemini'
    ownerContext       'personal' | { kind: 'organization', orgId }
    sandboxType        'managed_personal' | 'managed_shared' | 'local' | 'ssh'
    visibleCredentials list of CredentialSnapshot   (filtered by hook)
    selectedCredentialId?
    onSelect(credentialId, shareId?)
    showSourceOwner    bool   (default true for shared sandboxes)
  Renders:
    grouped sections: Proliferate managed credits, Org credentials,
    Personal credentials, Shared personal credentials (with source
    owner). Items show status (ready / needs_resync / invalid /
    revoked) via StatusBadge primitive.
  Used by:
    AgentAuthenticationPane (spec 02)
    ComputeTargetAgentAuthCard (spec 02)

AgentRunConfigSelector
  apps/desktop/src/components/settings/shared/AgentRunConfigSelector.tsx
  Props:
    agentKind?           preselect
    sandboxType?         filters configs by usable_in_*_sandboxes
    selectedConfigId?
    onSelect(configId)
    surface              'chat' | 'automation' | 'slack' | 'web' | 'mobile'
  Renders:
    list of agent_run_config rows for the actor + scope, plus
    inline "Create new" CTA. Loads catalog.json for live controls.
  Used by:
    AgentDefaultsPane (spec 03)
    Automation create dialog (spec 06)
    Slack bot config (spec 07)

RuntimeReadinessPanel
  apps/desktop/src/components/settings/shared/RuntimeReadinessPanel.tsx
  Props:
    sandboxProfileId
    targetId?            optional; omit for "summary across all targets"
  Renders:
    target online state, worker version,
    runtime_config_status (applied / pending / failed),
    agent_auth_status,
    sandbox slot state (creating / running / paused / blocked / error)
    each with a "fix" CTA that deep-links to the owning pane.
  Used by:
    ComputePane per-target detail
    SharedEnvironmentsPane summary
    PluginsPage detail panes (status badge only)

PublicCapabilityList
  apps/desktop/src/components/settings/shared/PublicCapabilityList.tsx
  Props:
    organizationId
    kind                 'mcp' | 'skill' | 'plugin'
  Renders:
    list of items publicized to this org with source owner, status,
    last apply time, link to source detail. Read-only for non-admins;
    admins see "unpublicize" inline.
  Used by:
    SharedEnvironmentsPane (read-only summary)
    PluginsPage admin tab (full controls; spec 01)

WhereUsedDrawer
  apps/desktop/src/components/settings/shared/WhereUsedDrawer.tsx
  Props:
    subject              { kind: 'mcp' | 'skill' | 'plugin' | 'credential',
                           id }
  Renders:
    a side drawer showing every sandbox, automation, Slack config,
    and live session that depends on this subject. Read-only.
  Used by:
    PluginsPage detail
    CloudAgentAuthLibrary credential detail
```

**Status badge convention** (existing `Badge` primitive, new shared
status variants):

```text
ready          green dot
pending        amber dot, spinning when in flight
materializing  amber dot, spinning
applied        green dot
failed         red dot
needs_resync   amber outline
invalid        red outline
revoked        muted
blocked        red outline
unavailable    muted with strikethrough

apps/desktop/src/components/settings/shared/StatusBadge.tsx   (new wrapper
  over the existing Badge primitive that maps a status enum value to
  variant + label + tooltip)
```

**Form-card / list-detail pattern**: all panes use
`SettingsCard` + `SettingsCardRow` for primary content. List-detail
flows (e.g. Compute targets) open a detail panel inside the same
content area, not a modal, unless the action is destructive. Modals
use `ModalShell`; destructive actions use `ConfirmationDialog`.

### 5.5 Admin gating

New hook:

```text
apps/desktop/src/hooks/access/cloud/organizations/use-is-admin.ts

useIsAdmin(organizationId: string | null | undefined): {
  isLoading: boolean
  isAdmin: boolean           true when role === 'owner' || 'admin'
  role: 'owner' | 'admin' | 'member' | null
}
```

Replaces all inline `role === "owner" || role === "admin"` checks. Pane
gates render with:

```tsx
const { isAdmin } = useIsAdmin(organizationId);
if (!isAdmin) return <AdminOnlyPlaceholder />;
```

`AdminOnlyPlaceholder`:

```text
apps/desktop/src/components/settings/shared/AdminOnlyPlaceholder.tsx
  shows a small Card with "Admin access required" + role,
  links to the Organization pane.
```

Admin-tagged nav items:

```text
shared-environments    admin-only
slack-bot              admin-only

sidebar shows a small "Admin" tag next to the label when the active
organization role is admin/owner; non-admins see the items as
disabled with a tooltip.
```

`useIsAdmin` reuses the existing `useOrganizationMembers()` hook
under the hood; this is purely a consolidation.

### 5.6 Plugins page placement

Plugins remains a **top-level page** (`PluginsPage.tsx`), not a
Settings pane. Reasons:

```text
- Plugins is a marketplace-ish discovery surface; settings panes are
  configuration surfaces. Mixing them dilutes both.
- The Plugins page is larger and richer (catalog grid, detail modals)
  than the rest of Settings.
- The current top-level placement is already shipping; moving it into
  Settings is gratuitous churn.
```

Cross-links:

```text
Workspace section in Settings shows a "Manage plugins" card linking
to PluginsPage. Per-target ComputeTargetReadiness deep-links any
plugin readiness issue back to PluginsPage filtered by the relevant
MCP/skill.
```

Plugins stays outside the Settings sidebar. This spec confirms that decision.

### 5.7 Routing

URL search param `?section=<id>` is preserved. Two clean-ups:

1. **Redirects** for renamed/removed ids (see 5.1).
2. **Deep links** for per-target / per-credential / per-MCP focus:

```text
?section=compute&target=<target_id>
?section=agent-authentication&credential=<credential_id>
?section=agent-authentication&target=<target_id>&kind=<agent_kind>
?section=environments&repo=<normalized_repo_key>
?section=shared-environments&repo=<normalized_repo_key>
```

`useSettingsNavigation()` exposes the focus param so panes can scroll
to / open the right card.

Settings does **not** move to a path-based route in this spec. Search
params are sufficient and the existing URL state survives.

### 5.8 Copy

Copy stays in `copy/<domain>/<domain>-copy.ts` per the existing rule.
New copy files added by this spec:

```text
apps/desktop/src/copy/settings/vocabulary-copy.ts
apps/desktop/src/copy/settings/admin-gate-copy.ts
apps/desktop/src/copy/settings/shared-environments-copy.ts
apps/desktop/src/copy/settings/agent-authentication-copy.ts
apps/desktop/src/copy/settings/slack-bot-copy.ts
```

Existing `copy/settings/*` files are kept; rename inside copy follows
the section-id renames.

### 5.9 Telemetry

Pane open/close events follow the existing analytics pattern in
`apps/desktop/src/lib/telemetry/**`. New events:

```text
settings_pane_opened    { sectionId, organizationId? }
settings_pane_closed    { sectionId, durationMs }
admin_gate_blocked      { sectionId, organizationId }
```

The vocabulary above is logged verbatim in event payloads.

## 6. Files To Change

Desktop:

```text
apps/desktop/src/config/settings.ts
  - update SETTINGS_CONTENT_SECTIONS to the new id list
  - export redirect/focus map for old ids: repo -> environments,
    worktrees -> environments, cloud -> focused replacement pane

apps/desktop/src/lib/domain/settings/navigation.ts
  - normalize/build Settings location for new ids
  - remove hardcoded cloud/cloudRepo behavior or map it through the new focus
    model

apps/desktop/src/lib/domain/settings/navigation-presentation.ts
  - new groups: Preferences | Organization & Account | Workspace |
    Agents | Slack bot | Help
  - new items: agent-authentication, shared-environments, slack-bot
  - removed items: cloud, worktrees
  - admin tag metadata on shared-environments, slack-bot

apps/desktop/src/components/settings/sidebar/SettingsSidebar.tsx
  - render admin tag pill when item.adminOnly is true
  - disable + tooltip for non-admin user

apps/desktop/src/components/settings/screen/SettingsScreen.tsx
  - route redirects for renamed ids
  - thread focus param to active pane

apps/desktop/src/lib/domain/auth/desktop-navigation.ts
apps/desktop/src/App.tsx
  - remove direct section=cloud links; route auth/cloud recovery links through
    the redirect/focus map

apps/desktop/src/components/settings/panes/
  CloudPane.tsx                       split (see below); content moves out
  AgentAuthenticationPane.tsx         (new) spec 02 wires content here
  SharedEnvironmentsPane.tsx          (new) spec 06/07 wires content here
  SlackBotPane.tsx                    (new) spec 07 wires content here
  EnvironmentsPane.tsx                (existing; renamed from repo; absorb
                                        WorktreesPane responsibilities)
  WorktreesPane.tsx                   removed; content folded into
                                        EnvironmentsPane per-repo detail
  ComputePane.tsx                     adjust to consume new primitives
                                        (RuntimeReadinessPanel,
                                         ComputeTargetAgentAuthCard which
                                         now lives behind
                                         AgentAuthenticationPane card)

apps/desktop/src/components/settings/shared/
  SettingsCard.tsx                    (existing; no change)
  SettingsCardRow.tsx                 (existing; no change)
  SettingsPageHeader.tsx              (existing; no change)
  StatusBadge.tsx                     (new)
  AdminOnlyPlaceholder.tsx            (new)
  CredentialPicker.tsx                (new)
  AgentRunConfigSelector.tsx          (new)
  RuntimeReadinessPanel.tsx           (new)
  PublicCapabilityList.tsx            (new)
  WhereUsedDrawer.tsx                 (new)

apps/desktop/src/hooks/access/cloud/organizations/use-is-admin.ts   (new)

apps/desktop/src/lib/domain/vocabulary.ts                            (new)

apps/desktop/src/copy/settings/vocabulary-copy.ts                    (new)
apps/desktop/src/copy/settings/admin-gate-copy.ts                    (new)
apps/desktop/src/copy/settings/shared-environments-copy.ts           (new)
apps/desktop/src/copy/settings/agent-authentication-copy.ts          (new)
apps/desktop/src/copy/settings/slack-bot-copy.ts                     (new)

apps/desktop/src/components/settings/panes/cloud/                    (delete folder
                                                                   after move;
                                                                   contents
                                                                   relocate to
                                                                   /agent-authentication/)
apps/desktop/src/components/settings/panes/agent-authentication/
  CloudAgentAuthLibrary.tsx           (moved from /cloud/)
  CloudAgentAuthCredentialForm.tsx    (moved from /cloud/)
  AgentAuthenticationLayout.tsx       (new) composes library + per-target
                                            card
```

Server:

```text
no DB or API changes in spec 03. Server schema/wire fields that use this
vocabulary are owned by specs 00, 04, 05, 06, 07, and 08.
```

Telemetry:

```text
apps/desktop/src/lib/domain/telemetry/events.ts
  add settings_pane_opened, settings_pane_closed, admin_gate_blocked
  events. Payload uses 5.3 vocabulary verbatim.
```

## 8. Acceptance Criteria

1. Registered `SETTINGS_NAV_GROUPS` matches §5.1 exactly, but visible nav rows
   are filtered by owner-spec readiness. Group labels read `Preferences`,
   `Organization & Account`, `Workspace`, `Agents`, `Slack bot`, `Help` when
   their rows are visible.
2. `SETTINGS_CONTENT_SECTIONS` is the new id list. Old ids `repo`,
   `cloud`, `worktrees` redirect to their new homes.
3. `AgentAuthenticationPane.tsx`, `SharedEnvironmentsPane.tsx`, and
   `SlackBotPane.tsx` appear in nav only when their owning spec ships a
   functioning page body. No empty-shell stubs are present.
4. `useIsAdmin(organizationId)` is the only settings-layer place admin role is
   resolved. `OrganizationPane.tsx`, `CloudAgentAuthCredentialForm.tsx`,
   `CloudAgentAuthLibrary.tsx`, and `BillingPane.tsx` no longer compute role
   inline.
5. `AdminOnlyPlaceholder` wraps every admin-only pane and renders for
   non-admin users instead of an empty page.
6. `CredentialPicker`, `AgentRunConfigSelector`,
   `RuntimeReadinessPanel`, `PublicCapabilityList`,
   `WhereUsedDrawer`, `StatusBadge` exist in
   `apps/desktop/src/components/settings/shared/`. Callers import the concrete file
   directly; spec 03 does not add a shared barrel/index module.
7. `apps/desktop/src/lib/domain/vocabulary.ts` exports the five enums
   (`WorkspaceType`, `Origin`, `Exposure`, `Access`, `SandboxType`)
   with the exact string values in §5.3. Every other spec that ships
   UI imports from here.
8. Plugins page (`PluginsPage.tsx`) remains top-level. A "Manage
   plugins" card in the `EnvironmentsPane` (or `CloudPane`'s former
   spot) links to it.
9. Deep-link params (`?section=…&target=…`, `&credential=…`,
   `&kind=…`, `&repo=…`) work: opening a deep link scrolls the focus
   element into view and opens the relevant detail card.
10. Telemetry events `settings_pane_opened`, `settings_pane_closed`,
    `admin_gate_blocked` are emitted with the new section ids and
    use vocabulary from §5.3.
11. `CloudPane.tsx` is deleted. Its content has been redistributed
    into `AgentAuthenticationPane`, `EnvironmentsPane`, and
    `BillingPane` (or has been confirmed dead and removed).
12. `WorktreesPane.tsx` is deleted; the worktrees UI lives inside
    `EnvironmentsPane` per-repo detail.
13. No raw Tailwind palette classes are introduced
    (`bg-zinc-*`, `text-red-500`, etc.). Status colors come from the
    new `StatusBadge` variants which themselves use semantic tokens.
14. No new admin gating logic exists outside `useIsAdmin`. A grep for
    `role === "admin"` or `role === "owner"` returns only the hook
    implementation.

## 9. Verification / Tests

```bash
cd apps/desktop && pnpm test -- --run && pnpm typecheck
```

Targeted tests:

```text
apps/desktop/src/components/settings/sidebar/SettingsSidebar.test.tsx
  - renders the new groups in order
  - admin-tag pill renders when item.adminOnly + user is admin
  - admin-only items are disabled with tooltip when user is non-admin

apps/desktop/src/components/settings/SettingsScreen.test.tsx
  - ?section=repo redirects to ?section=environments
  - ?section=cloud redirects by focus param, defaulting to agent-authentication
  - ?section=worktrees redirects to ?section=environments

apps/desktop/src/components/settings/shared/CredentialPicker.test.tsx
apps/desktop/src/components/settings/shared/AgentRunConfigSelector.test.tsx
apps/desktop/src/components/settings/shared/RuntimeReadinessPanel.test.tsx
apps/desktop/src/components/settings/shared/PublicCapabilityList.test.tsx
apps/desktop/src/components/settings/shared/WhereUsedDrawer.test.tsx
apps/desktop/src/components/settings/shared/StatusBadge.test.tsx
  - each primitive snapshot + behavior tests
  - status mapping for every enum value in §5.3

apps/desktop/src/hooks/access/cloud/organizations/use-is-admin.test.ts
  - returns role from useOrganizationMembers
  - returns isAdmin true for owner/admin
  - returns isAdmin false for member or no membership

apps/desktop/src/lib/domain/vocabulary.test.ts
  - enum string values match §5.3 verbatim

apps/desktop/src/components/settings/panes/AgentAuthenticationPane.test.tsx
  - renders functioning spec-02 body when the pane is enabled
apps/desktop/src/components/settings/panes/SharedEnvironmentsPane.test.tsx
  - admin gate visible to non-admins once the functioning pane ships
apps/desktop/src/components/settings/panes/SlackBotPane.test.tsx
  - admin gate visible to non-admins once the functioning pane ships
```

Manual smoke:

```text
1. Open Settings as a non-admin org member.
     -> Workspace > Shared environments is disabled with tooltip.
     -> Slack bot is disabled with tooltip.
     -> Agents > Agent Authentication is enabled (personal selection
        still allowed).

2. Open Settings as an org owner.
     -> Workspace > Shared environments is enabled with "Admin" pill.
     -> Slack bot is enabled with "Admin" pill.

3. Open Settings with ?section=cloud.
     -> redirects to the focused replacement pane when a focus param exists;
        otherwise redirects to ?section=agent-authentication.

4. Open ?section=agent-authentication&target=t_abc&kind=claude.
     -> AgentAuthenticationPane opens with target t_abc focused and
        the Claude credential picker open.

5. Open Plugins (top-level page).
     -> Still works; not in Settings sidebar.
     -> Workspace > Environments has a "Manage plugins" card linking
        to it.

6. Resize sidebar focus.
     -> 300px fixed; no horizontal scroll inside nav.
```
