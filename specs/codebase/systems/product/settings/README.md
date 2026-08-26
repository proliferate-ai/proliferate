# Settings

The settings surface: one route (`/settings?section=…`) hosting user-scope,
organization-scope, repository-scope, and per-agent panes. A **client
composition surface** — it renders and mutates records owned by accounts,
organizations, billing, agent auth, integrations, the runtime's agent
catalog, and the user's preferences; it owns only navigation state and
drafts. The focused documents below are its sections.

| Section | Document |
| --- | --- |
| Information architecture (scopes, sections, admin state) — target | [information-architecture.md](information-architecture.md) |
| Appearance scaling gate and preference — target | [appearance-scaling.md](appearance-scaling.md) |
| Billing surfaces' semantics | [BILLING.md](../../../../FEATURE_DOCS/BILLING.md) |
| Agent auth panes' semantics | [AGENT_AUTH.md](../../../../FEATURE_DOCS/AGENT_AUTH.md), [MODELS.md](../../../../FEATURE_DOCS/MODELS.md) |
| Organization invitations and members | [../organizations/invitations.md](../organizations/invitations.md) |

## Purpose

Let a person (or an org admin) configure their account, appearance, agents
and their credentials, integrations, repositories, organization, and plan —
each pane a thin editor over the owning system's contract, with the blocked
layer named rather than hidden.

## Owned state

| State | Holds | Code |
| --- | --- | --- |
| Section registry | The closed list of sections and their ⌘-number order | [config/settings.ts](../../../../../apps/packages/product-client/src/config/settings.ts) |
| Navigation | Route ⇄ section/repo/scope resolution, return-to context (billing checkout, org join, OAuth flow) | [use-settings-navigation.ts](../../../../../apps/packages/product-client/src/hooks/settings/workflows/use-settings-navigation.ts), [lib/domain/settings/navigation.ts](../../../../../apps/packages/product-client/src/lib/domain/settings/navigation.ts) |
| Drafts | Cloud-environment and repo-environment editors, harness auth editor | [use-cloud-environment-draft.ts](../../../../../apps/packages/product-client/src/hooks/settings/workflows/use-cloud-environment-draft.ts), [use-harness-auth-editor.ts](../../../../../apps/packages/product-client/src/hooks/agents/workflows/use-harness-auth-editor.ts) |
| User/repo preferences | Appearance, zoom, worktree auto-delete adoption, repo preferences — persisted through the host | [user-preferences-store.ts](../../../../../apps/packages/product-client/src/stores/preferences/user-preferences-store.ts), [repo-preferences-store.ts](../../../../../apps/packages/product-client/src/stores/preferences/repo-preferences-store.ts) |
| Active organization | Selected organization id for org-scoped panes | [organization-store.ts](../../../../../apps/packages/product-client/src/stores/organizations/organization-store.ts) |

## Public surface

- [`SettingsPage`](../../../../../apps/packages/product-client/src/pages/SettingsPage.tsx)
  → [`SettingsScreen`](../../../../../apps/packages/product-client/src/components/settings/screen/SettingsScreen.tsx):
  the route entry; other surfaces navigate with
  `buildSettingsHref({ section, … })` from
  [navigation.ts](../../../../../apps/packages/product-client/src/lib/domain/settings/navigation.ts)
  — never by string.
- Gate panes reused elsewhere:
  [`UpgradeGateDialog`](../../../../../apps/packages/product-client/src/components/billing/UpgradeGateDialog.tsx)
  and the cloud-unavailable/sign-in-required panes are mounted by other
  surfaces when a Cloud capability is blocked.
- [`AgentHarnessConfigComposer`](../../../../../apps/packages/product-client/src/components/settings/shared/AgentHarnessConfigComposer.tsx)
  is the shared harness-config editor the Home readiness card also uses.

## Consumes

| Owning system | Contract consumed | Where |
| --- | --- | --- |
| Accounts / product auth (Cloud) | sign-in methods, password credential, GitHub user authorization | [AccountSettingsPane.tsx](../../../../../apps/packages/product-client/src/components/settings/panes/account/AccountSettingsPane.tsx), `useProductAuth` |
| Organizations (Cloud, `@proliferate/cloud-sdk/client/organizations`) | members, invitations, join links, switch | [hooks/access/cloud/organizations/](../../../../../apps/packages/product-client/src/hooks/access/cloud/organizations/use-organizations.ts) |
| Billing (Cloud) | plan, credits, usage timeseries, checkout/portal return | [use-cloud-billing.ts](../../../../../apps/packages/product-client/src/hooks/access/cloud/use-cloud-billing.ts), [billing-return.ts](../../../../../apps/packages/product-client/src/lib/access/cloud/billing-return.ts) |
| Agent auth + model gateway (Cloud `agent-gateway`, `auth`) | selections, enrollment, org model policy, limits/budgets, API keys | `useAuthSelections`, `useAgentGatewayEnrollment` (`@proliferate/cloud-sdk-react`); panes under [agents/harness/](../../../../../apps/packages/product-client/src/components/settings/panes/agents/harness/HarnessPane.tsx) |
| Agent catalog + install (runtime `agents`) | installed harnesses, models table, install/reconcile, CLI login terminal | [use-agent-catalog.ts](../../../../../apps/packages/product-client/src/hooks/agents/derived/use-agent-catalog.ts), [use-harness-install-action.ts](../../../../../apps/packages/product-client/src/hooks/agents/workflows/use-harness-install-action.ts) |
| Integrations (Cloud `integrations`) | catalog, connect (OAuth flow), health, admin definitions | [hooks/access/cloud/integrations/](../../../../../apps/packages/product-client/src/hooks/access/cloud/integrations/use-integration-catalog.ts) |
| GitHub App (Cloud `github-app`) | installation state, user authorization | [use-github-app-installation.ts](../../../../../apps/packages/product-client/src/hooks/settings/workflows/use-github-app-installation.ts) |
| Secrets (Cloud `cloud-secrets`) | personal + organization secret CRUD | `PersonalSecretsPane`, `OrganizationSecretsPane` |
| Repositories (runtime `repoRoots`, `worktrees`) | repo actions, commit instructions, worktree storage | [use-repository-settings.ts](../../../../../apps/packages/product-client/src/hooks/settings/workflows/use-repository-settings.ts) |
| Archived workspaces (runtime `workspaces`) | list, unarchive scenarios | [use-archived-workspaces.ts](../../../../../apps/packages/product-client/src/hooks/workspaces/cache/use-archived-workspaces.ts) |
| Host | preference persistence, zoom, theme | [ProductHost.storage](../../../../../apps/packages/product-client/src/host/product-host.ts) |

The `environments` / `repo-environment` sections edit cloud environment
records that belong to the dark cloud lane (deleted by the dark-cloud cull
part 2); they render behind the cloud gate today.

## Laws

- **Sections are a closed registry.** A pane exists only if its id is in
  `SETTINGS_CONTENT_SECTIONS`; navigation resolves unknown ids to the
  default section rather than rendering a blank
  ([resolveSettingsSelection](../../../../../apps/packages/product-client/src/lib/domain/settings/navigation.ts)).
- **Scope is explicit.** User, organization, repository, and agent scopes
  render distinct header controls and never share a draft
  ([information-architecture.md](information-architecture.md)).
- **Blocked means named.** When Cloud, auth, billing, or admin role blocks a
  pane, the pane names the blocked layer
  (`CloudSignInRequiredPane`, `CloudUnavailablePane`, `AdminOnlyPlaceholder`,
  `UpgradeGateDialog`) instead of hiding the section.
- **Agent auth edits are ack-gated.** A harness auth or selection edit shows
  pending until the gateway acks it; evidence badges reflect delivery state,
  never local optimism
  ([agent-auth-evidence.ts](../../../../../apps/packages/product-client/src/lib/domain/settings/agent-auth-evidence.ts)).
- **Preferences round-trip through the host.** Appearance, zoom, and repo
  preferences persist via lifecycle hooks and `ProductHost.storage`; no pane
  writes localStorage directly
  ([hooks/preferences/lifecycle/](../../../../../apps/packages/product-client/src/hooks/preferences/lifecycle/use-user-preferences-lifecycle.ts)).
- **Appearance scaling obeys the gate.** Panes use semantic scale classes
  only; the appearance-scaling checker bans literal sizes
  ([appearance-scaling.md](appearance-scaling.md),
  [check_appearance_scaling.py](../../../../../scripts/check_appearance_scaling.py)).

## Emits

- Navigation (return-to) intents consumed by billing checkout, org join,
  and integration OAuth flows.
- Preference changes (theme, zoom, scaling) applied app-wide by the
  preference lifecycles.
- Toasts for save/connect/disconnect outcomes.

## Fences

- **Onboarding** owns the first-run readiness path; settings is where a
  person returns to change what onboarding set
  ([../onboarding/README.md](../onboarding/README.md)).
- **Agent auth / model gateway** owns selection, enrollment, and policy
  semantics; settings renders them
  ([AGENT_AUTH.md](../../../../FEATURE_DOCS/AGENT_AUTH.md)).
- **Integrations** (integration gateway) owns connection lifecycle, health,
  and grants; settings only starts connect flows and shows health.
- **Billing** owns plans, credits, and gates
  ([BILLING.md](../../../../FEATURE_DOCS/BILLING.md)).
- **Workspace surface** owns archived-workspace restore mechanics; the pane
  is a list over its cache ([../workspaces/README.md](../workspaces/README.md)).
- **Design system** owns the settings kit (`primitives/patterns/settings/`)
  and the scaffold pane ([DESIGN_SYSTEM.md](../../../../DESIGN_SYSTEM.md)).
- Layer law and frozen edges: [frontend/README.md](../../../../frontend/README.md#what-goes-where),
  [FE-FENCE-001](../../../../../lints/frontend/fences.toml).

## Code map

```text
apps/packages/product-client/src/
├── config/settings.ts                           the section registry + ⌘ order
├── lib/domain/settings/                         navigation, repo-scope selection, presentation,
│                                                harness catalog/auth sources/evidence, admin roles
├── hooks/settings/{workflows,derived,ui}/       navigation, billing/github/repo/env workflows
├── hooks/agents/                                catalog, install, auth editor, login terminal
├── hooks/access/cloud/{organizations,integrations,billing}/   query/mutation wrappers
├── hooks/preferences/                           appearance/zoom/user/repo preference lifecycles
├── stores/preferences/ · stores/organizations/
├── components/settings/
│   ├── screen/       SettingsScreen, scope header controls, section renderer
│   ├── sidebar/      SettingsSidebar (scoped groups)
│   ├── panes/        one folder or file per section: account/, agents/{harness,api-keys}/,
│   │                 integrations/, organization/, repo/, archived/, billing/, environments/,
│   │                 Appearance, General, Personal/Organization secrets, model policy, limits
│   └── shared/       AdminOnlyPlaceholder, AgentHarnessConfigComposer, RunCommandHelp
├── components/billing/                          plan comparison, upgrade gate, owner card
├── components/organizations/OrganizationAvatar.tsx
├── copy/settings/
└── pages/SettingsPage.tsx · pages/SettingsCloudRedirect.tsx
```

Target moves (later sweep wave): `components/settings/panes/agents/**` +
`hooks/agents` → `systems/agent_auth/` (client half), integrations panes →
`systems/integrations/`, billing panes → `systems/billing/`; `settings`
keeps the screen, sidebar, navigation, account, appearance, general.

## Proof

- Unit: `lib/domain/settings` (17), `components/settings/panes/agents/harness`
  (11), `lib/domain/agents` (12) test files;
  [SettingsSidebar.test.tsx](../../../../../apps/packages/product-client/src/components/settings/sidebar/SettingsSidebar.test.tsx)
  pins the visible group headings (a cull that empties a group must update
  it — see #2218). `pnpm --filter @proliferate/product-client test`.
- Appearance scaling gate: `python3 scripts/check_appearance_scaling.py`
  (CI "Repo shape checks").
- Auth-flow integration (server side of the same contracts):
  `tests/integration/test_auth_flow*` in the server suite.
- Manual: settings and billing rows of
  [manual-release-qa.md](../../../../TESTING/manual-release-qa.md);
  `STRIPE=1` lanes per
  [stripe-local-testing.md](../../../../../guides/local/stripe-local-testing.md).

## Known gaps / follow-ups

- [information-architecture.md](information-architecture.md) is dated
  2026-05-20 and still describes the managed-Target UI as its gap; the
  section registry above is current, the IA document's target has not been
  re-baselined since the SSO (#2218) and cloud culls.
- `OrganizationBudgetsPane` / `OrganizationLimitsEditor` render the budget
  primitives slated for rebuild as run envelopes; keep them thin.
- The `slack-bot` section is parked in the registry comment pending the
  product Slack app.
