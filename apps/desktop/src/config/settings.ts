export const SETTINGS_CONTENT_SECTIONS = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "billing",
  "environments",
  "worktrees",
  "archived-chats",
  "shared-environments",
  "compute",
  "agent-defaults",
  "agent-authentication",
  "review",
  // SLACK BOT PARKED: keep the id nearby for revival, but do not register it.
  // "slack-bot",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];

export const SETTINGS_DEFAULT_SECTION: SettingsSection = "general";

export const SETTINGS_SHORTCUT_SECTION_ORDER = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "billing",
  "environments",
  "worktrees",
  "archived-chats",
  "shared-environments",
  "compute",
  "agent-defaults",
  "agent-authentication",
  "review",
  // SLACK BOT PARKED: omit from Cmd-number settings shortcuts while disabled.
  // "slack-bot",
] as const satisfies readonly SettingsSection[];
