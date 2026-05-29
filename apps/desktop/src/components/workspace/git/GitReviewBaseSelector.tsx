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
import type { GitPanelMode } from "@/lib/domain/workspaces/changes/git-panel-diff";

type GitReviewBaseMode = Exclude<GitPanelMode, "working_tree_composite">;

const GIT_REVIEW_SELECTOR_TRIGGER_CLASS =
  "h-6 min-w-0 gap-1 rounded-lg border border-sidebar-border bg-surface-elevated-secondary px-2 py-0 text-[10px] leading-[18px] text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-foreground";

const GIT_REVIEW_BASE_OPTIONS: {
  id: GitReviewBaseMode;
  label: string;
  icon: ComponentType<IconProps>;
}[] = [
  {
    id: "unstaged",
    label: "Unstaged",
    icon: FilePen,
  },
  {
    id: "staged",
    label: "Staged",
    icon: ClipboardList,
  },
  {
    id: "branch",
    label: "Branch",
    icon: GitBranchIcon,
  },
  {
    id: "last_turn",
    label: "Last turn",
    icon: Clock,
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
  const ActiveIcon = activeOption.icon;

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
      className={`w-48 ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <div className="flex flex-col gap-px">
          {GIT_REVIEW_BASE_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            const selected = option.id === normalizedMode;
            return (
              <Button
                key={option.id}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onSelect(option.id);
                  close();
                }}
                className={`h-7 w-full justify-between gap-2 rounded-lg px-2 py-0 text-left text-xs hover:bg-accent ${
                  selected ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <OptionIcon className="size-3 shrink-0" />
                  <span className="min-w-0 truncate">{option.label}</span>
                </span>
                {selected && <Check className="size-3 shrink-0 text-foreground" />}
              </Button>
            );
          })}
        </div>
      )}
    </PopoverButton>
  );
}

function normalizeBaseMode(mode: GitPanelMode): GitReviewBaseMode {
  return mode === "working_tree_composite" ? "unstaged" : mode;
}
