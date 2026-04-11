import type { Workspace } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { MessageSquare, SplitPanelRight } from "@/components/ui/icons";
import { workspaceDisplayName } from "@/lib/domain/workspaces/workspace-display";

interface CoworkHeaderProps {
  selectedWorkspace: Workspace | undefined;
  rightPanelOpen: boolean;
  onTogglePanel: () => void;
}

export function CoworkHeader({
  selectedWorkspace,
  rightPanelOpen,
  onTogglePanel,
}: CoworkHeaderProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-2 px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium text-foreground">
          {selectedWorkspace ? workspaceDisplayName(selectedWorkspace) : "Thread"}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onTogglePanel}
          aria-label={rightPanelOpen ? "Hide artifacts panel" : "Show artifacts panel"}
          title={rightPanelOpen ? "Hide artifacts panel" : "Show artifacts panel"}
          className="h-7 px-1.5 text-xs rounded-md"
        >
          <SplitPanelRight className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}
