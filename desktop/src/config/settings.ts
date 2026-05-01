import type { ComponentType } from "react";
import {
  Blocks,
  BrainOutline,
  CircleQuestion,
  CircleUser,
  CloudIcon,
  FolderList,
  Keyboard,
  RefreshCw,
  Settings,
  Sparkles,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

export const SETTINGS_CONTENT_SECTIONS = [
  "general",
  "agents",
  "review",
  "appearance",
  "account",
  "keyboard",
  "cloud",
  "organization",
  "repo",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];
export type SettingsStaticSection = Exclude<SettingsSection, "repo">;

export const SETTINGS_DEFAULT_SECTION: SettingsStaticSection = "general";

// ── Grouped sidebar nav ──────────────────────────────────────────────

export type SettingsNavItem =
  | { kind: "section"; id: SettingsSection; label: string; icon: ComponentType<IconProps> }
  | { kind: "action"; id: "checkForUpdates" | "support"; label: string; icon: ComponentType<IconProps> };

export interface SettingsNavGroup {
  id: "preferences" | "workflows" | "organization" | "account_cloud" | "help";
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
    id: "workflows",
    heading: "Workflows",
    items: [
      { kind: "section", id: "agents", label: "Agents", icon: Blocks },
      { kind: "section", id: "review", label: "Review", icon: BrainOutline },
      { kind: "section", id: "repo", label: "Environments", icon: FolderList },
    ],
  },
  {
    id: "organization",
    heading: "Organization",
    items: [
      { kind: "section", id: "organization", label: "Settings", icon: CircleUser },
    ],
  },
  {
    id: "account_cloud",
    heading: "Account & Cloud",
    items: [
      { kind: "section", id: "account", label: "Account", icon: CircleUser },
      { kind: "section", id: "cloud", label: "Cloud", icon: CloudIcon },
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
