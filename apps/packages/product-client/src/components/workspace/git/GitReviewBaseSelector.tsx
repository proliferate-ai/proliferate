import { Button } from "@proliferate/ui/primitives/Button";
import { Check, ChevronDown } from "@proliferate/ui/icons";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import {
  GIT_PANEL_MODE_OPTIONS,
  type GitPanelMode,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";

/** Selectable review targets: working tree / branch / last turn. */
type GitReviewTargetMode = "working_tree_composite" | "branch" | "last_turn";

const GIT_REVIEW_SELECTOR_TRIGGER_CLASS =
  "h-6 min-w-0 gap-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0 text-ui leading-[var(--text-ui--line-height)] text-sidebar-foreground hover:bg-surface-elevated-secondary hover:text-sidebar-foreground data-[state=open]:bg-surface-elevated-secondary data-[state=open]:text-sidebar-foreground";

export function GitReviewBaseSelector({
  activeMode,
  changedCount,
  onSelect,
}: {
  activeMode: GitPanelMode;
  changedCount: number;
  onSelect: (mode: GitPanelMode) => void;
}) {
  const normalizedMode = normalizeTargetMode(activeMode);
  const activeOption = GIT_PANEL_MODE_OPTIONS.find((option) => option.id === normalizedMode)
    ?? GIT_PANEL_MODE_OPTIONS[0];

  return (
    <PopoverButton
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={`${GIT_REVIEW_SELECTOR_TRIGGER_CLASS} w-fit max-w-[11rem] shrink-0`}
        >
          <span className="min-w-0 truncate text-sidebar-foreground">{activeOption.label}</span>
          {changedCount > 0 && (
            <span className="inline-flex shrink-0 items-center rounded-sm bg-muted px-1 py-0.5 text-ui-sm font-medium leading-none text-muted-foreground tabular-nums">
              {changedCount}
            </span>
          )}
          <ChevronDown className="icon-compact shrink-0 text-sidebar-muted-foreground" />
        </Button>
      }
      align="start"
      className={`min-w-[8.5rem] ${POPOVER_SURFACE_CLASS}`}
    >
      {(close) => (
        <div className="flex flex-col gap-px">
          {GIT_PANEL_MODE_OPTIONS.map((option) => {
            const selected = option.id === normalizedMode;
            return (
              <PopoverMenuItem
                key={option.id}
                label={<span className="min-w-0 truncate">{option.label}</span>}
                trailing={(
                  <span className="flex shrink-0 items-center gap-1.5">
                    {selected && changedCount > 0 && (
                      <span className="inline-flex items-center rounded-sm bg-muted px-1 py-0.5 text-ui-sm font-medium leading-none text-muted-foreground tabular-nums">
                        {changedCount}
                      </span>
                    )}
                    <Check
                      className={`icon-paired ${selected ? "" : "opacity-0"}`}
                      aria-hidden={selected ? undefined : true}
                    />
                  </span>
                )}
                onClick={() => {
                  onSelect(option.id);
                  close();
                }}
              />
            );
          })}
        </div>
      )}
    </PopoverButton>
  );
}

function normalizeTargetMode(mode: GitPanelMode): GitReviewTargetMode {
  if (mode === "unstaged" || mode === "staged") {
    return "working_tree_composite";
  }
  return mode;
}
