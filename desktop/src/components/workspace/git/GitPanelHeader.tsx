import { Button } from "@/components/ui/Button";
import { Check, ChevronDown, RefreshCw } from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import {
  GIT_PANEL_MODE_OPTIONS,
  type GitPanelMode,
} from "@/lib/domain/workspaces/changes/git-panel-diff";

interface GitPanelHeaderProps {
  changesFilter: GitPanelMode;
  activeFilterLabel: string;
  totalChangedCount: number;
  visibleChangedCount: number;
  isBranchMode: boolean;
  isRuntimeReady: boolean;
  onFilterChange: (mode: GitPanelMode) => void;
  onRefresh: () => void;
}

export function GitPanelHeader({
  changesFilter,
  activeFilterLabel,
  totalChangedCount,
  visibleChangedCount,
  isBranchMode,
  isRuntimeReady,
  onFilterChange,
  onRefresh,
}: GitPanelHeaderProps) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-sidebar-border/70 px-2 py-2">
      <p className="px-1 text-xs text-sidebar-muted-foreground">
        {totalChangedCount === 0
          ? isBranchMode
            ? "No branch changes"
            : "Working tree clean"
          : `${visibleChangedCount} ${activeFilterLabel.toLowerCase()} file${visibleChangedCount !== 1 ? "s" : ""}`}
      </p>
      <div className="flex items-center gap-1">
        <PopoverButton
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-6 gap-1 rounded-md border-sidebar-border/70 bg-sidebar-accent px-2 text-[10px] text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <span>{activeFilterLabel}</span>
              <ChevronDown className="size-2.5" />
            </Button>
          }
          align="end"
          className="w-36 rounded-lg border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <div className="flex flex-col gap-px">
              {GIT_PANEL_MODE_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onFilterChange(option.id);
                    close();
                  }}
                  className={`h-auto w-full justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent ${
                    changesFilter === option.id
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <span>{option.label}</span>
                  {changesFilter === option.id && (
                    <Check className="size-3 text-foreground" />
                  )}
                </Button>
              ))}
            </div>
          )}
        </PopoverButton>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRefresh}
          disabled={!isRuntimeReady}
          className="h-6 w-6 rounded-md text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          title="Refresh changes"
          aria-label="Refresh changes"
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>
    </div>
  );
}
