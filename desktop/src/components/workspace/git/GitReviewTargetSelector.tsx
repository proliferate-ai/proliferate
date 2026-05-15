import { useMemo, useState } from "react";
import type { GitBranchRef } from "@anyharness/sdk";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Check,
  ChevronDown,
  FilePen,
  GitBranchIcon,
  GitCommit,
  Search,
} from "@/components/ui/icons";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@/components/ui/PopoverButton";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";

export function GitReviewTargetSelector({
  mode,
  baseRef,
  branchRefs,
  isRuntimeReady,
  onSelect,
}: {
  mode: GitPanelMode;
  baseRef: string | null;
  branchRefs: readonly GitBranchRef[];
  isRuntimeReady: boolean;
  onSelect: (baseRef: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const activeRef = baseRef ?? "origin/main";
  const localTarget = localTargetForMode(mode);
  const branchOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    const options = branchRefs
      .filter((branch) => !query || branch.name.toLowerCase().includes(query))
      .slice(0, 40);
    if (activeRef && !options.some((branch) => branch.name === activeRef)) {
      return [{
        name: activeRef,
        isDefault: false,
        isHead: false,
        isRemote: activeRef.includes("/"),
        upstream: null,
      } satisfies GitBranchRef, ...options];
    }
    return options;
  }, [activeRef, branchRefs, search]);

  if (localTarget) {
    const TargetIcon = localTarget.icon;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        className="h-6 min-w-0 max-w-[8rem] flex-[1_1_7.25rem] cursor-default gap-1 rounded-lg border border-transparent bg-transparent px-2 py-0 text-[10px] leading-[18px] text-sidebar-muted-foreground opacity-100 disabled:opacity-100"
      >
        <TargetIcon className="size-3 shrink-0 opacity-75" />
        <span className="min-w-0 truncate text-sidebar-foreground">{localTarget.label}</span>
      </Button>
    );
  }

  return (
    <PopoverButton
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!isRuntimeReady}
          className="h-6 min-w-0 max-w-[8rem] flex-[1_1_7.25rem] gap-1 rounded-lg border border-transparent bg-transparent px-2 py-0 text-[10px] leading-[18px] text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground"
        >
          <GitBranchIcon className="size-3 shrink-0 opacity-75" />
          <span className="min-w-0 truncate text-sidebar-foreground">{activeRef}</span>
          <ChevronDown className="size-2.5 shrink-0 opacity-70" />
        </Button>
      }
      align="start"
      className={`w-56 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <div className="flex flex-col gap-1">
          <div className="flex h-7 items-center gap-1.5 rounded-lg bg-surface-control px-2 text-muted-foreground">
            <Search className="size-3 shrink-0" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search branches"
              className="h-full border-0 bg-transparent px-0 text-xs focus:ring-0"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {branchOptions.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No branches</p>
            ) : (
              branchOptions.map((branch) => (
                <Button
                  key={branch.name}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSelect(branch.name);
                    close();
                  }}
                  className={`h-7 w-full justify-between rounded-lg px-2 py-0 text-xs hover:bg-accent ${
                    branch.name === activeRef ? "text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <GitBranchIcon className="size-3 shrink-0" />
                    <span className="min-w-0 truncate">{branch.name}</span>
                  </span>
                  <span className="ml-2 flex shrink-0 items-center gap-2">
                    {branch.isDefault && (
                      <span className="rounded bg-muted px-1.5 py-px text-[9px] font-medium leading-none text-muted-foreground">
                        default
                      </span>
                    )}
                    {branch.name === activeRef && (
                      <Check className="size-3 shrink-0 text-foreground" />
                    )}
                  </span>
                </Button>
              ))
            )}
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

function localTargetForMode(mode: GitPanelMode) {
  if (mode === "staged") {
    return { label: "HEAD", icon: GitCommit };
  }
  if (mode === "unstaged" || mode === "working_tree_composite") {
    return { label: "Working tree", icon: FilePen };
  }
  return null;
}
