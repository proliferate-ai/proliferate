import type { ComponentType } from "react";
import {
  Settings,
  Blocks,
  CircleQuestion,
  CircleUser,
  CloudIcon,
  Keyboard,
  RefreshCw,
  Tree,
} from "@/components/ui/icons";
import type { IconProps } from "@/components/ui/icons";

export const SETTINGS_CONTENT_SECTIONS = [
  "configuration",
  "keyboard",
  "cowork",
  "account",
  "cloud",
  "cloudRepo",
  "agents",
  "repo",
] as const;

export type SettingsSection = (typeof SETTINGS_CONTENT_SECTIONS)[number];
export type SettingsStaticSection = Exclude<SettingsSection, "repo" | "cloudRepo">;

// ── Grouped sidebar nav ──────────────────────────────────────────────

export type SettingsNavItem =
  | { kind: "section"; id: SettingsStaticSection; label: string; icon: ComponentType<IconProps> }
  | { kind: "action"; id: "checkForUpdates" | "support"; label: string; icon: ComponentType<IconProps> };

export interface SettingsNavGroup {
  id: "primary" | "cloud";
  heading?: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  {
    id: "primary",
    items: [
      { kind: "section", id: "configuration", label: "Configuration", icon: Settings },
      { kind: "action", id: "support", label: "Support", icon: CircleQuestion },
      { kind: "section", id: "cowork", label: "Cowork", icon: Tree },
      { kind: "section", id: "agents", label: "Agents", icon: Blocks },
      { kind: "section", id: "account", label: "Account", icon: CircleUser },
      { kind: "section", id: "keyboard", label: "Keyboard", icon: Keyboard },
    ],
  },
  {
    id: "cloud",
    heading: "Cloud",
    items: [
      { kind: "section", id: "cloud", label: "Cloud", icon: CloudIcon },
      {
        kind: "action",
        id: "checkForUpdates",
        label: "Check for desktop updates",
        icon: RefreshCw,
      },
    ],
  },
];

// ── Legacy flat list (used by SettingsSidebar until migration) ────────

export type SettingsStaticNavItem =
  | { kind: "section"; id: SettingsStaticSection; label: string }
  | { kind: "action"; id: "checkForUpdates" | "support"; label: string };

export const SETTINGS_STATIC_NAV_ITEMS: SettingsStaticNavItem[] =
  SETTINGS_NAV_GROUPS.flatMap((g) =>
    g.items.map((item): SettingsStaticNavItem =>
      item.kind === "section"
        ? { kind: "section", id: item.id, label: item.label }
        : { kind: "action", id: item.id, label: item.label },
    ),
  );

export const SETTINGS_COPY = {
  back: "Back",
  errorTitle: "Settings couldn't be displayed",
  errorDescription:
    "This section hit an unexpected error. You can retry it or switch to another section without leaving Settings.",
  errorRetry: "Try again",
  errorDetailsLabel: "Show details",
} as const;
