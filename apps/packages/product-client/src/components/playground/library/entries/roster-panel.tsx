import { RosterPanel } from "#product/primitives/patterns/RosterPanel";
import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { IconButton } from "#product/primitives/IconButton";
import { Plus } from "#product/primitives/icons/core";
import { RotateCw } from "#product/primitives/icons/status";
import type { LibraryEntry } from "../types";

const DEMO_LOOPS = [
  { id: "a", title: "Sweep the flaky suite", secondary: "every 30m · next in 12m · 4 fires" },
  { id: "b", title: "Post the nightly digest", secondary: "0 9 * * * · next in 6h · 21 fires" },
] as const;

function RosterPanelDemo() {
  return (
    <div className="flex w-72 flex-col gap-6">
      <RosterPanel
        title="Loops"
        headerAction={(
          <IconButton size="xs" title="Arm a new loop" aria-label="Arm a new loop">
            <Plus className="icon-paired" />
          </IconButton>
        )}
        empty="No loops armed."
      >
        {DEMO_LOOPS.map((loop) => (
          <li key={loop.id}>
            <RosterRow
              leading={<RotateCw className="icon-paired text-muted-foreground" aria-hidden />}
              title={loop.title}
              secondary={loop.secondary}
            />
          </li>
        ))}
      </RosterPanel>
      <RosterPanel title="Terminals" empty="No background terminals." />
    </div>
  );
}

/**
 * Registry row for `RosterPanel`. Kept in its own module so the shared
 * `patterns.tsx` tier list only gains an import and one array entry.
 */
export const ROSTER_PANEL_ENTRY: LibraryEntry = {
  name: "RosterPanel",
  subpath: "#product/primitives/patterns/RosterPanel",
  render: RosterPanelDemo,
};
