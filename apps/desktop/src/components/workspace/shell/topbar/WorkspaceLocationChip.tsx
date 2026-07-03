import { Button } from "@proliferate/ui/primitives/Button";
import type { WorkspaceLocationChipView } from "@/lib/domain/workspaces/move/move-location-chip";

interface WorkspaceLocationChipProps {
  view: WorkspaceLocationChipView;
  onClick: () => void;
}

const CLICKABLE_TITLE_BY_LOCATION: Partial<Record<WorkspaceLocationChipView["location"], string>> = {
  local: "Move this workspace to the cloud",
  cloud: "Move this workspace to this Mac",
};

/** The workspace header's location indicator (spec section 2.6's entry point (b)):
 *  clickable for local and cloud workspaces, opening the same direction-aware move
 *  dialog as the sidebar context-menu item (spec section 2.6, "Direction inference at
 *  the entry points"); a read-only badge for target (SSH) workspaces until M3. */
export function WorkspaceLocationChip({ view, onClick }: WorkspaceLocationChipProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!view.clickable}
      onClick={onClick}
      title={(view.clickable && CLICKABLE_TITLE_BY_LOCATION[view.location]) || view.label}
      className="workspace-shell-icon-button shrink-0 gap-1 px-2 text-ui-sm text-muted-foreground disabled:opacity-100"
    >
      {view.label}
    </Button>
  );
}
