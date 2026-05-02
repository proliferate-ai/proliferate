import type { ComponentType } from "react";
import {
  Blocks,
  BrainOutline,
  CircleQuestion,
  CircleUser,
  CloudIcon,
  CreditCard,
  FolderList,
  GitBranch,
  Keyboard,
  RefreshCw,
  Settings,
  Sparkles,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

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

// ── Grouped sidebar nav ──────────────────────────────────────────────

export type SettingsNavItem =
  | { kind: "section"; id: SettingsSection; label: string; icon: ComponentType<IconProps> }
  | { kind: "action"; id: "checkForUpdates" | "support"; label: string; icon: ComponentType<IconProps> };

export interface SettingsNavGroup {
  id: "preferences" | "organization_account" | "environments" | "workflows" | "help";
  heading: string;
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
    id: "environments",
    heading: "Environments",
    items: [
      { kind: "section", id: "repo", label: "Environments", icon: FolderList },
      { kind: "section", id: "worktrees", label: "Worktrees", icon: GitBranch },
      { kind: "section", id: "cloud", label: "Cloud", icon: CloudIcon },
    ],
  },
  {
    id: "workflows",
    heading: "Workflows",
    items: [
      { kind: "section", id: "agents", label: "Agents", icon: Blocks },
      { kind: "section", id: "agent-defaults", label: "Agent Defaults", icon: Settings },
      { kind: "section", id: "review", label: "Review", icon: BrainOutline },
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

export const SETTINGS_COPY = {
  back: "Back",
  errorTitle: "Settings couldn't be displayed",
  errorDescription:
    "This section hit an unexpected error. You can retry it or switch to another section without leaving Settings.",
  errorRetry: "Try again",
  errorDetailsLabel: "Show details",
} as const;
