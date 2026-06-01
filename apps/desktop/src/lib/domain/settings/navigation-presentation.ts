import type { SettingsSection } from "@/config/settings";

export type SettingsNavIconId =
  | "account"
  | "agent-authentication"
  | "agent-defaults"
  | "appearance"
  | "archived-chats"
  | "billing"
  | "check-for-updates"
  | "compute"
  | "environments"
  | "general"
  | "keyboard"
  | "organization"
  | "review"
  | "shared-environments"
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
  id: "preferences" | "organization_account" | "workspace" | "agents" | "help";
  heading: string | null;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "preferences",
    heading: "Preferences",
    items: [
      { kind: "section", id: "general", label: "General", iconId: "general" },
      { kind: "section", id: "appearance", label: "Appearance", iconId: "appearance" },
      { kind: "section", id: "keyboard", label: "Keyboard", iconId: "keyboard" },
    ],
  },
  {
    id: "organization_account",
    heading: "Organization & Account",
    items: [
      { kind: "section", id: "account", label: "Account", iconId: "account" },
      { kind: "section", id: "organization", label: "Organization", iconId: "organization" },
      { kind: "section", id: "billing", label: "Billing", iconId: "billing" },
    ],
  },
  {
    id: "workspace",
    heading: "Workspace",
    items: [
      { kind: "section", id: "environments", label: "Environments", iconId: "environments" },
      { kind: "section", id: "worktrees", label: "Worktrees", iconId: "worktrees" },
      { kind: "section", id: "archived-chats", label: "Archived chats", iconId: "archived-chats" },
      {
        kind: "section",
        id: "shared-environments",
        label: "Shared Sandbox",
        iconId: "shared-environments",
        adminOnly: true,
      },
      { kind: "section", id: "compute", label: "Compute", iconId: "compute" },
    ],
  },
  {
    id: "agents",
    heading: "Agents",
    items: [
      { kind: "section", id: "agent-defaults", label: "Agent Defaults", iconId: "agent-defaults" },
      {
        kind: "section",
        id: "agent-authentication",
        label: "Agent Authentication",
        iconId: "agent-authentication",
      },
      { kind: "section", id: "review", label: "Review", iconId: "review" },
    ],
  },
  // SLACK BOT PARKED: navigation entry is intentionally unregistered while the flow is disabled.
  // {
  //   id: "slack_bot",
  //   heading: null,
  //   items: [
  //     {
  //       kind: "section",
  //       id: "slack-bot",
  //       label: "Slack bot",
  //       iconId: "slack-bot",
  //       adminOnly: true,
  //     },
  //   ],
  // },
  {
    id: "help",
    heading: "Help",
    items: [
      { kind: "action", id: "support", label: "Support", iconId: "support" },
      {
        kind: "action",
        id: "checkForUpdates",
        label: "Desktop updates",
        iconId: "check-for-updates",
      },
    ],
  },
];
