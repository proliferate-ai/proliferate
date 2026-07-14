# 03 — Settings / Admin Information Architecture

Status: target

Current gap: the managed-Target UI described here is not implemented.

Date: 2026-05-20.

Depends on: [`sandbox-provisioning.md`](../../../platforms/product/sandbox-provisioning.md),
[`mcp-skills.md`](../../../platforms/product/mcp-skills.md),
[`agent-auth.md`](../../../platforms/product/agent-auth.md).

This spec defines the settings shell, sidebar navigation, page ownership,
shared UI primitives, and shared vocabulary used by every other spec
that ships UI. Feature specs own page *content*; this spec owns the
*frame*.

## 1. Purpose & Scope

In scope:

- Scope tabs, sidebar groups, nav order, page ids, and routing for
  desktop Settings.
- Which spec owns which settings page (ownership boundary).
- Reusable UI primitives every feature spec consumes:
  `CredentialPicker`, `AgentRunConfigSelector`, `RuntimeReadinessPanel`,
  `PublicCapabilityList`, `WhereUsedDrawer`. Existing primitives
  (`SettingsPageHeader`, `SettingsSection`, `SettingsRow`) are
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

Settings is a scope-tabbed shell: four horizontal scope tabs
(User · Org · Repo · Agents), each owning a short section sidebar, over
a single content pane. Each nav item maps to one pane component. The
shell is dumb — it routes, the panes own their data.

```text
SettingsScreen
  ├── header: back row + SettingsScopeTabs   (User · Org · Repo · Agents)
  ├── SettingsSidebar          (active scope's groups + help footer)
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

3. Page chrome uses SettingsPageHeader + SettingsSection + SettingsRow
   (from @proliferate/product-ui/settings). New pages do not invent
   new wrappers.

4. The Agents `Local` surface remains useful without a Cloud session. Its
   model list comes directly from the local AnyHarness launch catalog; Cloud
   sign-in gates the `Cloud` surface, gateway management, catalog overrides,
   and other Cloud-backed mutations, not local model discovery.
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

- [`sandbox-provisioning.md`](../../../platforms/product/sandbox-provisioning.md): Compute pane
  consumes `sandbox_profile` and `sandbox_profile_target_state`.
- [`mcp-skills.md`](../../../platforms/product/mcp-skills.md): Plugins page
  rows show `enabled`, `public_to_org`, `auth_status`,
  `runtime_apply_status`.
- [`agent-auth.md`](../../../platforms/product/agent-auth.md): Agent Authentication pane
  composes `CloudAgentAuthLibrary` + `ComputeTargetAgentAuthCard`;
  `CredentialPicker` is defined here and consumed there.

Soft:

- Specs 05/06/07/09 use the primitives and vocabulary defined here.

## 4. Current Repo State

Verified against the current repository worktree on 2026-07-01.

### 4.1 What exists

**Entry point**: `apps/desktop/src/pages/SettingsPage.tsx` renders
`<SettingsScreen />`. `SettingsScreen` renders a two-row header — a back
row, then a 46px row of horizontal scope tabs (`SettingsScopeTabs` from
`@proliferate/product-ui/settings`) — over `SettingsSidebar` (240px
fixed rail) + a scrollable content area.

**Scope-tab IA**: navigation is split into four top-level scopes,
surfaced as underline tabs (User · Org · Repo · Agents). Each scope owns
a short section sidebar; selecting a tab lands on the scope's first
section. Defined in
`apps/desktop/src/lib/domain/settings/navigation-presentation.ts`:

```text
SETTINGS_SCOPE_ORDER / SETTINGS_SCOPE_LABELS   tab order + labels
SETTINGS_SCOPES                                per-scope SettingsNavGroup[]
                                               (icon id, label, id per item)
SETTINGS_HELP_ITEMS                            support + checkForUpdates
                                               actions, rendered at the
                                               sidebar footer in every scope
getSettingsScopeNav(scope)                     sidebar groups for a scope
getSettingsScopeForSection(section)            keeps the right tab
                                               highlighted per section
getFirstSectionForScope(scope)                 landing section per tab
PARKED_SECTION_SCOPES                          unregistered sections
                                               (organization-limits,
                                               slack-bot) still map to a
                                               scope for deep links
isSettingsAdminOnlySection(section)            derived from adminOnly flags
```

**Current scope contents**:

```text
User      general, appearance, keyboard, account, personal-secrets,
          worktrees ("Pruning"), archived-chats (tbr)
Org       organization, organization-members, billing,
          organization-secrets                      (all adminOnly)
          Policies:        organization-integrations,
                           organization-model-policy
          Authentication:  organization-sso
Repo      environments, compute ("Personal compute")
Agents    agent-defaults, agent-authentication
```

**Routing**: URL search param `?section=<id>`. Active section is
managed by `useSettingsNavigation()`; the active scope tab is derived
from the section. Sections are defined in
`apps/desktop/src/config/settings.ts`:

```typescript
SETTINGS_CONTENT_SECTIONS = [
  "general", "appearance", "keyboard", "account", "personal-secrets",
  "organization", "organization-secrets", "organization-members",
  "billing", "organization-sso", "organization-integrations",
  "organization-model-policy", "environments", "compute",
  "worktrees", "archived-chats", "agent-authentication",
  "agent-defaults",
  // parked (kept in code, unregistered): "organization-limits", "slack-bot"
]
```

**Shortcuts**: Cmd-digit section shortcuts are per-scope.
`SETTINGS_SHORTCUT_SECTION_ORDER` is filtered to the sections visible in
the active scope's sidebar, so Cmd-1…N always maps to the rows currently
on screen.

**Panes** (in `apps/desktop/src/components/settings/panes/`):

```text
AccountPane.tsx              AgentAuthenticationPane.tsx
AgentDefaultsPane.tsx        AppearancePane.tsx
ArchivedChatsPane.tsx        BillingPane.tsx
CloudAuthUnavailablePane.tsx CloudSignInRequiredPane.tsx
CloudUnavailablePane.tsx     ComputePane.tsx
EnvironmentsPane.tsx         GeneralPane.tsx
KeyboardShortcutsPane.tsx    ModelRegistryPane.tsx
OrganizationBudgetsPane.tsx  (parked)
OrganizationIntegrationsPane.tsx
OrganizationMembersPane.tsx  OrganizationPane.tsx
OrganizationSecretsPane.tsx  OrganizationSsoPane.tsx
PersonalSecretsPane.tsx      SettingsScaffoldPane.tsx
SlackBotPane.tsx             (parked)
WorktreesPane.tsx

subfolders:
  agent-authentication/          CloudAgentAuthLibrary.tsx,
                                 CloudAgentAuthCredentialForm.tsx,
                                 authentication-method sections
  compute/                       AddSshTargetDialog.tsx,
                                 ComputeTargetAgentAuthCard.tsx,
                                 ComputeTargetDetails.tsx,
                                 ComputeTargetList.tsx,
                                 ComputeTargetReadiness.tsx,
                                 EnrollmentCommandBlock.tsx
  organization/                  Members/Invitations/Logo/budget rows
  repo/                          CloudRepoSection.tsx, LocalRepoSection.tsx
```

**Existing shared primitives**: page chrome lives in
`apps/packages/product-ui/src/settings/`:

```text
SettingsPageHeader.tsx    title + description + action slot
SettingsSection.tsx       grouped rows with heading
SettingsRow.tsx           label + control row
SettingsEyebrow.tsx       group heading style (sidebar + panes)
SettingsScopeTabs.tsx     horizontal underline scope switcher
SettingsEmptyState.tsx / SettingsShell.tsx
```

Desktop-local `apps/desktop/src/components/settings/shared/` keeps
`AdminOnlyPlaceholder`, `AgentHarnessConfigComposer`, `RunCommandHelp`.
Layout helpers come from `@proliferate/ui` (`AutoHideScrollArea`,
`SidebarNavRow`) and general primitives from
`@proliferate/ui/primitives` (`Button`, `Input`, `Switch`, ...).

**Admin gating**: unchanged model. All Org-scope rows are marked
`adminOnly`; `SettingsSidebar` hides them for non-admins via
`useIsAdmin(activeOrganizationId)`, and `SettingsScreen` redirects a
non-admin deep link at an admin-only section to the default section once
the role check resolves. `TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION`
(currently `false`) can force-show admin rows during UI iteration. Pane
bodies still own their detailed read/write states.

**Plugins page**: `apps/desktop/src/pages/PluginsPage.tsx` is a top-level
page, not under Settings. Renders `<PluginsScreen />` from
`apps/desktop/src/components/plugins/catalog/PluginsScreen.tsx`.

### 4.2 What remains scaffolded / parked

Connected panes keep their existing feature-owned content: organization
profile/members/invitations, billing, secrets (personal + org), SSO,
org integrations, environments, personal compute, worktree pruning,
agent authentication, and agent defaults.

One page is intentionally scaffolded with `SettingsScaffoldPane`
(registered in `copy/settings/settings-scaffold-copy.ts`) until its
owning feature spec provides a connected body:

```text
organization-model-policy
```

The scaffold establishes the route, sidebar placement, page title, and
content ownership boundary without adding a fake model-policy backend.
`organization-integrations` graduated to a connected pane
(`OrganizationIntegrationsPane`).

Parked (pane kept in code, section not registered in navigation or
routing; `PARKED_SECTION_SCOPES` keeps their deep links on the right
scope tab):

```text
organization-limits    OrganizationBudgetsPane — until real budget
                       data/enforcement replaces the mocked UI
slack-bot              SlackBotPane — entry points commented out
```

Personal Integrations and Workflows are top-level app pages rather than
Settings sections. Rows outside the target list are marked with a small
`tbr` status pill until they are removed or explicitly re-scoped:

```text
Settings / User         Archived chats
```

Support and Desktop updates are not `tbr`.

This spec owns the placement and naming of the Desktop updates settings action.
[`desktop-updates.md`](../../engineering/delivery/desktop-updates.md) owns what that action does and the
rest of the packaged updater and release-notice experience.

## 5. Target Model

### 5.0 Organization control center map

The organization settings surfaces form an organization control center. The
shell is still the Desktop Settings shell, but the Admin group is product
oriented: organization identity, members, billing, integrations, model policy,
and capability limits. Budgets are modeled in code but parked until real
budget data and enforcement replace the mocked UI.

Each Admin surface carries an implementation maturity label so UI can ship
before every backend primitive exists without confusing reviewers about what is
real.

```text
real-now              connected to server state and permission enforcement
mocked-ui             product-correct display with local deterministic mock data
disabled-until-backend product row exists but action is disabled until API work lands
enterprise-only       visible product capability gated to Enterprise
parked-ui             product model exists in code/spec, but page is unregistered
```

Organization control center map:

```text
Org switcher / account hub
  maturity: real-now
  owns:
    active org summary, organization list, pending invitations,
    Settings, Docs, Support, Log out, and Create organization entrypoint.
  rule:
    every signed-in user has a personal organization created by the auth/user
    creation flow. Users may belong to many organizations, but default
    organization creation is one-per-user unless a later Team/Enterprise flow
    explicitly provisions another organization.

Organization settings
  maturity: real-now
  owns:
    organization name, logo, and billing entrypoint cross-link.
  rule:
    organization identity controls how the org appears in switchers, settings,
    shared workspace context, and future web/mobile org selectors.

Members
  maturity: real-now, with domain auto-join enterprise-only
  owns:
    member list, pending invitations, invite by email, copy join link,
    role changes, remove member, rescind invitation.
  rows:
    profile picture, name/email, date joined or "Invited", role, auth methods,
    and action menu.
  invitation policy:
    invite-by-email creates an invitation record and sends the same join link
    that admins can copy. The join link is the organization join endpoint. A
    signed-in matching invited user can accept the invitation; an anonymous
    user is sent through the organization's configured auth path and returned
    to the join flow. Organizations with enabled SSO start that SSO connection
    from the join link; organizations without SSO fall back to standard product
    sign-in. Domain auto-join uses the same link but is Enterprise-only.

Billing
  maturity: mixed real-now + mocked-ui
  owns:
    current plan, Manage action, Proliferate Credits summary, add credits,
    auto top-up, and billing portal.
  rule:
    the Billing page starts with current plan and credits. Plan comparison and
    upgrade detail live inside the Manage modal. Stripe portal is the only
    cancellation/payment-method surface.
  mocked-ui:
    PCU purchased/available/used cards and illustrative add-credit/top-up rows
    may use deterministic mock values until PCU backend fields replace compute
    hour fields.

Budgets
  maturity: parked-ui
  owns:
    usage over time, usage by person, and budget controls.
  rule:
    OrganizationBudgetsPane remains in code, but organization-limits is not
    registered in settings navigation or routing while only mocked usage data
    exists. When revived, use real members when available and deterministic
    mock usage values only in tests/stories. Budget controls render as
    disabled unless the owning backend is connected. Per-person budgets are
    Enterprise-only.
  per-person budget shape:
    each member can have a monthly maximum for LLM credits and an alert
    threshold. Enforcement should pause new LLM-backed work for that member
    once the monthly maximum is reached. Compute budgets remain organization
    level unless a later product decision adds per-member compute caps.

Plans
  maturity: mocked-ui plus real Stripe entrypoints where available
  owns:
    Free, Core, and Enterprise comparison.
  plan shape:
    Free:
      Proliferate Credits: 5 PCUs
      cloud auth: Proliferate gateway only
      local auth: any local option
      workflows per person: 1
      team members: 5
      support: docs only
    Core:
      Proliferate Credits: 20 / 50 / 100 / 200 / 500 PCUs with overage/top-up
      cloud auth: Proliferate gateway only
      local auth: any local option
      workflows per person: unlimited
      team members: unlimited
      extras: beta access, role-based access management
    Enterprise:
      Proliferate Credits: custom
      cloud auth: Proliferate gateway and BYO model credentials
      workflows per person: unlimited
      team members: unlimited
      extras: SSO, org-wide secrets, audit trails, custom instance types,
        programmatic access, budgets per person, productivity insights,
        VPC deployment, account manager, FDE, premium support.

Integrations and skills
  maturity: mixed mocked-ui + disabled-until-backend
  owns:
    organization-owned integration policy and shared plugin/MCP/skill controls.
  rule:
    the route and page are visible in Admin IA. Connected policy controls use
    the integration-policy backend; missing shared skill/plugin controls render
    disabled placeholders until their owning backend/API lands.

Ownership enforcement
  maturity: real-now
  owns:
    RLS, context vars, middleware, and server permission checks.
  rule:
    UI can mock display data, but access enforcement is never mocked. Admin-only
    actions must fail closed server-side for non-admins.
```

### 5.1 Scope tabs + pages

Target `SETTINGS_SCOPES` (the shipped scope-tab IA):

```text
User
  general                  GeneralPane                    general settings,
                                                           including worktree defaults
  appearance               AppearancePane                 theme and display
  keyboard                 KeyboardShortcutsPane          bindings
  account                  AccountPane                    login / logout
  personal-secrets         PersonalSecretsPane            personal secrets
  worktrees                WorktreesPane                  "Pruning" — all-environment
                                                           worktree cleanup
  archived-chats           ArchivedChatsPane              hidden chats (tbr)

Org (all adminOnly)
  organization             OrganizationPane               org profile
  organization-members     OrganizationMembersPane        members, invitation emails,
                                                           invite link
  billing                  BillingPane                    billing as an org,
                                                           including auto top up option
  organization-secrets     OrganizationSecretsPane        org-wide secrets
  Policies
    organization-integrations OrganizationIntegrationsPane org-owned integrations
    organization-model-policy SettingsScaffoldPane         allowed/default models
  Authentication
    organization-sso       OrganizationSsoPane            single sign-on
  # PARKED until budget backend exists:
  # organization-limits    OrganizationBudgetsPane         usage over time,
  #                                                        usage by person,
  #                                                        budget controls

Repo
  environments             EnvironmentsPane               environments
  compute                  ComputePane                    personal compute / SSH targets

Agents
  agent-defaults           AgentDefaultsPane              per-person agent defaults
  agent-authentication     AgentAuthenticationPane        local + cloud auth by person

Slack bot                  SlackBotPane                   (parked/disabled;
                                                           spec 07 logic is
                                                           preserved but entry
                                                           points are commented
                                                           out)

Help (sidebar footer, every scope)
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
  "general", "appearance", "keyboard", "account", "personal-secrets",
  "organization", "organization-secrets", "organization-members",
  "billing", "organization-sso", "organization-integrations",
  "organization-model-policy", "environments", "compute",
  "worktrees", "archived-chats", "agent-authentication",
  "agent-defaults",
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
`?section=repo` or `?section=cloudRepo` redirect to
`?section=environments`; `?section=cloud` redirects to
`?section=agent-authentication`; removed `shared-environments` and
parked `slack-bot` redirect to the default section
(`normalizeSettingsSection` in
`apps/desktop/src/lib/domain/settings/navigation.ts`).

### 5.2 Per-page ownership

Each pane is owned by one spec for content; spec 03 owns the shell
and shared primitives the pane consumes.

```text
User
  general                   spec 03   product feature flags, telemetry opt-in,
                                       editor preferences, worktree defaults
  appearance                spec 03   theme, density
  keyboard                  spec 03   bindings
  account                   spec 03   user identity, linked OAuth, email,
                                       sign-out
  personal-secrets          spec 03 (shell) + secrets story (content)
  worktrees                 spec 03   "Pruning" — all-environment worktree
                                       cleanup
  archived-chats            spec 03   hidden chats (tbr)

Org
  organization              spec 03 + 05  org profile, billing cross-link
  organization-members      spec 03 + 05  members, invitation emails,
                                       invite link
  billing                   spec 09   current plan, PCUs, add credits,
                                       auto top up, Stripe portal, plan changes
  organization-secrets      spec 03 (shell) + secrets story (content)
  organization-integrations org integrations spec
  organization-model-policy future model policy spec
  organization-sso          spec 03 (shell) + enterprise SSO story (content)
  # PARKED until budget backend exists:
  # organization-limits     spec 09   usage over time, usage by person,
  #                                    and budget controls

Repo
  environments              spec 03 (shell) + per-repo content owned by
                            the broader env config story; existing
                            LocalRepoSection / CloudRepoSection live here.
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

Slack bot (parked)          spec 07   install/reconnect, repo routing,
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
SettingsPageHeader          apps/packages/product-ui/src/settings/SettingsPageHeader.tsx
SettingsSection             apps/packages/product-ui/src/settings/SettingsSection.tsx
SettingsRow                 apps/packages/product-ui/src/settings/SettingsRow.tsx
SettingsEyebrow / SettingsScopeTabs / SettingsEmptyState / SettingsShell
                            same directory
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

**Form / list-detail pattern**: all panes use
`SettingsSection` + `SettingsRow` for primary content. List-detail
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

Admin-only nav items:

```text
all Org-scope sections carry adminOnly in SETTINGS_SCOPES.

the sidebar hides adminOnly rows for non-admins; SettingsScreen
redirects a deep link at an admin-only section to the default section
once the role check resolves.
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
  - register the User/Org/Repo/Agents section ids
  - keep general as the default settings section

apps/desktop/src/lib/domain/settings/navigation.ts
  - normalize/build Settings location for all registered ids
  - keep legacy repo/cloud/cloudRepo redirect behavior

apps/desktop/src/lib/domain/settings/navigation-presentation.ts
  - scopes: user | org | repo | agents (SETTINGS_SCOPES), plus
    SETTINGS_SCOPE_ORDER/LABELS, SETTINGS_HELP_ITEMS,
    scope<->section mapping, PARKED_SECTION_SCOPES
  - adminOnly metadata on Org-scope rows

apps/packages/product-ui/src/settings/SettingsScopeTabs.tsx
  - horizontal underline scope switcher consumed by SettingsScreen

apps/desktop/src/components/settings/sidebar/SettingsSidebar.tsx
  - 240px rail rendering the active scope's groups + help footer
  - hide adminOnly rows for non-admins
  - per-scope Cmd-digit shortcut labels

apps/desktop/src/components/settings/screen/SettingsScreen.tsx
  - scope-tab header row; scope change selects the scope's first section
  - render SettingsScaffoldPane for scaffolded pages
  - redirect non-admins away from admin-only sections
  - thread focus param to active pane

apps/desktop/src/components/settings/panes/
  SettingsScaffoldPane.tsx            renders scaffolded page rows
  OrganizationPane.tsx                existing org settings
  BillingPane.tsx                     existing connected billing
  ComputePane.tsx                     existing personal compute / SSH targets

apps/desktop/src/copy/settings/settings-scaffold-copy.ts
  - page titles, descriptions, and rows for scaffolded pages

apps/desktop/src/copy/settings/compute.ts
  - labels compute as Personal compute

apps/packages/product-surfaces/src/settings/BillingSettingsSurface.tsx
  - labels billing as Billing
  - exposes current plan, credits, add credits, top up, and Stripe portal
    controls
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

1. Registered `SETTINGS_SCOPES` matches §5.1 exactly, but visible nav rows
   are filtered by admin access. Scope tabs read `User`, `Org`, `Repo`,
   and `Agents`; help actions render in the sidebar footer of every scope.
2. `SETTINGS_CONTENT_SECTIONS` is the new id list. Old ids `repo`,
   `cloud`, and `cloudRepo` keep redirecting to their supported homes.
   `worktrees` remains a first-class User section ("Pruning").
3. `SettingsScaffoldPane.tsx` renders the scaffolded pages listed in §4.2.
   Scaffolded pages establish route, placement, title, and ownership copy only.
4. Admin rows are marked `adminOnly`; non-admin users do not see those rows.
5. `BillingSettingsSurface` is labeled `Billing` and shows the current plan,
   organization credits, add credits, auto top up, and Stripe portal controls.
6. `ComputePane` is labeled `Personal compute`.
7. Integrations and Workflows pages are top-level. Still-visible rows
   outside the target IA are marked `tbr` (currently: Archived chats).
   Support and Desktop updates are not `tbr`.
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
  - renders the active scope's groups in order
  - adminOnly rows render for admins
  - adminOnly rows are hidden for non-admins

apps/desktop/src/components/settings/SettingsScreen.test.tsx
  - ?section=repo redirects to ?section=environments
  - ?section=cloud redirects to ?section=agent-authentication
  - ?section=worktrees resolves to Pruning (User scope)

apps/desktop/src/hooks/access/cloud/organizations/use-is-admin.test.ts
  - returns role from useOrganizationMembers
  - returns isAdmin true for owner/admin
  - returns isAdmin false for member or no membership

apps/desktop/src/lib/domain/vocabulary.test.ts
  - enum string values match §5.3 verbatim

apps/packages/product-surfaces/src/settings/BillingSettingsSurface.test.tsx
  - renders Billing and the auto top up option
```

Manual smoke:

```text
1. Open Settings as a non-admin org member.
     -> Org-scope admin rows are hidden.
     -> Deep-linking an admin-only section redirects to General.
     -> Agents > Authentication is enabled (personal selection
        still allowed).

2. Open Settings as an org owner.
     -> Org scope tab shows all admin rows, enabled.

3. Open Settings with ?section=cloud.
     -> redirects to ?section=agent-authentication.

4. Open ?section=agent-authentication&kind=claude.
     -> AgentAuthenticationPane opens with the Claude agent kind
        preselected.

5. Open Plugins (top-level page).
     -> Still works; not in Settings sidebar.

6. Check the shell frame.
     -> Scope-tab header row is 46px; sidebar rail is 240px fixed;
        no horizontal scroll inside nav.
     -> Cmd-digit shortcuts map to the active scope's visible rows.
```
