import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { Check, ChevronDown } from "#product/primitives/icons/core";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "#product/primitives/PopoverButton";
import { PopoverMenuItem } from "#product/primitives/PopoverMenuItem";
import {
  GIT_PANEL_MODE_OPTIONS,
  type GitPanelMode,
} from "#product/lib/domain/workspaces/changes/git-panel-diff";
import { GIT_REVIEW_SELECTOR_TRIGGER_CLASS } from "#product/components/workspace/git/GitReviewSelectorChrome";

/** Selectable review targets: working tree / branch / last turn. */
type GitReviewTargetMode = "working_tree_composite" | "branch" | "last_turn";

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
          // C4: caps the trigger label at 11rem so a long mode label never
          // crowds the review header's other chrome.
          className={`${GIT_REVIEW_SELECTOR_TRIGGER_CLASS} w-fit max-w-[11rem] shrink-0`}
        >
          <span className="min-w-0 truncate text-sidebar-foreground">{activeOption.label}</span>
          {changedCount > 0 && (
            <span className="shrink-0">
              <Badge size="micro" className="tabular-nums">{changedCount}</Badge>
            </span>
          )}
          <ChevronDown className="icon-compact shrink-0 text-sidebar-muted-foreground" />
        </Button>
      }
      align="start"
      // C4: the option list's minimum width — narrower than the trigger's
      // own max-width isn't possible here, this is the floor for the
      // longest mode label to read comfortably.
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
                      <Badge size="micro" className="tabular-nums">{changedCount}</Badge>
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
