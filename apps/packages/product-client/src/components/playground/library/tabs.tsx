import { useState } from "react";
import { ChromeTab } from "#product/primitives/patterns/tabs/ChromeTab";
import { TabGroupPill } from "#product/primitives/patterns/tabs/TabGroupPill";
import { CheckCircleFilled } from "#product/primitives/icons/status";
import type { LibraryEntry } from "./types";

/**
 * The tabs kit's spec-sheet demos. Self-contained: fixture labels plus local
 * state, no stores, no providers — the sheet renders the same DOM the shell
 * tab strip does, on the sidebar plane the strip sits on.
 */

function ChromeTabDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const tabs = ["Session one", "Session two"];
  return (
    <div className="flex items-stretch gap-px bg-sidebar p-1">
      {tabs.map((label, index) => (
        <ChromeTab
          key={label}
          isActive={index === activeIndex}
          width={132}
          label={label}
          badge={index === 0 ? <CheckCircleFilled className="icon-compact" /> : undefined}
          onSelect={() => setActiveIndex(index)}
          onClose={() => {}}
        />
      ))}
    </div>
  );
}

function TabGroupPillDemo() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex items-center gap-2 bg-sidebar p-1">
      <TabGroupPill
        tone="filled"
        label="Review"
        color="var(--color-terminal-blue)"
        width={72}
        isCollapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
      <TabGroupPill
        tone="outline"
        label="Delegated"
        color={null}
        width={72}
        isCollapsed={collapsed}
        onToggle={() => setCollapsed((value) => !value)}
      />
    </div>
  );
}

/** Kit entries, spread into the patterns tier by `patterns.tsx`. */
export const TABS_KIT_ENTRIES: LibraryEntry[] = [
  {
    name: "ChromeTab",
    subpath: "#product/primitives/patterns/tabs/ChromeTab",
    render: ChromeTabDemo,
  },
  {
    name: "TabGroupPill",
    subpath: "#product/primitives/patterns/tabs/TabGroupPill",
    render: TabGroupPillDemo,
  },
];
