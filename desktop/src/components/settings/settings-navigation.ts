import type { ComponentType } from "react";
import {
  Blocks,
  BrainOutline,
  CircleQuestion,
  CircleUser,
  CloudIcon,
  CreditCard,
  FolderList,
  Keyboard,
  MessageSquare,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";
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
  id: "preferences" | "organization_account" | "workspace" | "agents" | "slack_bot" | "help";
  heading: string | null;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "preferences",
    heading: "Preferences",
    items: [
      { kind: "section", id: "general", label: "General", icon: Settings },
      { kind: "section", id: "appearance", label: "Appearance", icon: Sparkles },
      { kind: "section", id: "keyboard", label: "Keyboard", icon: Keyboard },
    ],
  },
  {
    id: "organization_account",
    heading: "Organization & Account",
    items: [
      { kind: "section", id: "account", label: "Account", icon: CircleUser },
      { kind: "section", id: "organization", label: "Organization", icon: CircleUser },
      { kind: "section", id: "billing", label: "Billing", icon: CreditCard },
    ],
  },
  {
    id: "workspace",
    heading: "Workspace",
    items: [
      { kind: "section", id: "environments", label: "Environments", icon: FolderList },
      {
        kind: "section",
        id: "shared-environments",
        label: "Shared environments",
        icon: CircleUser,
        adminOnly: true,
      },
      { kind: "section", id: "compute", label: "Compute", icon: CloudIcon },
    ],
  },
  {
    id: "agents",
    heading: "Agents",
    items: [
      { kind: "section", id: "agents", label: "Agents", icon: Blocks },
      { kind: "section", id: "agent-defaults", label: "Agent Defaults", icon: Settings },
      {
        kind: "section",
        id: "agent-authentication",
        label: "Agent Authentication",
        icon: Shield,
      },
      { kind: "section", id: "review", label: "Review", icon: BrainOutline },
    ],
  },
  {
    id: "slack_bot",
    heading: null,
    items: [
      {
        kind: "section",
        id: "slack-bot",
        label: "Slack bot",
        icon: MessageSquare,
        adminOnly: true,
      },
    ],
  },
  {
    id: "help",
    heading: "Help",
    items: [
      { kind: "action", id: "support", label: "Support", icon: CircleQuestion },
      {
        kind: "action",
        id: "checkForUpdates",
        label: "Desktop updates",
        icon: RefreshCw,
      },
    ],
  },
];
