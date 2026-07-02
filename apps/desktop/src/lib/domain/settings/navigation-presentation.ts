import type { SettingsSection } from "@/config/settings";

export type SettingsNavIconId =
  | "account"
  | "agent-api-keys"
  | "agent-defaults"
  | "appearance"
  | "billing"
  | "check-for-updates"
  | "environments"
  | "general"
  | "integrations"
  | "organization"
  | "organization-integrations"
  | "organization-limits"
  | "organization-members"
  | "organization-model-policy"
  | "organization-secrets"
  | "organization-sso"
  | "personal-secrets"
  | "repo-actions"
  | "repo-environment"
  | "support"
  | "worktrees";

export type SettingsNavItem =
  | {
    kind: "section";
    id: SettingsSection;
    label: string;
    iconId: SettingsNavIconId;
    adminOnly?: boolean;
  }
  | {
    kind: "action";
    id: "checkForUpdates" | "support";
    label: string;
    iconId: SettingsNavIconId;
  };

export interface SettingsNavGroup {
  id: string;
  heading: string | null;
  items: SettingsNavItem[];
}

/**
 * Top-level settings scopes, surfaced as horizontal scope tabs
 * (User · Org · Repo · Agents), each with its own short section sidebar.
 * Mirrors the design-system settings IA (surfaces/SETTINGS_IA.md).
 */
export type SettingsScope = "user" | "org" | "repo" | "agents";

export const SETTINGS_SCOPE_ORDER: SettingsScope[] = ["user", "org", "repo", "agents"];

export const SETTINGS_SCOPE_LABELS: Record<SettingsScope, string> = {
  user: "User",
  org: "Org",
  repo: "Repo",
  agents: "Agents",
};

export interface SettingsScopeNav {
  scope: SettingsScope;
  groups: SettingsNavGroup[];
}

export const SETTINGS_SCOPES: SettingsScopeNav[] = [
  {
    scope: "user",
    groups: [
      {
        id: "user_main",
        heading: null,
        items: [
          { kind: "section", id: "account", label: "Account", iconId: "account" },
          { kind: "section", id: "general", label: "General", iconId: "general" },
          { kind: "section", id: "appearance", label: "Appearance", iconId: "appearance" },
          { kind: "section", id: "personal-secrets", label: "Personal secrets", iconId: "personal-secrets" },
          { kind: "section", id: "integrations", label: "Integrations", iconId: "integrations" },
          { kind: "section", id: "worktrees", label: "Pruning", iconId: "worktrees" },
        ],
      },
    ],
  },
  {
    scope: "org",
    groups: [
      {
        id: "org_main",
        heading: null,
        items: [
          { kind: "section", id: "organization", label: "Organization settings", iconId: "organization", adminOnly: true },
          { kind: "section", id: "organization-members", label: "Members", iconId: "organization-members", adminOnly: true },
          { kind: "section", id: "billing", label: "Billing", iconId: "billing", adminOnly: true },
          { kind: "section", id: "organization-secrets", label: "Organization secrets", iconId: "organization-secrets", adminOnly: true },
          { kind: "section", id: "organization-integrations", label: "Integrations", iconId: "organization-integrations", adminOnly: true },
        ],
      },
      {
        id: "org_policies",
        heading: "Policies",
        items: [
          { kind: "section", id: "organization-model-policy", label: "Model policy", iconId: "organization-model-policy", adminOnly: true },
        ],
      },
      {
        id: "org_auth",
        heading: "Authentication",
        items: [
          { kind: "section", id: "organization-sso", label: "Single sign-on", iconId: "organization-sso", adminOnly: true },
        ],
      },
    ],
  },
  {
    scope: "repo",
    groups: [
      {
        id: "repo_main",
        heading: null,
        items: [
          { kind: "section", id: "environments", label: "Configure", iconId: "environments" },
          { kind: "section", id: "repo-actions", label: "Actions", iconId: "repo-actions" },
          { kind: "section", id: "repo-environment", label: "Environment", iconId: "repo-environment" },
        ],
      },
    ],
  },
  {
    scope: "agents",
    groups: [
      {
        id: "agents_main",
        heading: null,
        items: [
          { kind: "section", id: "agent-defaults", label: "Defaults", iconId: "agent-defaults" },
          { kind: "section", id: "agent-api-keys", label: "API keys", iconId: "agent-api-keys" },
        ],
      },
    ],
  },
];

/** Global help actions — shown at the sidebar footer regardless of scope. */
export const SETTINGS_HELP_ITEMS: SettingsNavItem[] = [
  { kind: "action", id: "support", label: "Support", iconId: "support" },
  { kind: "action", id: "checkForUpdates", label: "Desktop updates", iconId: "check-for-updates" },
];

function scopeSectionItems(nav: SettingsScopeNav): Extract<SettingsNavItem, { kind: "section" }>[] {
  return nav.groups.flatMap((group) =>
    group.items.flatMap((item) => (item.kind === "section" ? [item] : []))
  );
}

const SECTION_TO_SCOPE = new Map<SettingsSection, SettingsScope>(
  SETTINGS_SCOPES.flatMap((nav) =>
    scopeSectionItems(nav).map((item) => [item.id, nav.scope] as const)
  ),
);

/**
 * Parked sections that are not registered in any scope nav but can still be
 * reached (e.g. via deep links while their panes are being revived). Mapping
 * them here keeps the correct scope tab highlighted instead of falling back
 * to "user".
 */
const PARKED_SECTION_SCOPES: Partial<Record<string, SettingsScope>> = {
  "organization-limits": "org",
  "slack-bot": "org",
};

export function getSettingsScopeForSection(section: SettingsSection): SettingsScope {
  return SECTION_TO_SCOPE.get(section) ?? PARKED_SECTION_SCOPES[section] ?? "user";
}

export function getSettingsScopeNav(scope: SettingsScope): SettingsScopeNav {
  return SETTINGS_SCOPES.find((nav) => nav.scope === scope) ?? SETTINGS_SCOPES[0];
}

/** First section of a scope — the landing section when the scope tab is selected. */
export function getFirstSectionForScope(scope: SettingsScope): SettingsSection {
  const [first] = scopeSectionItems(getSettingsScopeNav(scope));
  return first?.id ?? "general";
}

const SETTINGS_ADMIN_ONLY_SECTIONS = new Set<SettingsSection>(
  SETTINGS_SCOPES.flatMap((nav) =>
    scopeSectionItems(nav).flatMap((item) => (item.adminOnly === true ? [item.id] : []))
  ),
);

export function isSettingsAdminOnlySection(section: SettingsSection): boolean {
  return SETTINGS_ADMIN_ONLY_SECTIONS.has(section);
}
