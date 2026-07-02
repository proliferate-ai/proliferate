export const SETTINGS_CONTENT_SECTIONS = [
  "account",
  "general",
  "appearance",
  "personal-secrets",
  "integrations",
  "organization",
  "organization-secrets",
  "organization-members",
  "billing",
  "organization-sso",
  "organization-integrations",
  "organization-model-policy",
  "environments",
  "repo-actions",
  "repo-environment",
  "worktrees",
  "agent-defaults",
  // BUDGETS PARKED: keep OrganizationBudgetsPane in code, but do not register
  // the page until real budget data/enforcement replaces mocked UI.
  // "organization-limits",
  // SLACK BOT PARKED: keep the id nearby for revival, but do not register it.
  // "slack-bot",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];

export const SETTINGS_DEFAULT_SECTION: SettingsSection = "general";

export const TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION = false;

// User scope numbering: ⌘1 account, ⌘2 general, ⌘3 appearance,
// ⌘4 personal secrets, ⌘5 pruning (worktrees).
export const SETTINGS_SHORTCUT_SECTION_ORDER = [
  "account",
  "general",
  "appearance",
  "personal-secrets",
  "integrations",
  "organization",
  "organization-secrets",
  "organization-members",
  "billing",
  "organization-sso",
  "organization-integrations",
  "organization-model-policy",
  "environments",
  "repo-actions",
  "repo-environment",
  "worktrees",
  "agent-defaults",
  // BUDGETS PARKED: omit from Cmd-number settings shortcuts while disabled.
  // "organization-limits",
  // SLACK BOT PARKED: omit from Cmd-number settings shortcuts while disabled.
  // "slack-bot",
] as const satisfies readonly SettingsSection[];
