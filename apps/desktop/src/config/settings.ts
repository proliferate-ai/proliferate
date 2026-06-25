export const SETTINGS_CONTENT_SECTIONS = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "organization-members",
  "billing",
  "organization-integrations",
  "organization-model-policy",
  "organization-limits",
  "environments",
  "compute",
  "worktrees",
  "archived-chats",
  "agent-authentication",
  "agent-defaults",
  // SLACK BOT PARKED: keep the id nearby for revival, but do not register it.
  // "slack-bot",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];

export const SETTINGS_DEFAULT_SECTION: SettingsSection = "general";

export const TEMPORARILY_SHOW_ADMIN_SETTINGS_FOR_UI_ITERATION = true;

export const SETTINGS_SHORTCUT_SECTION_ORDER = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "organization-members",
  "billing",
  "organization-integrations",
  "organization-model-policy",
  "organization-limits",
  "environments",
  "compute",
  "worktrees",
  "archived-chats",
  "agent-authentication",
  "agent-defaults",
  // SLACK BOT PARKED: omit from Cmd-number settings shortcuts while disabled.
  // "slack-bot",
] as const satisfies readonly SettingsSection[];
