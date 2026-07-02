import type { ComponentType } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import {
  Check,
  ChevronDown,
  ClipboardList,
  Clock,
  FilePen,
  GitBranchIcon,
  type IconProps,
} from "@proliferate/ui/icons";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";

type GitReviewBaseMode = Exclude<GitPanelMode, "working_tree_composite">;

const GIT_REVIEW_SELECTOR_TRIGGER_CLASS =
  "h-6 min-w-0 gap-1 rounded-lg border border-transparent bg-transparent px-2 py-0 text-sm leading-[18px] text-sidebar-foreground hover:bg-surface-elevated-secondary hover:text-sidebar-foreground data-[state=open]:bg-surface-elevated-secondary data-[state=open]:text-sidebar-foreground";

const GIT_REVIEW_BASE_OPTIONS: {
  id: GitReviewBaseMode;
  label: string;
}[] = [
  {
    id: "unstaged",
    label: "Unstaged",
  },
  {
    id: "staged",
    label: "Staged",
  },
  {
    id: "branch",
    label: "Branch",
  },
  {
    id: "last_turn",
    label: "Last turn",
  },
];

export function GitReviewBaseSelector({
  activeMode,
  changedCount,
  onSelect,
}: {
  activeMode: GitPanelMode;
  changedCount: number;
  onSelect: (mode: GitPanelMode) => void;
}) {
  const normalizedMode = normalizeBaseMode(activeMode);
  const activeOption = GIT_REVIEW_BASE_OPTIONS.find((option) => option.id === normalizedMode)
    ?? GIT_REVIEW_BASE_OPTIONS[0];
  const ActiveIcon = iconForBaseMode(normalizedMode);

  return (
    <PopoverButton
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`${GIT_REVIEW_SELECTOR_TRIGGER_CLASS} max-w-[7.5rem] flex-[1_1_6.75rem]`}
        >
          <ActiveIcon className="size-3 shrink-0 opacity-75" />
          <span className="min-w-0 truncate text-sidebar-foreground">{activeOption.label}</span>
          <span className="shrink-0 tabular-nums opacity-70">{changedCount}</span>
          <ChevronDown className="size-2.5 shrink-0 opacity-70" />
        </Button>
      }
      align="start"
      className={`min-w-[200px] ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <div className="flex flex-col gap-px">
          {GIT_REVIEW_BASE_OPTIONS.map((option) => {
            const selected = option.id === normalizedMode;
            return (
              <PopoverMenuItem
                key={option.id}
                label={(
                  <GitReviewBaseOptionContent
                    label={option.label}
                    count={selected ? changedCount : null}
                  />
                )}
                trailing={
                  <Check
                    className={`size-3.5 ${selected ? "" : "opacity-0"}`}
                    aria-hidden={selected ? undefined : true}
                  />
                }
                onClick={() => {
                  onSelect(option.id);
                  close();
                }}
                trailingClassName="opacity-75 group-hover/menu-item:opacity-100 group-focus/menu-item:opacity-100"
              />
            );
          })}
        </div>
      )}
    </PopoverButton>
  );
}

function GitReviewBaseOptionContent({
  label,
  count,
}: {
  label: string;
  count: number | null;
}) {
  return (
    <span className="grid w-full min-w-0 grid-cols-[6.25rem_2.5rem] items-center gap-2">
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex min-w-0 justify-start">
        {count && count > 0 ? (
          <span className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-sm font-medium leading-none text-muted-foreground tabular-nums">
            {count}
          </span>
        ) : (
          <span aria-hidden="true" className="block h-5 w-0" />
        )}
      </span>
    </span>
  );
}

function normalizeBaseMode(mode: GitPanelMode): GitReviewBaseMode {
  return mode === "working_tree_composite" ? "unstaged" : mode;
}

function iconForBaseMode(mode: GitReviewBaseMode): ComponentType<IconProps> {
  switch (mode) {
    case "staged":
      return ClipboardList;
    case "branch":
      return GitBranchIcon;
    case "last_turn":
      return Clock;
    case "unstaged":
      return FilePen;
  }
}
