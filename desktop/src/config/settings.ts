import type { ComponentType } from "react";
import {
  Blocks,
  CircleQuestion,
  CircleUser,
  CloudIcon,
  Keyboard,
  RefreshCw,
  Settings,
  Shield,
  Sparkles,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

export const SETTINGS_CONTENT_SECTIONS = [
  "agents",
  "defaults",
  "appearance",
  "account",
  "keyboard",
  "cloud",
  "advanced",
  "repo",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];
export type SettingsStaticSection = Exclude<SettingsSection, "repo">;

export const SETTINGS_DEFAULT_SECTION: SettingsStaticSection = "agents";

// ── Grouped sidebar nav ──────────────────────────────────────────────

export type SettingsNavItem =
  | { kind: "section"; id: SettingsStaticSection; label: string; icon: ComponentType<IconProps> }
  | { kind: "action"; id: "checkForUpdates" | "support"; label: string; icon: ComponentType<IconProps> };

export interface SettingsNavGroup {
  id: "configuration" | "primary" | "cloud" | "updates";
  heading?: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "configuration",
    heading: "Configuration",
    items: [
      { kind: "section", id: "agents", label: "Agents", icon: Blocks },
      { kind: "section", id: "defaults", label: "Defaults", icon: Shield },
    ],
  },
  {
    id: "primary",
    items: [
      { kind: "section", id: "appearance", label: "Appearance", icon: Sparkles },
      { kind: "section", id: "account", label: "Account", icon: CircleUser },
      { kind: "section", id: "keyboard", label: "Keyboard", icon: Keyboard },
      { kind: "section", id: "advanced", label: "Advanced", icon: Settings },
      { kind: "action", id: "support", label: "Support", icon: CircleQuestion },
    ],
  },
  {
    id: "cloud",
    heading: "Cloud",
    items: [
      { kind: "section", id: "cloud", label: "Cloud", icon: CloudIcon },
    ],
  },
  {
    id: "updates",
    heading: "Updates",
    items: [
      {
        kind: "action",
        id: "checkForUpdates",
        label: "Check for desktop updates",
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
