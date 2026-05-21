export const SETTINGS_CONTENT_SECTIONS = [
  "general",
  "agent-defaults",
  "agents",
  "review",
  "appearance",
  "account",
  "keyboard",
  "billing",
  "cloud",
  "organization",
  "repo",
  "worktrees",
  "compute",
  "slack-bot",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];
export type SettingsStaticSection = Exclude<SettingsSection, "repo">;

export const SETTINGS_DEFAULT_SECTION: SettingsStaticSection = "general";

export const SETTINGS_SHORTCUT_SECTION_ORDER = [
  "general",
  "appearance",
  "keyboard",
  "account",
  "organization",
  "billing",
  "repo",
  "worktrees",
  "compute",
  "cloud",
  "agents",
  "agent-defaults",
  "review",
] as const satisfies readonly SettingsSection[];
