# 03 — Settings / Admin Information Architecture

Status: target

Current gap: the managed-Target UI described here is not implemented.

Date: 2026-05-20.

Depends on: [`lifecycle.md`](../environments/README.md), `mcp-skills.md` (document retired; no owning platform document replaces it), and [`AGENT_AUTH.md`](../agent_auth/README.md).

Staleness note (2026-08-25): the SSH target product surface (SSH compute targets, `AddSshTargetDialog`, the SSH rows of the compute pane, SSH target enrollment, and the Desktop SSH tunnel) was deleted by the cull-sweep `delete-ssh-surface` delivery. Every SSH-target block below describes a destination that no longer exists and must not be built as written.

Staleness note (2026-07-25): this document predates the Bifrost removal. Its Agents-scope content (the `agent-authentication` pane, its panes, primitives, deep links, copy files, and smoke steps) describes removed UI; each such block below carries a correction to the shipped per-harness sections. The authoritative auth contract is [`AGENT_AUTH.md`](../agent_auth/README.md).

This spec defines the settings shell, sidebar navigation, page ownership, shared UI primitives, and shared vocabulary used by every other spec that ships UI. Feature specs own page *content*; this spec owns the *frame*.

The independent UI-font, readable-code, and window-zoom behavior exposed by the Appearance pane is owned by [`appearance-scaling.md`](appearance-scaling.md). This document continues to own the pane's Settings placement and shared frame.

## 1. Purpose & Scope

In scope:

- Scope tabs, sidebar groups, nav order, page ids, and routing for
  desktop Settings.
- Which spec owns which settings page (ownership boundary).
- Reusable UI primitives every feature spec consumes:
  `CredentialPicker`, `AgentRunConfigSelector`, `RuntimeReadinessPanel`,
  `PublicCapabilityList`, `WhereUsedDrawer`. Existing primitives
  (`PageHeader` with `variant="flat"`, `SettingsSection`, `SettingsRow`) are
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
  spec 02. Compute readiness in spec 00. Slack bot in spec 07 (document
  retired; the Slack bot was never built). Billing
  content is owned by the Billing platform. Personal/shared cloud config is
  owned by 00/01/02.
- New pages outside the Settings shell. The Plugins, Automations,
  Integrations, and Workflows pages and Cloud workspace sidebars are
  owned by their feature specs.
- Marketing copy. Section/page titles and short helper sentences are
  in scope; long-form copy lives in feature specs.
- Web/mobile settings. Spec 08 covers those surfaces; principles may
  transfer but the shell is desktop-specific.

## 2. Mental Model

Settings is a scope-tabbed shell: four horizontal scope tabs (User · Org · Repo · Agents), each owning a short section sidebar, over a single content pane. Each nav item maps to one pane component. The shell is dumb — it routes, the panes own their data.

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

3. Page chrome uses `PageHeader` (`variant="flat"`) + SettingsSection +
   SettingsRow (PageHeader from #product/primitives/patterns, the rest from
   the settings kit). New pages do not invent new wrappers.

4. The Agents `Local` surface remains useful without a Cloud session. Its model
   list comes directly from the local target's `HarnessLaunchOptions`; the
   Cloud surface reads the exact copy for its selected sandbox and harness.
   Cloud sign-in gates Cloud access and gateway management, not local
   observation. Neither surface exposes an executable model-visibility or
   catalog-override mutation.
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
               (document retired; no current Automations system spec —
                see systems/product/README.md)
  future   ->  Integrations and Workflows (top-level pages, not Settings)
  spec 07  ->  Slack bot pane
               (document retired; the Slack bot was never built)
  Billing platform -> Billing and Usage & Limits pane content
```

> Shipped correction: a pane named "Agent Authentication" (sidebar label
> "Authentication") did ship under spec 02, then was torn down by
> PR #814 (`f0f8403fa`, "tear down Bifrost gateway stack") and replaced
> by the API key pool page. The Agents scope ships as the per-harness
> panes (`agent-claude`/`agent-codex`/`agent-opencode`/`agent-grok`)
> plus `agent-api-keys`; the old `agent-authentication` id redirects to
> `agent-api-keys` (see the staleness note at the top).

## 3. Dependencies

Hard:

- the cloud sandbox provisioning platform (document retired; absorbed by
  [`lifecycle.md`](../environments/README.md) —
  the `sandbox_profile` / `sandbox_profile_target_state` schema this pane
  consumes currently has no owning platform document): Compute pane
  consumes `sandbox_profile` and `sandbox_profile_target_state`.
- `mcp-skills.md` (document retired): Plugins page
  rows show `enabled`, `public_to_org`, `auth_status`,
  `runtime_apply_status`.
- [`AGENT_AUTH.md`](../agent_auth/README.md): this spec's
  Agent Authentication pane (`CloudAgentAuthLibrary` +
  `ComputeTargetAgentAuthCard`, `CredentialPicker`) described the removed
  Bifrost-era UI. The shipped UI is per-harness settings sections
  (`agent-claude`, `agent-codex`, `agent-opencode`, `agent-grok`,
  `agent-api-keys`), rendered by
  [HarnessPane.tsx](../../../apps/packages/product-client/src/components/settings/panes/agents/harness/HarnessPane.tsx)
  with three method cards (gateway / API key / CLI login) per
  agent-auth.md's selection model.

Soft:

- Specs 05/06/07/09 use the primitives and vocabulary defined here.

## 4. Current Repo State

Verified against the current repository worktree on 2026-07-01.

### 4.1 What exists

**Entry point**: `apps/packages/product-client/src/pages/SettingsPage.tsx` renders `<SettingsScreen />`. `SettingsScreen` renders a two-row header — a back row, then a 46px row of horizontal scope tabs (`SettingsScopeTabs` from `#product/components/patterns`) — over `SettingsSidebar` (240px fixed rail) + a scrollable content area.

**Scope-tab IA**: navigation is split into four top-level scopes, surfaced as underline tabs (User · Org · Repo · Agents). Each scope owns a short section sidebar; selecting a tab lands on the scope's first section. Defined in `apps/packages/product-client/src/lib/domain/settings/navigation-presentation.ts`:

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
                                               (slack-bot) still map to a
                                               scope for deep links
isSettingsAdminOnlySection(section)            derived from adminOnly flags
```

**Current scope contents**:

```text
User      general, appearance, keyboard, account, personal-secrets,
          worktrees ("Pruning"), archived-chats (tbr)
Org       organization, organization-members, billing,
          organization-limits, organization-secrets (all adminOnly)
          Policies:        organization-integrations,
                           organization-model-policy
Repo      environments, compute ("Personal compute")
Agents    agent-defaults, agent-authentication
```

> Shipped correction: `worktrees` ("Pruning") was removed from the User
> scope — cleanup no longer has a dedicated pane. `archived-workspaces`
> ("Archived workspaces") took its slot instead: the real list of archived
> workspaces, backed by the runtime's `lifecycle=archived` filter, superseding
> the speculative `archived-chats` (tbr) row above, which was never built.
> ([navigation-presentation.ts](../../../apps/packages/product-client/src/lib/domain/settings/navigation-presentation.ts)).

> Shipped correction: the Agents scope is per-harness pages plus the key
> pool — `agent-claude`, `agent-codex`, `agent-opencode`, `agent-grok`,
> `agent-api-keys`
> ([navigation-presentation.ts](../../../apps/packages/product-client/src/lib/domain/settings/navigation-presentation.ts)).
> `agent-defaults` and `agent-authentication` were removed; legacy links
> redirect to `agent-claude` and `agent-api-keys` respectively
> ([navigation.ts](../../../apps/packages/product-client/src/lib/domain/settings/navigation.ts)).

**Routing**: URL search param `?section=<id>`. Active section is managed by `useSettingsNavigation()`; the active scope tab is derived from the section. Sections are defined in `apps/packages/product-client/src/config/settings.ts`:

```typescript
SETTINGS_CONTENT_SECTIONS = [
  "general", "appearance", "keyboard", "account", "personal-secrets",
  "organization", "organization-secrets", "organization-members",
  "billing", "organization-limits", "organization-integrations",
  "organization-model-policy", "environments", "compute",
  "worktrees", "archived-chats", "agent-authentication",
  "agent-defaults",
  // parked (kept in code, unregistered): "slack-bot"
]
```

> Shipped correction: the registered array
> ([config/settings.ts](../../../apps/packages/product-client/src/config/settings.ts))
> carries `agent-claude`/`agent-codex`/`agent-opencode`/`agent-grok`/
> `agent-api-keys` instead of `agent-authentication`/`agent-defaults`,
> plus `integrations`, `repo-actions`, `repo-environment`, and
> `archived-workspaces`; `keyboard`, `worktrees`, `archived-chats`, and
> `compute` were removed. `archived-workspaces` is the real archived-list
> page (§3 in the archiving-workspaces train's R7 delivery spec), not the
> speculative `archived-chats` row it replaced.

**Shortcuts**: Cmd-digit section shortcuts are per-scope. `SETTINGS_SHORTCUT_SECTION_ORDER` is filtered to the sections visible in the active scope's sidebar, so Cmd-1…N always maps to the rows currently on screen.

**Panes** (in `apps/packages/product-client/src/components/settings/panes/`):

```text
AccountPane.tsx              AgentAuthenticationPane.tsx
AgentDefaultsPane.tsx        AppearancePane.tsx
ArchivedChatsPane.tsx        BillingPane.tsx
CloudAuthUnavailablePane.tsx CloudSignInRequiredPane.tsx
CloudUnavailablePane.tsx     ComputePane.tsx
EnvironmentsPane.tsx         GeneralPane.tsx
KeyboardShortcutsPane.tsx    ModelRegistryPane.tsx
OrganizationBudgetsPane.tsx
OrganizationIntegrationsPane.tsx
OrganizationMembersPane.tsx  OrganizationPane.tsx
OrganizationSecretsPane.tsx  PersonalSecretsPane.tsx
SettingsScaffoldPane.tsx
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

> Shipped correction: `AgentAuthenticationPane.tsx` and the
> `agent-authentication/` subfolder do not exist; both were removed by
> PR #814 (`f0f8403fa`). `AgentDefaultsPane.tsx` also does not exist; it
> was removed by PR #1100 (`7d5894807`) — see the correction on the
> `agent-defaults` ownership row in §5.2. The Agents scope ships
> as `panes/agents/harness/` (per-harness pane, auth method cards, CLI
> login details) and `panes/agents/api-keys/` (the key pool), with
> selection/vault contracts owned by
> [`AGENT_AUTH.md`](../agent_auth/README.md).

**Existing shared primitives**: page chrome lives in the settings kit at `apps/packages/product-client/src/primitives/patterns/settings/`, plus `PageHeader.tsx` (`variant="flat"`) in `apps/packages/product-client/src/primitives/patterns/`:

```text
PageHeader.tsx            title + description + action slot (variant="flat")
SettingsSection.tsx       muted label (or emphasized title) over a wash card of rows
SettingsRow.tsx           in-card label + control row, no self-divider
SettingsScopeTabs.tsx     horizontal underline scope switcher
SettingsEmptyState.tsx
```

> Shipped correction: `SettingsEyebrow.tsx` (group heading style) was
> deleted; `SettingsSection` renders its own label now. The wash card itself
> is `SettingsGroup.tsx`, a separate component one tier down at
> `apps/packages/product-client/src/primitives/patterns/settings/SettingsGroup.tsx`
> (it is domain-unaware, so it lives outside this directory).

ProductClient's `src/components/settings/shared/` keeps `AdminOnlyPlaceholder`, `AgentHarnessConfigComposer`, and `RunCommandHelp`. Layout helpers use concrete ProductClient pattern imports (`#product/primitives/patterns/AutoHideScrollArea` and `#product/primitives/patterns/sidebar/SidebarNavRow`); general controls use concrete root imports such as `#product/primitives/Button`, `#product/primitives/Input`, and `#product/primitives/Switch`.

**Admin gating**: unchanged model. All Org-scope rows are marked `adminOnly`; `SettingsSidebar` hides them for non-admins via `useIsAdmin(activeOrganizationId)`, and `SettingsScreen` redirects a non-admin deep link at an admin-only section to the default section once the role check resolves. `TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION` (currently `false`) can force-show admin rows during UI iteration. Pane bodies still own their detailed read/write states.

**Legacy Plugins page**: the former top-level Plugins page and catalog screen were removed. The `plugins` name survives only in compatibility deep links, callback paths, and telemetry normalization; supported product navigation lands in Settings > Integrations today. This is the current-state correction, not a retirement of spec 01's accepted future Plugins UI target. The package fold must not invent a moved ProductClient destination for the deleted files; any future surface is implemented from the target contract below with a new live owner.

### 4.2 What remains scaffolded / parked

Connected panes keep their existing feature-owned content: organization profile/members/invitations, billing, secrets (personal + org), org integrations, environments, personal compute, worktree pruning, agent authentication, and agent defaults.

(shipped: `agent-authentication` and `agent-defaults` are no longer connected panes — removed by PR #814 (`f0f8403fa`) and PR #1100 (`7d5894807`); the Agents scope ships as the per-harness panes plus `agent-api-keys`.)

One page is intentionally scaffolded with `SettingsScaffoldPane` (registered in `copy/settings/settings-scaffold-copy.ts`) until its owning feature spec provides a connected body:

```text
organization-model-policy
```

The scaffold establishes the route, sidebar placement, page title, and content ownership boundary without adding a fake model-policy backend. `organization-integrations` graduated to a connected pane (`OrganizationIntegrationsPane`).

Parked (pane kept in code, section not registered in navigation or routing; `PARKED_SECTION_SCOPES` keeps its deep links on the right scope tab):

```text
slack-bot              SlackBotPane — entry points commented out
```

Desktop registers the admin-only `organization-limits` section as **Usage & Limits** and renders `OrganizationBudgetsPane` with real billing, usage, member, timeseries, and limit hooks. Billing is also connected: Desktop and Web both reuse `BillingSettingsSurface`, while their navigation remains surface-specific.

When the user is authenticated and usage metering is enabled, usage renders inside the account popover as `SidebarConsumptionCard`'s status rows — Compute and LLM each as label, percentage used, and remaining balance — rather than as a separate footer trigger. The card preserves truthful loading, unavailable, and ready states for the usage summary. Billing actions are a separate capability-gated concern rather than a prerequisite for showing usage. A supported self-service organization owner gets one Billing action with that owner preserved in the settings route. When Desktop cannot guarantee a destination for the same personal or organization owner represented by the meters, the card renders no action and explains the unavailability.

Personal Integrations and Workflows are top-level app pages rather than Settings sections. Rows outside the target list are marked with a small `tbr` status pill until they are removed or explicitly re-scoped:

```text
Settings / User         Archived chats
```

Support and Desktop updates are not `tbr`.

This spec owns the placement and naming of the Desktop updates settings action. [`desktop-updates.md`](../../engineering/ci-cd/desktop-updates.md) owns what that action does and the rest of the packaged updater and release-notice experience.

## 5. Target Model

### 5.0 Organization control center map

The organization settings surfaces form an organization control center. The shell is still the Desktop Settings shell, but the Admin group is product oriented: organization identity, members, billing, integrations, model policy, and capability limits. Usage and limit data is connected to the current organization APIs.

Each Admin surface carries an implementation maturity label so UI can ship before every backend primitive exists without confusing reviewers about what is real.

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
    to the join flow. Domain auto-join uses the same link but is
    Enterprise-only.

Billing
  maturity: real-now; plan comparison remains described separately below
  owns:
    current plan, Manage action, Proliferate Credits summary, add credits,
    auto top-up, and billing portal.
  rule:
    Desktop and Web reuse BillingSettingsSurface. The Billing page starts with
    current plan and credits. Plan comparison and upgrade detail live inside
    the Manage modal. Stripe portal is the cancellation/payment-method
    surface. Current plan, status, compute units, and LLM credits come only
    from the selected billing owner's server state. Loading, error, disabled,
    and absent-data states are explicit and never substitute deterministic
    plan or balance values.

Usage & Limits
  maturity: real-now, admin-only on Desktop
  owns:
    separate compute and LLM balances and timeseries, organization-member
    usage and drill-down, and organization-wide or per-member limit controls.
  rule:
    organization-limits is registered in Desktop navigation and routing and
    renders OrganizationBudgetsPane. The editor supports organization-wide
    and per-member compute or LLM limits for day or month UTC windows. Web
    does not expose this organization-admin pane.

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
      extras: org-wide secrets, audit trails, custom instance types,
        programmatic access, productivity insights,
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
  (shipped: `worktrees`/`WorktreesPane` removed; `archived-workspaces` /
   `ArchivedWorkspacesPane` took the slot — the real archived-workspaces
   list, sort, search, per-row unarchive/delete, and Delete all, backed by
   the runtime's `lifecycle=archived` filter. It supersedes the speculative
   `archived-chats` row above, which was never built.)

Org (all adminOnly)
  organization             OrganizationPane               org profile
  organization-members     OrganizationMembersPane        members, invitation emails,
                                                           invite link
  billing                  BillingPane                    billing as an org,
                                                           including auto top up option
  organization-limits     OrganizationBudgetsPane         Usage & Limits; connected
                                                           usage and limit controls
  organization-secrets     OrganizationSecretsPane        org-wide secrets
  Policies
    organization-integrations OrganizationIntegrationsPane org-owned integrations
    organization-model-policy SettingsScaffoldPane         allowed/default models
Repo
  environments             EnvironmentsPane               environments
  compute                  ComputePane                    personal compute / SSH targets

Agents
  agent-defaults           AgentDefaultsPane              per-person agent defaults
  agent-authentication     AgentAuthenticationPane        local + cloud auth by person
  (shipped: agent-claude/-codex/-opencode/-grok HarnessPane + agent-api-keys;
   the two rows above were removed — see the staleness note at the top)

Slack bot                  SlackBotPane                   (parked/disabled;
                                                           spec 07 (document
                                                           retired; the Slack
                                                           bot was never built)
                                                           logic is preserved
                                                           but entry points are
                                                           commented out)

Help (sidebar footer, every scope)
  support                  action (existing)
  check-for-updates        action (existing)
```

Section ids (`apps/packages/product-client/src/config/settings.ts`):

```text
SETTINGS_CONTENT_SECTIONS is the registry of valid section ids. The visible
sidebar filters it through `featureAvailable` / owner-spec readiness; registered
does not mean visible.
```

```typescript
SETTINGS_CONTENT_SECTIONS = [
  "general", "appearance", "keyboard", "account", "personal-secrets",
  "organization", "organization-secrets", "organization-members",
  "billing", "organization-limits", "organization-integrations",
  "organization-model-policy", "environments", "compute",
  "worktrees", "archived-chats", "agent-authentication",
  "agent-defaults",
]
```

> Shipped correction: same as the §4.1 correction above — the registered
> array
> ([config/settings.ts](../../../apps/packages/product-client/src/config/settings.ts))
> carries `agent-claude`/`agent-codex`/`agent-opencode`/`agent-grok`/
> `agent-api-keys` instead of `agent-authentication`/`agent-defaults`,
> plus `integrations`, `repo-actions`, `repo-environment`, and
> `archived-workspaces`; `keyboard`, `worktrees`, `archived-chats`, and
> `compute` were removed.

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

> Shipped correction: this split did ship — `?section=cloud` redirected to
> `agent-authentication` (`navigation.ts`, pre-#814). PR #814 (`f0f8403fa`)
> then removed that pane, and the Agent Authentication slice now lands on the
> per-harness panes plus the `agent-api-keys` pool; the `cloud` redirect is
> focus-dependent (repo focus → `environments`, billing focus → `billing`).

Preserved id (superseded):

```text
"worktrees"     Remains a top-level Workspaces section because cleanup spans
                all environments.
```

> Shipped correction: `worktrees` did not stay preserved. The runtime's
> `lifecycle` filter replaced client-side worktree cleanup as the truth
> about which workspaces exist, so the dedicated "Pruning" pane had nothing
> left to own and was removed; `archived-workspaces` took its nav slot.

The `?section=<id>` URL scheme is preserved. Old urls that point at `?section=repo` or `?section=cloudRepo` redirect to `?section=environments`; removed `shared-environments` and parked `slack-bot` redirect to the default section. Shipped redirects differ from this spec's originals: `?section=agent-authentication` goes to `agent-api-keys`, `agent-defaults` to `agent-claude`, and `?section=cloud` is focus-dependent (repo focus → `environments`, billing focus → `billing`) — see `normalizeSettingsSection` and `cloudRedirectSection` in [navigation.ts](../../../apps/packages/product-client/src/lib/domain/settings/navigation.ts).

### 5.2 Per-page ownership

Each pane is owned by one spec for content; spec 03 owns the shell and shared primitives the pane consumes.

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
  (shipped: `worktrees` removed; `archived-workspaces` — the archiving-
   workspaces train's R7 delivery spec — took the slot instead)

Org
  organization              spec 03 + 05  org profile, billing cross-link
  organization-members      spec 03 + 05  members, invitation emails,
                                       invite link
  billing                   Billing platform   current plan, PCUs, add credits,
                                       auto top up, Stripe portal, plan changes
  organization-limits      Billing platform   Usage & Limits: connected usage by meter
                                       and person, plus organization and member
                                       limit controls
  organization-secrets      spec 03 (shell) + secrets story (content)
  organization-integrations org integrations spec
  organization-model-policy future model policy spec
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
                                       (spec 06 document retired; no current
                                        Automations system spec)
  (shipped: `AgentDefaultsPane` was built (added by `ec1271420`, "Add
   agent launch defaults settings"), registered, and rendered with a
   "Defaults" sidebar row, then removed by PR #1100 (`7d5894807`,
   "remove Agent Defaults settings page; defaults from catalog +
   last-used-wins"); the `agent-defaults` id now redirects to
   `agent-claude` — see `normalizeSettingsSection` in
   navigation.ts:41-48.)
  agent-authentication      spec 02   CloudAgentAuthLibrary (per-org and
                                       personal credentials) + per-target
                                       ComputeTargetAgentAuthCard. The
                                       same pane is sandbox-aware:
                                       admins see selection for shared
                                       sandbox; everyone sees personal.
  (shipped: the row above was removed. Per-harness pages own auth via
   method cards; the key pool is agent-api-keys. Contract:
   agent-auth.md — see the staleness note at the top.)

Slack bot (parked)          spec 07   install/reconnect, repo routing,
                                       default agent_run_config, shared
                                       readiness summary
                                       (spec 07 document retired; the Slack
                                        bot was never built)

Help/support                spec 03   support dialog
Help/check-for-updates      spec 03   updater
```

### 5.3 Shared vocabulary

These strings are the shared presentation vocabulary. Specs that own server schema changes must emit the same strings on the wire and in DB CHECKs when they add those fields, but spec 03 itself is a frontend IA spec and does not add DB/API fields. Convention: snake_case for machine values (DB-friendly, matches existing `owner_scope='personal'`, `kind='managed_cloud'`). Human- readable labels live in copy and convert at render time.

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

Spec 04/05 add `cloud_workspace_exposure.visibility` using these values. Spec 05 (claiming) keeps claim as a one-way transition; there is no `admin_managed` state. Admins gain audit view via the `useIsAdmin` hook and the `scope=org-all` listing endpoint, not via a separate visibility state.

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
apps/packages/product-client/src/domain/settings/vocabulary.ts      (new)
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
generated TS types match product-client/src/domain/settings/vocabulary.ts at the character
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
PageHeader                  apps/packages/product-client/src/primitives/patterns/PageHeader.tsx
SettingsSection             apps/packages/product-client/src/primitives/patterns/settings/SettingsSection.tsx
SettingsRow                 apps/packages/product-client/src/primitives/patterns/settings/SettingsRow.tsx
SettingsScopeTabs / SettingsEmptyState
                            same directory as SettingsSection / SettingsRow
```

> Shipped correction: `SettingsEyebrow.tsx` was deleted by the settings
> "wash" restyle. `SettingsSection` now renders its own sentence-case muted
> label directly (or a `titleWeight="emphasized"` variant) over a new
> `SettingsGroup` wash card
> (`apps/packages/product-client/src/primitives/patterns/settings/SettingsGroup.tsx`),
> which owns the inset hairline divider between rows; `SettingsRow` no
> longer draws its own border. `SettingsSection` and `SettingsRow` above are
> restyled by the same change; their contracts (props, ownership) are
> unchanged.

New (spec 03 introduces; feature specs consume):

```text
CredentialPicker
  apps/packages/product-client/src/components/settings/shared/CredentialPicker.tsx
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
  (shipped: never built — both consumers were removed with the
   Bifrost-era pane; the per-harness key picker lives in the harness
   pane's API-key details instead)

AgentRunConfigSelector
  apps/packages/product-client/src/components/settings/shared/AgentRunConfigSelector.tsx
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
    Automation create dialog (spec 06 — document retired; no current
      Automations system spec)
    Slack bot config (spec 07 — document retired; the Slack bot was
      never built)
  (shipped: `AgentRunConfigSelector` was never built — a zero-hit grep
   across apps/desktop and apps/packages on main. Its one listed
   consumer, `AgentDefaultsPane`, was built but was removed by PR #1100
   (`7d5894807`); see the correction on the `agent-defaults` row above.)

RuntimeReadinessPanel
  apps/packages/product-client/src/components/settings/shared/RuntimeReadinessPanel.tsx
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
  apps/packages/product-client/src/components/settings/shared/PublicCapabilityList.tsx
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
  apps/packages/product-client/src/components/settings/shared/WhereUsedDrawer.tsx
  Props:
    subject              { kind: 'mcp' | 'skill' | 'plugin' | 'credential',
                           id }
  Renders:
    a side drawer showing every sandbox, automation, Slack config,
    and live session that depends on this subject. Read-only.
  Used by:
    PluginsPage detail
    CloudAgentAuthLibrary credential detail
  (shipped: the CloudAgentAuthLibrary consumer was removed with the
   Bifrost-era pane)
```

**Status badge convention** (existing `Badge` primitive, new shared status variants):

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

apps/packages/product-client/src/components/settings/shared/StatusBadge.tsx   (new wrapper
  over the existing Badge primitive that maps a status enum value to
  variant + label + tooltip)
```

**Form / list-detail pattern**: all panes use `SettingsSection` + `SettingsRow` for primary content. List-detail flows (e.g. Compute targets) open a detail panel inside the same content area, not a modal, unless the action is destructive. Modals use `ModalShell`; destructive actions use `ConfirmationDialog`.

### 5.5 Admin gating

New hook:

```text
apps/packages/product-client/src/hooks/access/cloud/organizations/use-is-admin.ts

useIsAdmin(organizationId: string | null | undefined): {
  isLoading: boolean
  isAdmin: boolean           true when role === 'owner' || 'admin'
  role: 'owner' | 'admin' | 'member' | null
}
```

Replaces all inline `role === "owner" || role === "admin"` checks. Pane gates render with:

```tsx
const { isAdmin } = useIsAdmin(organizationId);
if (!isAdmin) return <AdminOnlyPlaceholder />;
```

`AdminOnlyPlaceholder`:

```text
apps/packages/product-client/src/components/settings/shared/AdminOnlyPlaceholder.tsx
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

`useIsAdmin` reuses the existing `useOrganizationMembers()` hook under the hood; this is purely a consolidation.

### 5.6 Target Plugins page placement

When spec 01's Plugins UI target is implemented, it is a **top-level page**, not a Settings pane. No `PluginsPage.tsx` is shipping today. Target reasons:

```text
- Plugins is a marketplace-ish discovery surface; settings panes are
  configuration surfaces. Mixing them dilutes both.
- The Plugins page is larger and richer (catalog grid, detail modals)
  than the rest of Settings.
- The target is a dedicated discovery surface rather than another Settings
  pane; it does not restore or move the deleted implementation files.
```

Cross-links:

```text
The Workspace section in Settings will show a "Manage plugins" card linking to
the future top-level surface. Per-target ComputeTargetReadiness will deep-link
plugin readiness issues to that surface filtered by the relevant MCP/skill.
```

The target Plugins surface stays outside the Settings sidebar. Until spec 01 implements it, Settings > Integrations is the supported current destination.

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

> Shipped correction: the two `agent-authentication` deep links do not
> exist (the pane was removed); legacy hits redirect to
> `agent-api-keys`. Per-harness pages are their own sections
> (`?section=agent-claude` etc.), no `kind` param.

`useSettingsNavigation()` exposes the focus param so panes can scroll to / open the right card.

Settings does **not** move to a path-based route in this spec. Search params are sufficient and the existing URL state survives.

### 5.8 Copy

Copy stays in `copy/<domain>/<domain>-copy.ts` per the existing rule. New copy files added by this spec:

```text
apps/packages/product-client/src/copy/settings/vocabulary-copy.ts
apps/packages/product-client/src/copy/settings/admin-gate-copy.ts
apps/packages/product-client/src/copy/settings/shared-environments-copy.ts
apps/packages/product-client/src/copy/settings/agent-authentication-copy.ts
apps/packages/product-client/src/copy/settings/slack-bot-copy.ts
```

> Shipped correction: agent auth copy lives in
> [harness-pane.ts](../../../apps/packages/product-client/src/copy/settings/harness-pane.ts),
> [agent-auth-copy.ts](../../../apps/packages/product-client/src/copy/settings/agent-auth-copy.ts),
> and
> [agent-api-keys-copy.ts](../../../apps/packages/product-client/src/copy/settings/agent-api-keys-copy.ts);
> no `agent-authentication-copy.ts` exists.

Existing `copy/settings/*` files are kept; rename inside copy follows the section-id renames.

### 5.9 Telemetry

Pane open/close events follow the existing analytics pattern in `apps/packages/product-client/src/lib/domain/telemetry/events.ts` and its connected telemetry hooks. New events:

```text
settings_pane_opened    { sectionId, organizationId? }
settings_pane_closed    { sectionId, durationMs }
admin_gate_blocked      { sectionId, organizationId }
```

The vocabulary above is logged verbatim in event payloads.

## 6. Files To Change

ProductClient:

```text
apps/packages/product-client/src/config/settings.ts
  - register the User/Org/Repo/Agents section ids
  - keep general as the default settings section

apps/packages/product-client/src/lib/domain/settings/navigation.ts
  - normalize/build Settings location for all registered ids
  - keep legacy repo/cloud/cloudRepo redirect behavior

apps/packages/product-client/src/lib/domain/settings/navigation-presentation.ts
  - scopes: user | org | repo | agents (SETTINGS_SCOPES), plus
    SETTINGS_SCOPE_ORDER/LABELS, SETTINGS_HELP_ITEMS,
    scope<->section mapping, PARKED_SECTION_SCOPES
  - adminOnly metadata on Org-scope rows

apps/packages/product-client/src/primitives/patterns/settings/SettingsScopeTabs.tsx
  - horizontal underline scope switcher consumed by SettingsScreen

apps/packages/product-client/src/components/settings/sidebar/SettingsSidebar.tsx
  - 240px rail rendering the active scope's groups + help footer
  - hide adminOnly rows for non-admins
  - per-scope Cmd-digit shortcut labels

apps/packages/product-client/src/components/settings/screen/SettingsScreen.tsx
  - scope-tab header row; scope change selects the scope's first section
  - render SettingsScaffoldPane for scaffolded pages
  - redirect non-admins away from admin-only sections
  - thread focus param to active pane

apps/packages/product-client/src/components/settings/panes/
  SettingsScaffoldPane.tsx            renders scaffolded page rows
  OrganizationPane.tsx                existing org settings
  BillingPane.tsx                     existing connected billing
  ComputePane.tsx                     existing personal compute / SSH targets

apps/packages/product-client/src/copy/settings/settings-scaffold-copy.ts
  - page titles, descriptions, and rows for scaffolded pages

apps/packages/product-client/src/copy/settings/compute.ts
  - labels compute as Personal compute

apps/packages/product-client/src/components/settings/panes/billing/BillingSettingsSurface.tsx
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
apps/packages/product-client/src/lib/domain/telemetry/events.ts
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
   (shipped: `worktrees` was removed instead; `archived-workspaces`
   ("Archived workspaces") is the first-class User section that replaced it.)
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
   (shipped: `&credential=` and `&kind=` do not exist — `FOCUS_PARAM_NAMES`
    in navigation.ts has neither; see the §5.7 correction. Only
    `&target=` and `&repo=` are real deep-link params.)
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
pnpm --filter @proliferate/product-client test
pnpm --filter @proliferate/product-client typecheck
```

Targeted tests:

```text
apps/packages/product-client/src/components/settings/sidebar/SettingsSidebar.test.tsx
  - renders the active scope's groups in order
  - adminOnly rows render for admins
  - adminOnly rows are hidden for non-admins

apps/packages/product-client/src/components/settings/screen/SettingsScreen.test.tsx
  - ?section=repo redirects to ?section=environments
  - ?section=cloud redirects to ?section=agent-authentication
    (shipped: focus-dependent, see 5.7 correction)
  - ?section=worktrees resolves to Pruning (User scope)
    (shipped: `worktrees` no longer resolves anywhere; `?section=archived-workspaces`
    resolves to "Archived workspaces" (User scope) instead)

apps/packages/product-client/src/hooks/access/cloud/organizations/use-is-admin.test.ts
  - returns role from useOrganizationMembers
  - returns isAdmin true for owner/admin
  - returns isAdmin false for member or no membership

apps/packages/product-client/src/domain/settings/vocabulary.test.ts
  - enum string values match §5.3 verbatim

apps/packages/product-client/src/components/settings/panes/billing/BillingSettingsSurface.test.tsx
  - renders Billing and the auto top up option
```

Manual smoke:

```text
1. Open Settings as a non-admin org member.
     -> Org-scope admin rows are hidden.
     -> Deep-linking an admin-only section redirects to General.
     -> Agents > Authentication is enabled (personal selection
        still allowed).
     (shipped: there is no "Agents > Authentication" pane; the
      per-harness panes and agent-api-keys have no admin gate, so
      this is true in effect via the shipped path)

2. Open Settings as an org owner.
     -> Org scope tab shows all admin rows, enabled.

3. Open Settings with ?section=cloud.
     -> redirects to ?section=agent-authentication.
     (shipped: focus-dependent redirect — repo focus to environments,
      billing focus to billing)

4. Open ?section=agent-authentication&kind=claude.
     -> AgentAuthenticationPane opens with the Claude agent kind
        preselected.
     (shipped: redirects to ?section=agent-api-keys; the per-harness
      page is ?section=agent-claude)

5. After spec 01 implements the Plugins target, open its top-level page.
     -> Opens outside the Settings sidebar and accepts the target deep links.
     -> Before that implementation lands, no Plugins page is expected;
        Settings > Integrations is the supported current destination.

6. Check the shell frame.
     -> Scope-tab header row is 46px; sidebar rail is 240px fixed;
        no horizontal scroll inside nav.
     -> Cmd-digit shortcuts map to the active scope's visible rows.
```
