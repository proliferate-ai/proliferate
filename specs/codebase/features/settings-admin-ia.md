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
- Top-level Integrations and Workflows placement, plus `tbr` marking for
  still-visible rows outside the target IA.
- Status badge / form card / list-detail conventions standardized
  across panes.

Out of scope:

- Feature implementation. Plugins UI lands in spec 01. Agent auth UI in
  spec 02. Compute readiness in spec 00. Slack bot in spec 07. Billing
  in spec 09. Personal/shared cloud config in 00/01/02.
- New pages outside the Settings shell. The Plugins, Automations,
  Integrations, and Workflows pages and Cloud workspace sidebars are
  owned by their feature specs.
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
  future   ->  Integrations and Workflows (top-level pages, not Settings)
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

Verified against the current repository worktree on 2026-06-22.

### 4.1 What exists

**Entry point**: `apps/desktop/src/pages/SettingsPage.tsx` renders
`<SettingsScreen />`. `SettingsScreen` composes
`SettingsSidebar` (300px fixed) + a scrollable content area.

**Routing**: URL search param `?section=<id>`. Active section is
managed by `useSettingsNavigation()`. Sections are defined in
`apps/desktop/src/config/settings.ts`:

```typescript
SETTINGS_CONTENT_SECTIONS = [
  "organization", "billing", "organization-integrations",
  "organization-model-policy", "organization-limits",
  "general", "appearance", "keyboard", "account",
  "environments", "compute", "worktrees", "archived-chats",
  "shared-environments", "agent-authentication", "agent-defaults",
  "review"
]
```

**Sidebar navigation presentation**:
`apps/desktop/src/lib/domain/settings/navigation-presentation.ts` exports
`SETTINGS_NAV_GROUPS` (icon id, label, id per item). **Current
groups (6)**:

```text
Admin                  organization, billing, organization-integrations,
                       organization-model-policy, organization-limits
Settings               general, appearance, keyboard, account
Workspaces             environments, compute, worktrees, archived-chats,
                       shared-environments
Agents                 agent-authentication, agent-defaults, review
Help                   support (action), checkForUpdates (action)
```

**Panes** (in `apps/desktop/src/components/settings/panes/`):

```text
AccountPane.tsx              AgentDefaultsPane.tsx
AgentAuthenticationPane.tsx  AppearancePane.tsx
BillingPane.tsx              CloudAuthUnavailablePane.tsx
CloudSignInRequiredPane.tsx  CloudUnavailablePane.tsx
ComputePane.tsx              EnvironmentsPane.tsx
GeneralPane.tsx              KeyboardShortcutsPane.tsx
ModelRegistryPane.tsx        OrganizationPane.tsx
ReviewSettingsPane.tsx       SettingsScaffoldPane.tsx
SharedEnvironmentsPane.tsx   WorktreesPane.tsx
ArchivedChatsPane.tsx

subfolders:
  agent-authentication/          CloudAgentAuthLibrary.tsx,
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

**Admin gating**: Settings sidebar admin-only rows consume
`useIsAdmin(activeOrganizationId)` and remain visible but disabled for
non-admins. Pane bodies still own their detailed read/write states.

**Plugins page**: `apps/desktop/src/pages/PluginsPage.tsx` is a top-level
page, not under Settings. Renders `<PluginsScreen />` from
`apps/desktop/src/components/plugins/catalog/PluginsScreen.tsx`.

### 4.2 What remains scaffolded

The Admin information architecture is visible in the Desktop
settings shell. Connected panes keep their existing feature-owned content:
organization membership/invitations, billing, environments, personal compute,
worktrees, agent authentication, agent defaults, and review settings.

The following pages are intentionally scaffolded with `SettingsScaffoldPane`
until their owning feature specs provide connected bodies:

```text
organization-integrations
organization-model-policy
organization-limits
```

The scaffold establishes the route, sidebar placement, page title, and content
ownership boundary without adding duplicate or fake integration/model/limit
backends.

Personal Integrations and Workflows are top-level app pages rather than
Settings sections. Existing legacy top-level Plugins and Automations rows
remain visible for now but are marked `tbr` because they are outside this target
IA. Support is not `tbr`.

Rows outside the target list are marked with a small `tbr` status pill until
they are removed or explicitly re-scoped:

```text
Main sidebar            Plugins, Automations
Settings / Workspaces   Archived chats, Shared sandbox
Settings / Agents       Review
```

## 5. Target Model

### 5.1 Sidebar groups + pages

Target visible `SETTINGS_NAV_GROUPS` after the owning panes ship:

```text
Admin
  organization             OrganizationPane               org profile and Team setup
  organization-members     OrganizationMembersPane        members, invitation emails,
                                                           invite link
  billing                  BillingPane                    plan + billing as an org,
                                                           including auto top up option
  organization-integrations SettingsScaffoldPane           org-owned integrations
  organization-model-policy SettingsScaffoldPane           allowed/default models
  organization-limits      SettingsScaffoldPane            per-user spend and
                                                           usage guardrails

Settings
  general                  GeneralPane                    general settings,
                                                           including worktree defaults
  appearance               AppearancePane                 theme and display
  keyboard                 KeyboardShortcutsPane          bindings
  account                  AccountPane                    login / logout

Workspaces
  environments             EnvironmentsPane               environments
  compute                  ComputePane                    personal compute / SSH targets
  worktrees                WorktreesPane                  all-environment worktree cleanup
  archived-chats           ArchivedChatsPane              hidden chats
  shared-environments      SharedEnvironmentsPane         org shared sandbox, admin-tagged

Agents
  agent-authentication     AgentAuthenticationPane        local + cloud auth by person
  agent-defaults           AgentDefaultsPane              per-person agent defaults
  review                   ReviewSettingsPane             review defaults

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
  "organization", "billing", "organization-integrations",
  "organization-model-policy", "organization-limits",
  "general", "appearance", "keyboard", "account",
  "environments", "compute", "worktrees", "archived-chats",
  "shared-environments", "agent-authentication", "agent-defaults",
  "review",
]
```

Renamed ids:

```text
"repo" -> "environments"      (matches group rename)
```

Legacy id:

```text
"cloud"         CloudPane is broken up (see 5.2). Its responsibilities
                migrate into Compute + Agent Authentication +
                Environments. A top-level "cloud" entry is no longer
                needed.
```

Preserved id:

```text
"worktrees"     Remains a top-level Workspaces section because cleanup spans
                all environments.
```

The `?section=<id>` URL scheme is preserved. Old urls that point at
`?section=repo` redirect to `?section=environments`. Old `?section=cloud`
redirects by focus when available:
credential/auth focus -> `agent-authentication`, repo/env focus ->
`environments`, billing/credits focus -> `billing`, target/readiness focus ->
`compute`, and no focus -> `agent-authentication`.

### 5.2 Per-page ownership

Each pane is owned by one spec for content; spec 03 owns the shell
and shared primitives the pane consumes.

```text
Admin
  organization              spec 03 + 05  members, invitation emails,
                                       invite link, org profile
  billing                   spec 09   org plan, seats, usage, credits,
                                       auto top up, overage, plan changes
  organization-integrations future org integrations spec
  organization-model-policy future model policy spec
  organization-limits       future limits/budget spec

Settings
  general                   spec 03   product feature flags, telemetry opt-in,
                                       editor preferences, worktree defaults
  appearance                spec 03   theme, density
  keyboard                  spec 03   bindings
  account                   spec 03   user identity, linked OAuth, email,
                                       sign-out

Workspaces
  environments              spec 03 (shell) + per-repo content owned by
                            the broader env config story; existing
                            LocalRepoSection / CloudRepoSection move here.
  shared-environments       spec 06 / spec 07   surfaces shared repo
                                       defaults used by team automations
                                       and Slack. Admin-tagged.
  compute                   spec 00 (sandbox foundation), labeled
                            Personal compute:
                                       target list, sandbox profile state,
                                       sandbox status, "Enable Cloud" verb,
                                       per-target ComputeTargetReadiness,
                                       per-target ComputeTargetAgentAuthCard.

Agents
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
    sandbox state (creating / running / paused / blocked / error)
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
  - register Admin, Settings, Workspaces, and Agents section ids
  - keep general as the default settings section

apps/desktop/src/lib/domain/settings/navigation.ts
  - normalize/build Settings location for all registered ids
  - keep legacy repo/cloud/cloudRepo redirect behavior

apps/desktop/src/lib/domain/settings/navigation-presentation.ts
  - groups: Admin | Settings | Workspaces | Agents | Help
  - Admin items: organization, billing, organization-integrations,
    organization-model-policy, organization-limits
  - admin tag metadata on Admin rows and shared-environments

apps/desktop/src/components/settings/sidebar/SettingsSidebar.tsx
  - render admin tag pill when item.adminOnly is true
  - disable + tooltip for non-admin user

apps/desktop/src/components/settings/screen/SettingsScreen.tsx
  - render SettingsScaffoldPane for scaffolded Admin pages
  - thread focus param to active pane

apps/desktop/src/components/settings/panes/
  SettingsScaffoldPane.tsx            renders scaffolded page rows
  OrganizationPane.tsx                existing org settings
  BillingPane.tsx                     existing connected plan + billing
  ComputePane.tsx                     existing personal compute / SSH targets

apps/desktop/src/copy/settings/settings-scaffold-copy.ts
  - page titles, descriptions, and rows for scaffolded pages

apps/desktop/src/copy/settings/compute.ts
  - labels compute as Personal compute

apps/packages/product-surfaces/src/settings/BillingSettingsSurface.tsx
  - labels billing as Plan + billing
  - exposes auto top up as an organization billing option
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
   are filtered by owner-spec readiness. Group labels read `Admin`,
   `Settings`, `Workspaces`, `Agents`, and `Help`.
2. `SETTINGS_CONTENT_SECTIONS` is the new id list. Old ids `repo`,
   `cloud`, and `cloudRepo` keep redirecting to their supported homes.
   `worktrees` remains a first-class Workspaces section.
3. `SettingsScaffoldPane.tsx` renders the scaffolded pages listed in §4.2.
   Scaffolded pages establish route, placement, title, and ownership copy only.
4. Admin rows are marked `adminOnly`; non-admin users see disabled rows with
   the admin access tooltip instead of hidden information architecture.
5. `BillingSettingsSurface` is labeled `Plan + billing` and shows the
   organization auto top up option alongside the existing billing controls.
6. `ComputePane` is labeled `Personal compute`.
7. Integrations and Workflows pages are top-level. Still-visible Plugins,
   Automations, Archived chats, Shared sandbox, and Review rows are marked
   `tbr`. Support and Desktop updates are not `tbr`.
8. Deep-link params (`?section=…&target=…`, `&credential=…`,
   `&kind=…`, `&repo=…`) work: opening a deep link scrolls the focus
   element into view and opens the relevant detail card.
9. Telemetry events `settings_pane_opened`, `settings_pane_closed`,
    `admin_gate_blocked` are emitted with the new section ids and
    use vocabulary from §5.3.
10. No raw Tailwind palette classes are introduced
    (`bg-zinc-*`, `text-red-500`, etc.). Status colors come from the
    new `StatusBadge` variants which themselves use semantic tokens.
11. No new admin gating logic exists outside `useIsAdmin`. A grep for
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
  - ?section=worktrees resolves to Worktrees

apps/desktop/src/hooks/access/cloud/organizations/use-is-admin.test.ts
  - returns role from useOrganizationMembers
  - returns isAdmin true for owner/admin
  - returns isAdmin false for member or no membership

apps/desktop/src/lib/domain/vocabulary.test.ts
  - enum string values match §5.3 verbatim

apps/packages/product-surfaces/src/settings/BillingSettingsSurface.test.tsx
  - renders Plan + billing and the auto top up option
```

Manual smoke:

```text
1. Open Settings as a non-admin org member.
     -> Admin rows are disabled with tooltip.
     -> Workspaces > Shared sandbox is disabled with tooltip.
     -> Agents > Agent Authentication is enabled (personal selection
        still allowed).

2. Open Settings as an org owner.
     -> Admin rows are enabled with "Admin" pill.
     -> Workspaces > Shared sandbox is enabled with "Admin" pill.

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
