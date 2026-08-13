import { useState, type ReactNode } from "react";
import { PanelHeaderEntry } from "#product/primitives/patterns/panel/PanelHeaderEntry";
import { ShortcutBadge } from "#product/primitives/ShortcutBadge";
import { AppShellReviewIcon, AppShellTerminalIcon } from "#product/primitives/icons/app-shell";
import { ScratchPadIcon } from "#product/primitives/icons/product";
import type { LibraryEntry } from "./types";

/**
 * Panel-kit entries. Grouping is name-derived, so these rows splice into the
 * pattern tier's list rather than declaring a tier of their own.
 */

interface DemoEntry {
  key: string;
  label: string;
  icon: ReactNode;
  dirty?: boolean;
  trailing?: ReactNode;
  closable?: boolean;
}

const DEMO_ENTRIES: DemoEntry[] = [
  {
    key: "changes",
    label: "Changes",
    icon: <AppShellReviewIcon />,
  },
  {
    key: "scratch",
    label: "Scratch",
    icon: <ScratchPadIcon />,
    dirty: true,
  },
  {
    key: "terminal",
    label: "zsh — proliferate",
    icon: <AppShellTerminalIcon />,
    trailing: <ShortcutBadge label="⌘1" />,
    closable: true,
  },
];

function PanelHeaderEntryDemo() {
  const [activeKey, setActiveKey] = useState("changes");
  const [closedKeys, setClosedKeys] = useState<string[]>([]);

  const visible = DEMO_ENTRIES.filter((entry) => !closedKeys.includes(entry.key));

  return (
    <div
      role="tablist"
      aria-label="Panel header entries"
      aria-orientation="horizontal"
      className="flex w-72 items-center gap-1 rounded-lg bg-sidebar-background p-1"
    >
      {visible.map((entry) => (
        <PanelHeaderEntry
          key={entry.key}
          label={entry.label}
          icon={entry.icon}
          active={entry.key === activeKey}
          dirty={entry.dirty}
          trailing={entry.trailing}
          controls={`playground-panel-${entry.key}`}
          onSelect={() => setActiveKey(entry.key)}
          onClose={entry.closable
            ? () => setClosedKeys((keys) => [...keys, entry.key])
            : undefined}
          className="min-w-0 flex-1"
        />
      ))}
    </div>
  );
}

export const PANEL_KIT_ENTRIES: LibraryEntry[] = [
  {
    name: "PanelHeaderEntry",
    subpath: "#product/primitives/patterns/panel/PanelHeaderEntry",
    render: PanelHeaderEntryDemo,
  },
];
