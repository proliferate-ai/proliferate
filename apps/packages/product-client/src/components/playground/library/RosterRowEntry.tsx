import { useState } from "react";

import { RosterRow } from "#product/primitives/patterns/RosterRow";
import { RowActionIconButton } from "#product/primitives/RowActionIconButton";
import { Fork, Trash } from "#product/primitives/icons/core";
import { ClipboardList } from "#product/primitives/icons/product";
import type { LibraryEntry } from "./types";

const DEMO_AGENTS = [
  { id: "a", title: "Review the migration diff", secondary: "Running · 2m 14s · sonnet", meta: "2m" },
  { id: "b", title: "Draft the release notes", secondary: "Completed · 41s · haiku", meta: "41s" },
] as const;

function RosterRowDemo() {
  const [selectedId, setSelectedId] = useState<string>("a");
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);

  return (
    <div className="flex w-72 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        {DEMO_AGENTS.filter((agent) => !removedIds.includes(agent.id)).map((agent) => (
          <RosterRow
            key={agent.id}
            leading={<Fork className="icon-paired text-muted-foreground" />}
            title={agent.title}
            secondary={agent.secondary}
            trailing={agent.meta}
            selected={selectedId === agent.id}
            onSelect={() => setSelectedId(agent.id)}
            actions={(
              <RowActionIconButton
                label="Dismiss"
                onClick={() => setRemovedIds((ids) => [...ids, agent.id])}
              >
                <Trash />
              </RowActionIconButton>
            )}
          />
        ))}
        <RosterRow
          leading={<Fork className="icon-paired text-faint" />}
          title="Watch-only row (no onSelect)"
          secondary="Read-only roster entries paint no interaction states"
        />
      </div>
      <RosterRow
        density="comfortable"
        leading={<ClipboardList className="icon-paired text-muted-foreground" />}
        title="Nightly regression sweep"
        secondary="3 stages · 2 inputs"
        trailing="Aug 12"
        onSelect={() => setSelectedId("a")}
      />
    </div>
  );
}

/**
 * Registry row for `RosterRow`. Kept in its own module so the shared
 * `patterns.tsx` tier list only gains an import and one array entry.
 */
export const ROSTER_ROW_ENTRY: LibraryEntry = {
  name: "RosterRow",
  subpath: "#product/primitives/patterns/RosterRow",
  render: RosterRowDemo,
};
