import { IconTile } from "#product/primitives/IconTile";
import { KeyRound, Settings } from "#product/primitives/icons/core";
import type { LibraryEntry } from "../types";

/**
 * Self-contained `IconTile` spec-sheet demo: both variant axes on one card,
 * fixture props only — no providers, no stores, no local state.
 */
function IconTileDemo() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <IconTile size="sm">
          <Settings className="icon-compact" />
        </IconTile>
        <IconTile size="md">
          <Settings className="icon-paired" />
        </IconTile>
        <IconTile size="lg">
          <Settings className="icon-control" />
        </IconTile>
      </div>
      <div className="flex items-center gap-2">
        <IconTile tone="control">
          <KeyRound className="icon-paired" />
        </IconTile>
        <IconTile tone="outlined">
          <KeyRound className="icon-paired" />
        </IconTile>
        <IconTile tone="elevated">
          <KeyRound className="icon-paired" />
        </IconTile>
        <IconTile tone="warning">
          <KeyRound className="icon-paired" />
        </IconTile>
      </div>
    </div>
  );
}

export const ICON_TILE_LIBRARY_ENTRY: LibraryEntry = {
  name: "IconTile",
  subpath: "#product/primitives/IconTile",
  render: IconTileDemo,
};
