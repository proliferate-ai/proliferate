import type { ComponentType } from "react";
import {
  Building2,
  CircleUser,
  ClipboardList,
  CreditCard,
  Archive,
  FolderList,
  Keyboard,
  LifeBuoy,
  Palette,
  RefreshCw,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Tree,
  UsersRound,
} from "@proliferate/ui/icons";
import type { IconProps } from "@proliferate/ui/icons";
import type { SettingsSection } from "@/config/settings";

export type SettingsNavItem =
  | {
    kind: "section";
    id: SettingsSection;
    label: string;
    icon: ComponentType<IconProps>;
    adminOnly?: boolean;
  }
  | { kind: "action"; id: "checkForUpdates" | "support"; label: string; icon: ComponentType<IconProps> };

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
      { kind: "section", id: "general", label: "General", icon: Settings },
      { kind: "section", id: "appearance", label: "Appearance", icon: Palette },
      { kind: "section", id: "keyboard", label: "Keyboard", icon: Keyboard },
    ],
  },
  {
    id: "organization_account",
    heading: "Organization & Account",
    items: [
      { kind: "section", id: "account", label: "Account", icon: CircleUser },
      { kind: "section", id: "organization", label: "Organization", icon: Building2 },
      { kind: "section", id: "billing", label: "Billing", icon: CreditCard },
    ],
  },
  {
    id: "workspace",
    heading: "Workspace",
    items: [
      { kind: "section", id: "environments", label: "Environments", icon: FolderList },
      { kind: "section", id: "worktrees", label: "Worktrees", icon: Tree },
      { kind: "section", id: "archived-chats", label: "Archived chats", icon: Archive },
      {
        kind: "section",
        id: "shared-environments",
        label: "Shared Sandbox",
        icon: UsersRound,
        adminOnly: true,
      },
      { kind: "section", id: "compute", label: "Compute", icon: Server },
    ],
  },
  {
    id: "agents",
    heading: "Agents",
    items: [
      { kind: "section", id: "agent-defaults", label: "Agent Defaults", icon: SlidersHorizontal },
      {
        kind: "section",
        id: "agent-authentication",
        label: "Agent Authentication",
        icon: Shield,
      },
      { kind: "section", id: "review", label: "Review", icon: ClipboardList },
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
  //       icon: BotMessageSquare,
  //       adminOnly: true,
  //     },
  //   ],
  // },
  {
    id: "help",
    heading: "Help",
    items: [
      { kind: "action", id: "support", label: "Support", icon: LifeBuoy },
      {
        kind: "action",
        id: "checkForUpdates",
        label: "Desktop updates",
        icon: RefreshCw,
      },
    ],
  },
];
