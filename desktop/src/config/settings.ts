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
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];
export type SettingsStaticSection = Exclude<SettingsSection, "repo">;

export const SETTINGS_DEFAULT_SECTION: SettingsStaticSection = "general";
