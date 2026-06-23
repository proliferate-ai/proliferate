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
  | "organization-integrations"
  | "organization-limits"
  | "organization-model-policy"
  | "support"
  | "worktrees";

export type SettingsNavItem =
  | {
    kind: "section";
    id: SettingsSection;
    label: string;
    iconId: SettingsNavIconId;
    adminOnly?: boolean;
    tbr?: boolean;
  }
  | {
    kind: "action";
    id: "checkForUpdates" | "support";
    label: string;
    iconId: SettingsNavIconId;
    tbr?: boolean;
  };

export interface SettingsNavGroup {
  id:
    | "admin"
    | "individual_settings"
    | "workspaces"
    | "agents"
    | "help";
  heading: string | null;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "admin",
    heading: "Admin",
    items: [
      {
        kind: "section",
        id: "organization",
        label: "Organization settings",
        iconId: "organization",
        adminOnly: true,
      },
      {
        kind: "section",
        id: "billing",
        label: "Plan + billing",
        iconId: "billing",
        adminOnly: true,
      },
      {
        kind: "section",
        id: "organization-integrations",
        label: "Integrations",
        iconId: "organization-integrations",
        adminOnly: true,
      },
      {
        kind: "section",
        id: "organization-model-policy",
        label: "Model policy",
        iconId: "organization-model-policy",
        adminOnly: true,
      },
      {
        kind: "section",
        id: "organization-limits",
        label: "Limits",
        iconId: "organization-limits",
        adminOnly: true,
      },
    ],
  },
  {
    id: "individual_settings",
    heading: "Settings",
    items: [
      { kind: "section", id: "general", label: "General", iconId: "general" },
      { kind: "section", id: "appearance", label: "Appearance", iconId: "appearance" },
      { kind: "section", id: "keyboard", label: "Keyboard shortcuts", iconId: "keyboard" },
      { kind: "section", id: "account", label: "Account", iconId: "account" },
    ],
  },
  {
    id: "workspaces",
    heading: "Workspaces",
    items: [
      { kind: "section", id: "environments", label: "Environments", iconId: "environments" },
      { kind: "section", id: "compute", label: "Personal compute", iconId: "compute" },
      { kind: "section", id: "worktrees", label: "Pruning", iconId: "worktrees" },
      { kind: "section", id: "archived-chats", label: "Archived chats", iconId: "archived-chats", tbr: true },
    ],
  },
  {
    id: "agents",
    heading: "Agents",
    items: [
      {
        kind: "section",
        id: "agent-authentication",
        label: "Authentication",
        iconId: "agent-authentication",
      },
      { kind: "section", id: "agent-defaults", label: "Defaults", iconId: "agent-defaults" },
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

const SETTINGS_ADMIN_ONLY_SECTIONS = new Set<SettingsSection>(
  SETTINGS_NAV_GROUPS.flatMap((group) =>
    group.items.flatMap((item) =>
      item.kind === "section" && item.adminOnly === true ? [item.id] : []
    )
  ),
);

export function isSettingsAdminOnlySection(section: SettingsSection): boolean {
  return SETTINGS_ADMIN_ONLY_SECTIONS.has(section);
}
