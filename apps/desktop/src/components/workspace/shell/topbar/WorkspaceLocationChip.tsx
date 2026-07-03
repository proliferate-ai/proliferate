import { Button } from "@proliferate/ui/primitives/Button";
import type { WorkspaceLocationChipView } from "@/lib/domain/workspaces/move/move-location-chip";

interface WorkspaceLocationChipProps {
  view: WorkspaceLocationChipView;
  onClick: () => void;
}

/** The workspace header's location indicator (spec section 2.6's entry point (b)):
 *  clickable when the workspace is local, opening the same move-to-cloud dialog as the
 *  sidebar context-menu item; a read-only badge for cloud/target workspaces until the
 *  mirror direction lands. */
export function WorkspaceLocationChip({ view, onClick }: WorkspaceLocationChipProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={!view.clickable}
      onClick={onClick}
      title={view.clickable ? "Move this workspace to the cloud" : view.label}
      className="workspace-shell-icon-button shrink-0 gap-1 px-2 text-ui-sm text-muted-foreground disabled:opacity-100"
    >
      {view.label}
    </Button>
  );
}
