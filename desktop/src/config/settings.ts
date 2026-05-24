export const SETTINGS_CONTENT_SECTIONS = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "billing",
  "environments",
  "shared-environments",
  "compute",
  "agent-defaults",
  "agent-authentication",
  "review",
  "slack-bot",
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
  "shared-environments",
  "compute",
  "agent-defaults",
  "agent-authentication",
  "review",
  "slack-bot",
] as const satisfies readonly SettingsSection[];
