import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  Check,
  CollapseAll,
  ChevronDown,
  ListFilter,
  RefreshCw,
  Search,
} from "@/components/ui/icons";
import { PopoverButton } from "@/components/ui/PopoverButton";
import type { GitPanelMode } from "@/lib/domain/workspaces/git-panel-diff";
import { useWorkspaceFileTreeUiStore } from "@/stores/editor/workspace-file-tree-ui-store";
import { useWorkspaceViewerTabsStore } from "@/stores/editor/workspace-viewer-tabs-store";

export type FileBrowserScopeFilter = "all" | GitPanelMode;

interface FileBrowserToolbarProps {
  search: string;
  scopeFilter: FileBrowserScopeFilter;
  changedFileCount: number;
  onSearchChange: (value: string) => void;
  onScopeFilterChange: (value: FileBrowserScopeFilter) => void;
  onRefresh: () => void;
}

const FILE_BROWSER_FILTER_OPTIONS: {
  id: FileBrowserScopeFilter;
  label: string;
}[] = [
  { id: "all", label: "All files" },
  { id: "working_tree_composite", label: "Current changes" },
  { id: "unstaged", label: "Unstaged" },
  { id: "staged", label: "Staged" },
  { id: "branch", label: "This branch" },
];

export function FileBrowserToolbar({
  search,
  scopeFilter,
  changedFileCount,
  onSearchChange,
  onScopeFilterChange,
  onRefresh,
}: FileBrowserToolbarProps) {
  const treeStateKey = useWorkspaceViewerTabsStore((s) => s.treeStateKey);
  const collapseAllDirectories = useWorkspaceFileTreeUiStore((s) => s.collapseAllDirectories);
  const activeFilterLabel =
    FILE_BROWSER_FILTER_OPTIONS.find((option) => option.id === scopeFilter)?.label ?? "All files";

  return (
    <div className="shrink-0 border-b border-sidebar-border bg-sidebar-background px-2 py-2">
      <div className="flex items-center gap-2">
        <PopoverButton
          trigger={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 min-w-0 flex-1 justify-between gap-2 rounded-md border-sidebar-border/70 bg-sidebar-accent px-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ListFilter className="size-3 shrink-0" />
                <span className="truncate">{activeFilterLabel}</span>
              </span>
              <ChevronDown className="size-3 shrink-0 text-sidebar-muted-foreground" />
            </Button>
          }
          align="start"
          className="w-44 rounded-lg border border-border bg-popover p-1 shadow-floating"
        >
          {(close) => (
            <div className="flex flex-col gap-px">
              {FILE_BROWSER_FILTER_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onScopeFilterChange(option.id);
                    close();
                  }}
                  className={`h-auto w-full justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent ${
                    scopeFilter === option.id ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span>{option.label}</span>
                  {scopeFilter === option.id && <Check className="size-3 text-foreground" />}
                </Button>
              ))}
            </div>
          )}
        </PopoverButton>
        <span className="shrink-0 text-[10px] tabular-nums text-sidebar-muted-foreground">
          {changedFileCount} changed
        </span>
        <Tooltip singleLine content="Collapse all">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!treeStateKey}
            onClick={() => treeStateKey && collapseAllDirectories(treeStateKey)}
            aria-label="Collapse all folders"
            className="size-7 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <CollapseAll className="size-3.5" />
          </Button>
        </Tooltip>
        <Tooltip content="Refresh">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            aria-label="Refresh files"
            className="size-7 text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <RefreshCw className="size-3.5" />
          </Button>
        </Tooltip>
      </div>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-sidebar-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search files"
          className="h-7 rounded-md border-sidebar-border bg-sidebar-accent/40 pl-7 pr-2 text-xs text-sidebar-foreground placeholder:text-sidebar-muted-foreground"
        />
      </div>
    </div>
  );
}
